# feat(run-diagnostic): run a diagnostic on a node, cancel it, and read an honest stored result

Roadmap S-04: from the node screen the user can tap **Run diagnostic** (guest login with an empty password, then status, then telemetry when supported), watch the current step and "Attempt n of m", and cancel. Every run and each of its checks is stored. The result follows the FR-06 taxonomy and the best-evidence rule, and the run screen `/run/[id]` explains it (checks, evidence, limitations, possible causes, next steps). Radio hygiene is built in: single-flight, a 60 s per-node cooldown with a countdown, bounded timeouts and attempts, a remembered airtime notice, and nothing sent without a tap. Covers PRD FR-05, FR-06, FR-09, FR-10, FR-11.
Closes #5

> **Status:** Ready for review

## ⚠ Needs your decision
- **[REVIEW] D-19:** a link lost after the node already replied is stored `RESPONDED` (with a `LINK_LOST` limitation), while PRD FR-06 AC2 says a disconnect "during the run" is `TRANSPORT_UNAVAILABLE`. The code follows the roadmap's best-evidence rule. Alternative: **B** `TRANSPORT_UNAVAILABLE`/`LINK_LOST`. Switching costs: one branch in `classifyRun` (`packages/domain/src/diagnostics/classify.ts`), the `diag-drop` e2e flow and its tests. ([plan](context/changes/run-diagnostic/plan.md#decisions))
- **[REVIEW] D-3:** a cancel after the node already replied is stored `NOT_TESTED`/`CANCELLED` (PRD FR-05 AC3), which overrides the roadmap's "`RESPONDED` if the node replied to any check". The reply stays stored and listed, but the node's status reads "Last test cancelled". Alternative: **B** best evidence wins (`RESPONDED` with a `CANCELLED` limitation). Switching costs: one branch in `classifyRun` plus tests.
- **D-1 and D-8 (costly, stored values):** the reason vocabulary (`REASONS_BY_RESULT` in domain, not constrained in SQL) and the schema (`0002_diagnostics.sql`: `diagnostic_runs` + `diagnostic_checks`). Alternatives: D-1 B one flat reason list, C a SQL `CHECK` on reason (needs a table rebuild per new reason); D-8 B one runs table with a JSON array of checks. Switching costs: the domain constant, the migration and the repository.
- **D-2:** the run stops at the first check that did not reply (a silent login means status is never tried). Saves airtime, gives less evidence. Alternative: try every check.
- **D-14:** the airtime notice is shown once and remembered for good; the PRD says "first diagnostic of a session". Alternative: once per session, not persisted.
- **D-4:** timeout is the estimate × 2, clamped to 5–30 s; only direct-path samples exist (flood paths unknown). Alternative: × 1.5.

Reply in a review comment, e.g. `D-3: take B`, `D-19: take B`, `drop the lessons commit`,
then run `.claude/workflow/address-pr <PR number>`.

## Human checks
- [ ] (Phase 6) On a phone with the CI APK (`android-apk` artifact) connected to the real companion: open a repeater or room server, tap **Run diagnostic**, accept the airtime notice, and check that it ends "Responded" with a battery voltage that matches the node; note the per-check timeouts shown on the run screen for `docs/compatibility.md`. Evidence: none (emulator reference: [diag-responded-details.png](context/changes/run-diagnostic/evidence/diag-responded-details.png))
- [ ] (Phase 6) Same phone: start a run and tap **Cancel** during "Attempt 1 of 2"; the result reads "Check cancelled" and the button counts down to re-enable. Evidence: none (emulator reference: [diag-cancel-progress.png](context/changes/run-diagnostic/evidence/diag-cancel-progress.png))
- [ ] (Phase 6) Read the run screen texts for `RESPONDED` and `NO_RESPONSE`: are explanation, possible causes and next steps clear, and do they avoid claiming a cause? Look at [diag-responded-details.png](context/changes/run-diagnostic/evidence/diag-responded-details.png) and [diag-no-response-details.png](context/changes/run-diagnostic/evidence/diag-no-response-details.png)
- [ ] (Phase 6) With TalkBack on (Settings > Accessibility > TalkBack), the Dashboard row reads the status words (e.g. "Responded 2 minutes ago"), not only the glyph, after a run. Evidence: none

Other screenshots: `evidence/diag-*-card.png` (responded, no-response, unsupported, malformed, transport-drop); e2e log: [e2e-run.log](context/changes/run-diagnostic/evidence/e2e-run.log).

## Other decisions made by the agent (cheap to change)
| ID | Question | Chosen | Alternatives |
|----|----------|--------|--------------|
| D-5 | Companion never confirms the send | Wait 5 s for `sent`, then `TRANSPORT_UNAVAILABLE`/`COMPANION_NO_ACK`, no retry | One timer from the write (blames the remote path); retry the write |
| D-6 | Which outcomes are retried | Only a `NO_REPLY` after `sent` | Also retry malformed replies |
| D-7 | Cooldown | Runs that wrote ≥ 1 request start 60 s; UI from stored run, `MeshClient` also enforces | Every run counts; UI only |
| D-9 | Correlating replies | Key prefix (12 hex) + reply kind fits the check; unrelated malformed pushes ignored | Fail on any malformed frame |
| D-10 | `MeshClient` API | `runChecks(...)` holds the busy flag for the whole run; `BusyError` subclass of `Error` | One call per check; return the classified run |
| D-11 | Unknown errors | `NOT_TESTED`/`UNEXPECTED_ERROR` | `TRANSPORT_UNAVAILABLE` |
| D-12 | Where progress/result appear | Node screen run panel + result card; `/run/[id]` for details | Navigate on start; everything on the node screen |
| D-13 | When Run is disabled | `runButton()` presenter, priority order with texts | Keep enabled and store a `NOT_CONNECTED` run |
| D-15 | Status line and relative time | `lastRunStatus` in domain; i18next plurals; text glyphs hidden from a11y | Absolute timestamps; icon library |
| D-16 | Login password until S-05 | `GuestPasswordSource` port wired to `""` | Hard-code in `MeshClient` |
| D-17 | Fake remote replies | `remote-script.ts` built byte for byte from `remote.json` | Extend S-03 contacts frames; hand-written frames |
| D-18 | Policy before S-09 | `DEFAULT_DIAGNOSTIC_POLICY` (2 attempts) behind a port | Read from kv store now |

Details and reversal costs: [plan.md#decisions](context/changes/run-diagnostic/plan.md#decisions).

## Quality
- Gates: typecheck ok, lint ok, unit tests ok (953/953), e2e ok (15/15 on `guardian`), mutation `run-controller.ts` ok (96.57 %, 197 killed / 7 survived).
- Review: APPROVE, round 5 ([review.md](context/changes/run-diagnostic/review.md)): 6 findings (1 blocker, 2 major, 3 minor), 6 fixed, 0 deferred, 0 rejected. R1 companion identity lost on link drop; R2 PRD/roadmap overrides not logged (docs); R3 sync/run busy texts; R4 run kept sending in the background; R5 run limitations not shown; R6 stale `mutation.md` and a surviving `appState` mutant.
- Plan review: READY WITH NOTES; notes 2–4 answered in *Review response*.
- Mutation ([mutation.md](context/changes/run-diagnostic/mutation.md)): `classify.ts` 97.7 → 100 %, `rules.ts` 62.0 → 100 %, `run-controller.ts` 73.0 → 96.6 %, `mesh-client.ts` 87.8 → 94.3 %, `companion-session.ts` 81.5 → 82.5 %, `check.ts`/`cooldown.ts` 100 %, `timeout.ts` 89.1 %, `retry.ts` 96.3 %. `bug` mutants: none. Note: the `mutation.md` row for `run-controller.ts` says 190 killed; Stryker reports 197 (score and survivor count match).
- Proposed lessons (commit `4d20776`, drop it to reject): "Capture the context a stored record needs when the operation starts…"; "Give every plan-review finding a line in *Review response*, and log a PRD or roadmap conflict as a `[REVIEW]` deviation…".

## Follow-ups
None. `[minor]` deviations (RangeError in `runChecks`, unsupported status check stored in a preflight run, `diag-drop`/`diag-unsupported`/`diag-malformed` adjusted to the classification rules, e2e scroll/`connect-diag.yaml`, `use-now.ts`, sync `BUSY` failure, cancel on background, limitations on the run screen) are listed in [plan.md#deviations](context/changes/run-diagnostic/plan.md#deviations).

## Commits
```
f913ff8 docs(run-diagnostic): review
5fc3c22 docs(run-diagnostic): triage review round 4
6b2faef fix(run-diagnostic): test that an active appState event leaves a run alone, refresh mutation.md (R6)
5a939ff docs(run-diagnostic): review
abb41a5 docs(run-diagnostic): pr-body
ff60181 docs(run-diagnostic): review
5128015 docs(run-diagnostic): review
62c69e0 docs(run-diagnostic): triage review round 1
4d20776 docs(run-diagnostic): propose lessons
2cf816b fix(run-diagnostic): cancel a run in flight when the app goes to the background (R4)
80926fd fix(run-diagnostic): show the run's own limitations on the run screen (R5)
e42376e fix(run-diagnostic): say which activity is busy when a sync and a run collide (R3)
ed4a1bb fix(run-diagnostic): keep the companion identity when the link drops during a run (R1)
04f004a docs(run-diagnostic): review
ee19a95 docs(run-diagnostic): mutation
23fa32d test(run-diagnostic): strengthen assertions from mutation check
9a0d34f feat(run-diagnostic): node and run screens, fake scenarios and e2e flows
030efd5 feat(run-diagnostic): run controller, presenter, catalog and composition
11b6781 feat(run-diagnostic): MeshClient.runChecks and remote scripts
7e31ead feat(run-diagnostic): storage for diagnostic runs and checks
8fc5f59 feat(run-diagnostic): classify runs, rule table and last-run status
5eb10de feat(run-diagnostic): domain reason codes, check model and radio policies
18acf56 docs(run-diagnostic): plan-review
4c16f01 docs(run-diagnostic): plan
```

<details><summary>Run</summary>

Latest runner pass (18:49–19:11): review round 1 APPROVE WITH FOLLOW-UPS (1 open finding, $0.47) → fix-review ($0.29, 16 turns) → review round 2 APPROVE, 0 open ($0.57). Phases ticked 6/6; failed step: none; draft reason: none. An earlier pass (13:35–13:46) stopped at fix-review because the claude steps exited non-zero with 0 turns; that is superseded by the later pass. Further review rounds (3–5) re-checked the fixes and re-ran all gates.
</details>
