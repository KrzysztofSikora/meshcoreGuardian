# Review: export-report

Verdict: CHANGES REQUESTED
Gates: typecheck ok, lint ok, unit tests ok, e2e ok (22/22) · Round: 1

## Plan vs diff
| File | Status | Note |
|------|--------|------|
| `packages/domain/src/export/report.ts` | done | D-1 shape, ordering, orphan-sample rule; `null` companion key logged as `[minor]` |
| `packages/domain/src/export/redact.ts` | done | extra `report` and `runs[].companion` groups logged `[minor]` |
| `packages/domain/src/export/serialize.ts` | done | RFC 4180, CRLF, D-7 prefix, first-non-null rule |
| `packages/domain/src/export/fixtures.ts` | done | |
| `packages/domain/src/export/golden/*` | done | four files, loaded via `import.meta.glob` |
| `packages/domain/src/export/export.test.ts` | done | |
| `packages/domain/src/index.ts` | done | |
| `packages/domain/src/diagnostics/run.ts` | done | `forNodeBetween` |
| `packages/domain/src/telemetry/ports.ts` | done | `forRuns` instead of `forNodeBetween` (D-14, logged) |
| `packages/storage/src/diagnostics/run-repository.ts` | done | two queries, batched `IN` |
| `packages/storage/src/telemetry/telemetry-repository.ts` | done | `forRuns`, batched |
| `packages/storage/test/run-repository.int.test.ts` | done | |
| `packages/storage/test/telemetry-repository.int.test.ts` | done | |
| `apps/mobile/src/application/export/ports.ts` | done | |
| `apps/mobile/src/application/export/schema.ts` | done | key refinement skips `null` (logged) |
| `apps/mobile/src/application/export/export-controller.ts` | diverged | `open` keeps state across visits, so D-10 "every open starts from that default" does not hold (R1); concurrent `open` bug still present (R2) |
| `apps/mobile/src/application/export/presenter.ts` | done | |
| `apps/mobile/src/application/export/schema.test.ts` | done | |
| `apps/mobile/src/application/export/export-controller.int.test.ts` | done | canary test is real (login frame checked to carry it) |
| `apps/mobile/src/application/export/presenter.test.ts` | done | |
| `apps/mobile/package.json`, `pnpm-lock.yaml` | done | pinned versions from tech-stack |
| `apps/mobile/app.json` | done | `expo-sharing` plugin (logged) |
| `apps/mobile/src/platform/export-files.ts` | done | `create({ overwrite: true })` (logged) |
| `apps/mobile/src/composition/index.ts` | done | `redactionDefault: async () => true` |
| `apps/mobile/src/app/export/[id].tsx` | done | |
| `apps/mobile/src/app/_layout.tsx` | done | |
| `apps/mobile/src/app/node/[id].tsx` | done | button under run panel (logged) |
| `apps/mobile/src/i18n/en.json`, `catalog.test.ts` | done | |
| `apps/mobile/e2e/export-report.yaml` | done | back-stack checked |
| `context/changes/export-report/evidence/*` | done | screenshots < 300 KB |
| `context/test-plan.md` | done | TR-09 / TR-10 and mutation rows |
| `context/changes/export-report/plan.md` | done | |
| `apps/mobile/e2e/diag-responded.yaml`, `guest-password.yaml`, `guest-password-admin.yaml` | unplanned | header-height lesson, logged `[minor]` |
| `apps/mobile/src/application/diagnostics/run-controller.int.test.ts`, `nodes/node-history.int.test.ts` | unplanned | new port methods on test doubles, logged |
| `apps/mobile/src/components/ui/icons.tsx`, `application/diagnostics/presenter.ts` | unplanned | `download` icon, logged |
| `stryker.targets` | unplanned | new targets, logged |
| `context/roadmap.md`, `plan-review.md`, `mutation.md` | unplanned | workflow artifacts |

## Areas
| Area | Result | One-line reason |
|------|--------|-----------------|
| Correctness | fail | a second visit to Export reuses the old data, range end and the "Full public keys" choice (R1) |
| Design | ok | domain stays dependency-free; schema at the app boundary; range rule in one query |
| Safety | concern | redaction-off survives leaving the screen, against D-10 / D-08 privacy default (R1); CSV injection, canary and key redaction are covered |
| Tests | concern | the test pins the stale-reuse behaviour as intended; mutation `bug` still open (R2); weak 7-day assertion in e2e (R4) |
| Simplicity | ok | small, cohesive modules |
| Plan fidelity | concern | D-10 not met (R1); plan-review finding 7's "tap Share twice" check was not added (R3) |
| Agent decisions | ok | D-1, D-2, D-7 live in `report.ts`, `serialize.ts`, `schema.ts` plus golden files, as the plan claims |

## Findings
### R1: Export screen reuses the previous visit's data, range and "Full public keys" choice
- Severity: blocker
- Where: `apps/mobile/src/application/export/export-controller.ts:75-83`, `apps/mobile/src/app/export/[id].tsx:39-41`
- Problem: `exporter` is a singleton in `composition/index.ts`, and the screen never resets it on unmount. `open(publicKey)` returns early whenever `state.publicKey === publicKey && status !== "error"`. So after Export → back → Export for the same node (for example after running a new diagnostic), the controller does not read again. The preview shows the old counts, the range still ends at the clock time of the first visit (the new run is not in the file), and `days`, `format` and `redactKeys` keep the earlier values. If the user turned on "Full public keys" and left, the next export of that node starts with full keys. That contradicts D-10 ("Every open starts from that default, and the switch changes only the current export") and the redaction-by-default rule (D-08, TR-10). The test `open with the same key keeps the user's choices` (`export-controller.int.test.ts:207-215`) pins this behaviour, with `redactKeys: false` kept. The node screen reloads its history on every mount (`app/node/[id].tsx:72-74`); the export screen does not.
- Fix: keep remount idempotence but reset per visit: add `close()` to `ExportController` (clear `publicKey`, bump `seq`, back to `initial(null)`) and call it from the screen's `useEffect` cleanup, so the next navigation starts with defaults and a fresh read. Change the test to: same key while the screen is open keeps choices; `close()` then `open()` resets to 30 days / JSON / `redactionDefault()` and reads runs saved since. Alternative: always re-read on `open` (fresh range end) but keep choices, which still leaves the redaction switch sticky and so needs an explicit reset of `redactKeys` anyway.
- Effort: small
- Lesson candidate: When a singleton controller backs a stack screen, reset its per-visit state on unmount; "idempotent open" protects remounts, not new visits.
- Decision: fixed (df4e877)

### R2: Two `open()` calls at once on a new key start two reads (mutation `bug`, still present)
- Severity: blocker
- Where: `apps/mobile/src/application/export/export-controller.ts:75-83,144-153`
- Problem: `open` compares against `state.publicKey`, which `begin` sets only after `await this.ports.redactionDefault()`. A second `open(K)` in that window (React StrictMode's double effect, or a quick remount) sees the old key, ignores `opening` and starts another `begin`/`read`. `mutation.md` records this as a `bug` and `plan.md` as a `[REVIEW]` deviation; it was not fixed. The later read wins by `seq`, so the visible damage is small (local DB only), but the review rule treats a recorded mutation bug left in code as a blocker, and it breaks the lesson "make screen-effect calls idempotent".
- Fix: in `open`, record the pending key synchronously (e.g. `this.openingKey = publicKey` and return `this.opening` when `openingKey === publicKey`), or set `publicKey` in the store before awaiting `redactionDefault()`. Add the test the mutation step wrote notes for: two `open(K)` without awaiting → one `nodes.get` / `forNodeBetween` call. Do it together with R1, since both change `open`.
- Effort: small
- Lesson candidate: no (covered by the existing idempotent-open lesson)
- Decision: fixed (df4e877)

### R3: Plan-review finding 7's "tap Share twice" check was not added
- Severity: minor
- Where: `apps/mobile/e2e/export-report.yaml:39-48`, `context/changes/export-report/plan.md` (*Human checks*, *Review response*)
- Problem: plan-review finding 7 asked for `create({ overwrite: true })` plus "an e2e or human step that taps Share twice". The overwrite is in `platform/export-files.ts:255`, but neither the e2e flow nor the human checks share the same range twice, so the overwrite path on a real `expo-file-system` is never exercised. *Review response* says finding 7 was "for phase 4" without saying the check was dropped.
- Fix: after the first `back` in `export-report.yaml`, tap `export-share` again and assert no "Could not create the export file"; or add it to the human checks. Update *Review response*.
- Effort: small
- Lesson candidate: no
- Decision: fixed (b3ef5b4)

### R4: The e2e step after "Last 7 days" does not prove the range changed
- Severity: minor
- Where: `apps/mobile/e2e/export-report.yaml:33-35`
- Problem: after `tapOn: export-days-7` the flow asserts `.*runs and .* telemetry samples.*`, which the 30-day text ("6 runs and ...") already matches. The voltage-history seed puts all six runs within 72 h (`apps/mobile/src/debug/voltage-seed.ts:5,48`), so the count is the same for 7 and 30 days anyway. The step passes even if `setDays` does nothing on the device. The same pattern as the lesson "assert an element only that state renders".
- Fix: assert something only the 7-day state renders: the `export-days-7` option selected (accessibility state), or the range line's start date. Counts only differ if a run older than 7 days is seeded.
- Effort: small
- Lesson candidate: no
- Decision: fixed (b3ef5b4)
