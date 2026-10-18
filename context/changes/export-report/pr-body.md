# feat(export-report): export a node's diagnostic history as JSON or CSV

S-08: the node details screen now has an **Export** button. The export screen lets the user pick a range (7 / 30 / 90 days, default 30) and a format (JSON or CSV), shows a preview (run and sample counts, exact fields, redactions, "Passwords and stored credentials are never exported"), and shares the file through the Android share sheet. Public keys are 8-hex-character prefixes by default; a "Full public keys" switch turns that off for one export. Covers FR-13 AC1–AC5 (range and format, preview, key redaction, no credentials in any export, share sheet).
Closes #9

> **Status:** Ready for review

## ⚠ Needs your decision
- **D-1 (costly):** JSON shape → chose **A: one nested object** (`schema_version: 1`, `generated_at`, `generated_by`, `range`, `redaction`, `node`, `runs[]` each with `checks[]` and `telemetry[]`; snake_case; ISO 8601 UTC times; durations in ms). Alternatives: B: flat `runs[]` + `samples[]` joined by run id; C: epoch-ms times. Switching costs: `report.ts`, `schema.ts`, the four golden files, and anyone already parsing the file. See [plan](context/changes/export-report/plan.md#decisions).
- **D-2 (costly):** CSV shape → chose **one row per run**, RFC 4180 with CRLF, `schema_version` column on every row, per-run telemetry columns take the first non-null value in check order, checks and limitations in one `;`-joined cell each. `node_name` is `reportedName`, `node_label` is `userLabel`, times are ISO UTC. Alternatives: B: one row per sample; C: two CSV files (zip or two shares); D: `# schema_version` comment line. Switching costs: `serialize.ts`, CSV golden files, preview manifest.
- **D-7 (costly):** CSV injection → text cells starting with `=`, `+`, `-`, `@`, tab or CR get a leading `'`; numbers are untouched. Alternatives: B: no neutralising; C: strip the characters (loses data). Switching costs: `serialize.ts` and golden files. Any program reading the CSV sees `'=name`.
- **D-3:** 7/30/90-day presets are the "date range" of AC1; there is no free date picker (plan review asked for a look at this). Alternatives: native date picker (new dependency), typed dates.
- **Human checks below** need a real phone; nothing here was verified on hardware.

Reply in a review comment, e.g. `D-2: take B`, `drop the lessons commit`, then run `.claude/workflow/address-pr <PR number>`.

## Human checks
- [ ] (Phase 5) CSV share on a real phone: run one diagnostic, open Export, choose CSV, tap Share, send to a files or mail app; the file opens in a spreadsheet with one row per run and 8-character keys. Run: CI APK (`android-apk` artifact). Evidence: emulator sheet [`export-share-sheet.png`](context/changes/export-report/evidence/export-share-sheet.png), sample [`sample-redacted.csv`](context/changes/export-report/evidence/sample-redacted.csv).
- [ ] (Phase 5) JSON with "Full public keys" on: the file has the 64-character node key and no guest password (search the file for the password you saved). Run: CI APK, Export > JSON > Full public keys > Share. Evidence: [`sample-redacted.json`](context/changes/export-report/evidence/sample-redacted.json) (redacted shape).
- [ ] (Phase 5) Wording and layout of the preview (field list, redaction lines) at 200 % font scale. Run: CI APK, system font size largest, open Export. Evidence: [`export-preview.png`](context/changes/export-report/evidence/export-preview.png) (default scale).

## Other decisions made by the agent (cheap to change)
| ID | Question | Chosen | Alternatives |
|----|----------|--------|--------------|
| D-4 | Which runs fall in the range | `from ≤ finishedAt ≤ to`, inclusive; samples belong to the run | by `startedAt`; by sample `measuredAt` |
| D-5 | Is check evidence exported | No; checks export kind, result, reason, attempts, timeout, start, duration; raw hex never appears | full evidence objects; evidence minus hex |
| D-6 | Node block contents | `public_key, reported_name, label, role, reported_role, last_heard_at`; no position | include position |
| D-8 | Where the Zod schema lives | `apps/mobile/src/application/export/schema.ts` (domain stays dependency-free) | in domain; in storage |
| D-9 | Empty range | "No runs recorded in this range", Share disabled, shown only after a successful read | allow an empty report |
| D-10 | Redaction default before S-09 | port `redactionDefault`, composition passes `async () => true`; every visit starts from it | hard-code `true`; build the setting now |
| D-11 | File name and location | `guardian-<keyPrefix>-<from>-<to>.<ext>` in `Paths.cache`, overwritten on re-share | document directory; full key in name |
| D-12 | Share failures | neutral messages ("Sharing is not available on this device", "Could not create the export file"); preview stays | auto-retry |
| D-13 | Preview "fields" | manifest derived from the serialiser constants (a test ties them) | first lines of the real file |
| D-14 | How samples are read | `TelemetryRepository.forRuns(runIds)` after `runs.forNodeBetween` (plan-review finding 3) | `TelemetryRepository.forNodeBetween` |

## Quality
- Gates: typecheck ok, lint ok, unit tests ok (1449), e2e ok (22/22) ([review](context/changes/export-report/review.md)).
- Review: APPROVE, round 2. Round 1 found two blockers and two minors, round 2 one minor: fixed 5, deferred 0, rejected 0. R1 (export state reused between visits, including the "Full public keys" choice) and R2 (concurrent `open` started two reads, the mutation `bug`) were fixed; R5 (late `close()` wiping a new visit) was fixed by one `ExportController` per screen instance.
- Mutation: 82% → 97% on `report.ts`, `serialize.ts`, `redact.ts`, `export-controller.ts` ([mutation](context/changes/export-report/mutation.md)); `bug` mutants: one, the concurrent `open` (fixed in review as R2).
- Plan review: READY WITH NOTES ([plan-review](context/changes/export-report/plan-review.md)); findings 1–8 applied, see Deviations in the plan.
- Proposed lessons: two candidates are written in `mutation.md` (don't build the subject's output at module load in a mutation target's test) and `review.md` (reset a singleton controller's per-visit state on unmount); no lessons commit is in this branch, so nothing to drop.

## Follow-ups
None. Remaining deviations are `[minor]` and listed in the [plan](context/changes/export-report/plan.md#deviations) (for example: the Export button sits under the run panel, not in a row beside *Run diagnostic* as in the mockup; three e2e flows gained `scrollUntilVisible` because the node page got taller).

## Commits
```
dc9bf59 docs(export-report): triage review round 2
e6674d8 fix(export-report): one export controller per screen instance (R5)
76591f6 docs(export-report): review
1177c62 docs(export-report): triage review round 1
b3ef5b4 fix(export-report): assert 7-day selection and share the same range twice in e2e (R3, R4)
df4e877 fix(export-report): reset export state per visit and guard concurrent open (R1, R2)
c8101a6 docs(export-report): review
4660241 docs(export-report): mutation
a3f1e59 test(export-report): strengthen assertions from mutation check
0ae023a feat(export-report): e2e flow, evidence and human checks
14e4069 feat(export-report): export screen, share platform and node-screen button
1c87359 feat(export-report): export controller, schema gate and preview presenter
b4e9915 feat(export-report): range reads of runs with checks and samples by run
e50ffa0 feat(export-report): export model, key redaction and JSON/CSV serialisers
f067ff3 docs(export-report): plan-review
6a43296 docs(export-report): plan
```

<details><summary>Run</summary>

Branch `change/export-report`, base `main`, no failed step, no draft reason. Steps: plan (opus, $1.58), plan-review (opus, $0.76, READY WITH NOTES), implement ×5 phases (sonnet, $0.62 + $0.34 + $0.68 + $0.90 + $0.28), mutation (sonnet, $0.78), review round 1 (opus, $1.49, CHANGES REQUESTED), fix-review (sonnet, $0.38), review round 2 (opus, $0.98, APPROVE), fix-review (sonnet, $0.20). All steps succeeded on attempt 1. Total about $8.99 (plan-review, review and pr-body costs as reported by the runner). Phases ticked 5/5.
</details>
