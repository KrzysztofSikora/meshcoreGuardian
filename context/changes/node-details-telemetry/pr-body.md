# feat(node-details-telemetry): node details with latest telemetry and recent runs

Roadmap S-06 (`node-details-telemetry`, FR-07, FR-08). Every responded status or telemetry check of a diagnostic run is now stored as a telemetry sample (schema v4, written in the run's transaction, with unit, measured time and source command and run). The node screen shows name, role, last response, latest telemetry with units ("N/A" for a missing value, never 0), RSSI/SNR labelled as the node's last hop and not end-to-end link quality, and the newest 50 runs in a virtualised list that opens the run screen. After a force-stop and reopen the same runs and samples appear. Runs stored before v4 get their samples from stored evidence at app start. Covers FR-07 AC1-AC3, FR-08 AC1, AC3 and, partly, AC2 (no voltage chart, see D-8).
Closes #7

> **Status:** Ready for review

## ⚠ Needs your decision
- **[REVIEW] D-8:** PRD FR-08 AC2 lists "the voltage chart" on node details; the roadmap gives the chart to S-07 (FR-12). This change ships without it and without a placeholder, so FR-08 AC2 is complete only when S-07 lands. Alternative: build the chart here, pulling S-07 scope forward.
- **D-5 (costly):** 0 mV battery reading is stored as null and shown "N/A" → chose **0 mV = not measured**. Alternative: keep it as 0 V (literal, but AC2 forbids 0 for a missing value). Meaning is inferred, `UNVERIFIED`; raw value stays in run evidence. Switching costs: the mapping in `packages/domain/src/telemetry/samples.ts` plus a migration/backfill for stored rows.
- **D-6 (costly):** RSSI/SNR get scope `last_hop` and the wording "last hop into the node" plus the note "Measured by the node on the last packet it received. Not end-to-end link quality." The scope is `UNVERIFIED` on hardware and the wording settles FR-07 AC3. Alternative: scope `unknown` for everything until verified. Switching costs: mapping, i18n strings, presenter tests.
- **D-1 (costly):** one sample row per responded status or telemetry check (typed nullable columns plus `extra_json`). Alternatives: one merged row per run; one row per value (EAV). Switching costs: migration `0004_telemetry.sql`, repository, backfill.
- **D-3 (costly):** backfill runs at every app start, writes derived rows, and a failure is caught so it cannot block start. Alternatives: SQL backfill inside the migration (second copy of the mapping); no backfill (old runs show no telemetry). Switching costs: `backfill.ts`, `open-guardian-db.ts`.
- **Review leftovers:** none open (R1-R4 fixed).

Reply in a review comment, e.g. `D-5: take B`, `drop the lessons commit`, then run `.claude/workflow/address-pr <PR number>`.

## Human checks
- [ ] (Phase 4) Real hardware (CI APK `android-apk`, companion + Room K): run a diagnostic on Room K, open the node; battery voltage, uptime, RSSI/SNR and temperature match the run screen's evidence, each group shows "From the run of <time>" and a measured time. Run: install the CI APK, Run diagnostic on Room K, back to the node screen. Evidence: [node-details-telemetry.png](context/changes/node-details-telemetry/evidence/node-details-telemetry.png) (emulator, fake transport)
- [ ] (Phase 4) Same phone: force-stop the app (Android App info → Force stop), reopen, open Room K: same telemetry and the run in "Recent runs". Evidence: [node-details-after-restart.png](context/changes/node-details-telemetry/evidence/node-details-after-restart.png) (emulator)
- [ ] (Phase 4) Wording (D-6): read the last-hop labels and the note; they must not read as end-to-end link quality. Run: open the node screen after a run. Evidence: [node-details-telemetry.png](context/changes/node-details-telemetry/evidence/node-details-telemetry.png)
- [ ] (plan-review 8, D-5) On a node without a battery ADC, confirm that 0 mV means "not measured" and shows "N/A".

## Other decisions made by the agent (cheap to change)
Full table with reasons: [plan.md#decisions](context/changes/node-details-telemetry/plan.md#decisions).

| ID | Question | Chosen | Alternatives |
|----|----------|--------|--------------|
| D-2 | Where samples are written | `SqliteDiagnosticRunRepository.save`, in the run's transaction | Controller calls a second repository; derive at read time |
| D-4 | Measured-at time | `check.startedAt + durationMs`, fallback `run.finishedAt` | `run.finishedAt` for all; node clock |
| D-7 | "Latest telemetry" | Samples of the newest run that has any, grouped by source | Newest value per field across runs |
| D-9 | Recent runs list | `FlatList` of newest 50, no paging | `onEndReached` paging; nested list |
| D-10 | Order on node screen | Identity → panel → telemetry → edit cards → recent runs | Recent runs right after telemetry |
| D-11 | "Last response" | `finished_at` of newest `RESPONDED` run | Newest sample time; latest run chip |
| D-12 | Loading and refresh | `NodeHistoryController.load`, shared in-flight read, no timers | History in `RunController`; timer reload |
| D-13 | e2e | Extend `diag-responded.yaml` incl. restart | New flow |
| D-14 | Display formats | Voltage 2 decimals, uptime "d h min", SNR 2 decimals | Raw seconds |
| D-15 | Mutation targets | `samples.ts` and `history-presenter.ts` added to test plan | Domain file only |

## Quality
- Gates: typecheck ok, lint ok, unit tests ok (74 files, 1310 tests), e2e `E2E_RESULT` (round 2 of [review.md](context/changes/node-details-telemetry/review.md)).
- Review: APPROVE WITH FOLLOW-UPS, round 2: fixed 4 (R1 blocker "Responded just now" on old rows; R2 failed read shown as empty data; R3 partial-run/missing group and empty *Review response*; R4 "No reply" for a check never sent, now neutral text), deferred 0, rejected 0.
- Mutation: `samples.ts` 97.2% → 100%, `history-presenter.ts` 95.8% → 99.5%, `node-history.ts` 73.5% → 97.1%, `lpp.ts` 100%; `bug` mutants: none (2 equivalent survivors). Storage files not mutated, covered by integration tests. See [mutation.md](context/changes/node-details-telemetry/mutation.md).
- Plan review: READY WITH NOTES, 8 findings, each answered in *Review response* ([plan-review.md](context/changes/node-details-telemetry/plan-review.md)).
- Proposed lessons (drop commit `60ef6dc` to reject): "Never render an empty-data message from the default values of a loading or error state"; "When a component that renders relative time is reused for a stored record, pass the real now and test it with a record older than a minute".

## Follow-ups
- Voltage chart on node details (FR-08 AC2) arrives with S-07.
- `node-history.ts` is not in the test-plan *Mutation targets* table; its keep-previous-data reload state is user-visible (mutation.md).
- Mutation lesson proposed in mutation.md, not committed to `context/lessons.md`: "When a controller keeps previous data while reloading, test the state during the pending read, not only the final state."
- Stryker dry run prints two `✘ en catalog ... (covered 0)` lines for the presenter and controller; not failures and not caused by this change.
- Unverified on hardware: repeater telemetry, other LPP types, `last_hop` scope; meshcore.js stops parsing at the first unsupported LPP type (rest stays in `lppHex`).

## Commits
```
b54b5c1 docs(node-details-telemetry): triage review round 2
9f190af fix(node-details-telemetry): neutral text for a source missing from the run (R4)
e9d4fd8 docs(node-details-telemetry): review
68e8ffd docs(node-details-telemetry): triage review round 1
60ef6dc docs(node-details-telemetry): propose lessons
7529a97 fix(node-details-telemetry): run row age, load/error states, missing telemetry group (R1, R2, R3)
dae4c49 docs(node-details-telemetry): review
0174448 docs(node-details-telemetry): mutation
965370b test(node-details-telemetry): strengthen assertions from mutation check
5d9f5da feat(node-details-telemetry): node details screen with telemetry and recent runs
4d5cc25 feat(node-details-telemetry): node history controller and telemetry presenter
d584afa feat(node-details-telemetry): schema v4, sample storage and backfill
622e325 feat(node-details-telemetry): map responded checks to telemetry samples in the domain
9a3d5bb docs(node-details-telemetry): plan-review
bc5836b docs(node-details-telemetry): plan
```

<details><summary>Run</summary>

Branch `change/node-details-telemetry`, base `main`, no stops. Failed step: none; draft reason: none. Phases ticked 4/4.

| Step | Attempts | Cost |
|------|----------|------|
| plan (opus) | 1 | $1.91 |
| plan-review (opus) | 1 | $0.59 |
| implement (sonnet, 4 sessions) | 1 each | $0.31 + $0.51 + $0.54 + $0.72 |
| mutation (sonnet) | 1 | $0.36 |
| review round 1 (opus) | 1 | $1.65 |
| fix-review (sonnet) | 1 | $0.59 |
| review round 2 (opus) | 1 | $0.70 |
| fix-review (sonnet) | 1 | $0.12 |

Total: about $8.00 (pr-body step not included). Emulator/Gradle processes left by three sessions were stopped by the runner.
</details>
