# Review: node-details-telemetry

Verdict: APPROVE WITH FOLLOW-UPS
Gates: typecheck ok, lint ok, unit tests ok (74 files, 1310 tests), e2e E2E_RESULT · Round: 2

Round 2 re-checks R1-R3 against `7529a97` (fix), `60ef6dc` (lessons) and `68e8ffd` (triage).

### Round 1 findings
| Finding | Status | Evidence |
|---------|--------|----------|
| R1 | fixed | `recentRunRow(run, formatTime, now)` uses the real `now` (`history-presenter.ts:184`), ticked each minute via `useNow` + `extraData` (`node/[id].tsx:60,83`); unit test with a 3-day-old `RESPONDED` run asserts "Responded 3 days ago"; e2e row assertion now matches the duration text, which only `RunRow` renders bare |
| R2 | fixed | `NodeHistory.loaded` gates the card, last-response line and empty text (`node/[id].tsx:96,130,158`); the error alert is shown at the top of the details; a failed reload keeps the last good data (`node-history.ts:71`) with an int test |
| R3 | fixed, with a new wording problem | *Review response* now has one line per plan-review finding 1-8; the missing source is shown as a group, but its text claims "No reply" also when the check was never sent (R4) |

## Plan vs diff
| File | Status | Note |
|------|--------|------|
| `packages/domain/src/telemetry/samples.ts` | done | D-1, D-4, D-5; total mapping (plan-review 5) |
| `packages/domain/src/telemetry/lpp.ts` | done | 12 types, unknown → unit null |
| `packages/domain/src/telemetry/ports.ts` | done | |
| `packages/domain/src/telemetry/samples.test.ts`, `lpp.test.ts` | done | |
| `packages/domain/src/index.ts` | done | |
| `packages/domain/src/diagnostics/run.ts` | done | `recentForNode`, `lastRespondedAt` |
| `packages/storage/migrations/0004_telemetry.sql`, `src/migrations/generated.ts` | done | matches *Design* |
| `packages/storage/src/diagnostics/evidence.ts` | done | moved, unchanged |
| `packages/storage/src/telemetry/sample-rows.ts` | done | |
| `packages/storage/src/diagnostics/run-repository.ts` | done | samples in the run's transaction |
| `packages/storage/src/telemetry/telemetry-repository.ts` | done | D-7 query |
| `packages/storage/src/telemetry/backfill.ts` | done | loads every check of a run (plan-review 2) |
| `packages/storage/src/index.ts` | done | |
| `packages/storage/test/{telemetry-repository,backfill}.int.test.ts` | done | |
| `packages/storage/test/{run-repository,migrate}.int.test.ts` | done | |
| `apps/mobile/src/application/diagnostics/run-controller.int.test.ts` | done | logged `[minor]` (plan-review 1) |
| `apps/mobile/src/application/nodes/node-history.ts` | done | `loaded` flag; failed reload keeps last good data (R2 fix) |
| `apps/mobile/src/application/nodes/history-presenter.ts` | done | R1 and R3 fixed; the missing-source text overclaims (R4) |
| `apps/mobile/src/application/nodes/{history-presenter.test,node-history.int.test}.ts` | done | |
| `apps/mobile/src/platform/sqlite/open-guardian-db.ts` | done | backfill errors caught (plan-review 4) |
| `apps/mobile/src/composition/index.ts` | done | |
| `apps/mobile/src/i18n/en.json`, `catalog.test.ts` | done | `catalog.test.ts` change logged `[minor]` |
| `apps/mobile/src/app/node/[id].tsx` | done | R2 fixed: data gated on `loaded`, error alert at the top, minute tick for row ages |
| `apps/mobile/src/components/telemetry-card.tsx`, `run-row.tsx` | done | |
| `apps/mobile/src/components/ui/screen.tsx` | absent | not needed: the screen uses `Screen` without `scroll` and owns the `FlatList` (allowed by the plan) |
| `apps/mobile/e2e/diag-responded.yaml` | done | row assertion now matches the duration text only `RunRow` renders (R1 fix) |
| `apps/mobile/e2e/{guest-password,guest-password-admin}.yaml`, `lib/look-screens.yaml` | done | logged `[minor]` |
| `context/test-plan.md` | done | TR-11/TR-16 rows, mutation targets, Cookbook |
| `context/changes/node-details-telemetry/evidence/*.png` | done | 274 KB and 210 KB |
| `context/changes/node-details-telemetry/{plan,plan-review,mutation}.md` | done | |
| `context/roadmap.md` | done | status |

## Areas
| Area | Result | One-line reason |
|------|--------|-----------------|
| Correctness | concern | R1-R3 fixed; a run whose telemetry check was skipped or cancelled says "No reply in this run" (R4) |
| Design | ok | layers respected; one mapping shared by save and backfill; samples atomic with the run |
| Safety | ok | a read failure is now an explicit alert; no empty-data claim from defaults |
| Tests | ok | old responded row, partial run (both directions) and failed reload are tested; mutation decisions plausible |
| Simplicity | ok | small, cohesive modules |
| Plan fidelity | ok | *Review response* covers plan-review findings 1-8 |
| Agent decisions | ok | D-1..D-15 implemented in one place each; D-8 logged as `[REVIEW]` |

## Findings
### R1: Every responded run in "Recent runs" says "Responded just now"
- Severity: blocker
- Where: `apps/mobile/src/application/nodes/history-presenter.ts:250`
- Problem: `recentRunRow` calls `lastRunStatus(run, run.finishedAt)`, so `ageMs = max(0, finishedAt - finishedAt) = 0` for every row. `statusText` (`application/diagnostics/presenter.ts:66-71`) turns a `responded` status with `ageMs` 0 into `diagnostic.status.responded.now` = "Responded just now". A run from three days ago is therefore labelled "Responded just now" in the history list, a false recency claim next to its own (correct) timestamp. The unit test covers only a `NO_RESPONSE` run (no age text), and the e2e step `assertVisible: "Responded.*"` (`diag-responded.yaml:36,54`) would also pass on the wrong text, and on the diagnostic panel chip (plan-review finding 7).
- Fix: give the row a status without an age (`{ kind: "responded", ageMs: null }`, which `statusText` already renders as the plain result word), since the row shows its own time; or pass the real `now`. Add a unit test with a `RESPONDED` run that asserts the rendered status has no "just now", and make the e2e row assertion target text only the row has (its duration or a `testID`).
- Effort: small
- Lesson candidate: When a component that renders relative time is reused for a stored record, pass the real "now" or a status without age; test it with a record older than a minute.
- Decision: fixed (7529a97) + lesson proposed

### R2: A failed history read is shown as "No response recorded" and "No telemetry recorded yet"
- Severity: major
- Where: `apps/mobile/src/app/node/[id].tsx:132-135,154`; `apps/mobile/src/application/nodes/node-history.ts:69`
- Problem: on `status: "error"` the controller stores empty `samples` and `lastRespondedAt: null`. The screen then builds `telemetryCard([])` ("No telemetry recorded yet. Run a diagnostic to get it.") and `lastResponseText(null)` ("No response recorded"), both claims about the node that the app does not know. The only hint of the failure, `telemetry.loadFailed`, is the list's empty component at the bottom, below the edit cards. A failed reload also wipes the data shown before (`{ ...LOADING, status: "error" }`), and during the first load the header already says "No response recorded". This breaks the honest-status rule (CLAUDE.md) on the storage path.
- Fix: when `status` is `"error"`, render the telemetry card and the last-response line as the neutral load-failed text (or hide them and show the error near the top), and keep the previous data on a failed reload; while `"loading"`, show nothing for last response. Add a controller test for a failed reload after a good one.
- Effort: small
- Lesson candidate: Never render an empty-data message ("none recorded") from the default values of an error or loading state.
- Decision: fixed (7529a97) + lesson proposed

### R3: Plan-review findings 3, 7 and 8 have no response, and a newest run without telemetry silently hides the group
- Severity: major
- Where: `context/changes/node-details-telemetry/plan.md` (*Review response* is empty); `apps/mobile/src/application/nodes/history-presenter.ts:221-224`
- Problem: the lesson "Give every plan-review finding a line in *Review response*" is breached: findings 1, 2, 4, 5 and 6 appear only as deviations, and 3, 7 and 8 appear nowhere. Finding 3 asked for a defined display when the newest run has a status sample but its telemetry check got no reply. The repository test was added (`telemetry-repository.int.test.ts:171`), but the presenter just drops the telemetry group. The card then shows only "Status reply" under "From the run of <time>", and the older run's telemetry vanishes with nothing saying telemetry was asked and not answered. Finding 7 (row assertion) is still open (see R1).
- Fix: add a *Review response* line for each plan-review finding. For the partial run, add a telemetry group with a "No telemetry reply in this run" row (and the same for a missing status group), with a presenter test for "status responded, telemetry no response".
- Effort: small
- Lesson candidate: no
- Decision: fixed (7529a97)

### R4: "No reply in this run" is shown for a telemetry check that was never sent
- Severity: major
- Where: `apps/mobile/src/application/nodes/history-presenter.ts:132-139,155-156`; `apps/mobile/src/i18n/en.json` (`telemetry.noReply`)
- Problem: the R3 fix turns any source without a sample into `missingGroup`, commented "The run asked for this source and got no reply". The presenter only sees samples, and `samplesFromChecks` (`packages/domain/src/telemetry/samples.ts`) keeps only `RESPONDED` checks with evidence. So the telemetry group is also missing when the check was `UNSUPPORTED` (`planChecks` stores it as skipped when the companion firmware is below ver code 5, `packages/domain/src/diagnostics/check.ts:85-93`) or `NOT_TESTED`/`CANCELLED` (the user cancelled after the status reply). With a v<5 companion, every run's card says "Telemetry reply · Reply: No reply in this run", which tells the operator the node did not answer something that was never asked. That breaks the honest-status rule (CLAUDE.md) and the proposed lesson on empty-data messages. The new presenter test covers only the shape, not the cause.
- Fix: use neutral wording that is true in every case, e.g. `telemetry.notInRun` = "Not received in this run" (and fix the comment). Alternatively pass the run's check results to `telemetryCard` and word each cause (no reply, not supported by the companion, cancelled); that is more precise but needs the newest run's checks, which `recentForNode` does not load.
- Effort: small
- Lesson candidate: no
- Decision: open

