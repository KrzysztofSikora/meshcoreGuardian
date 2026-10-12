# Lessons

Rules from reviews. Binding for planning, implementing and reviewing once accepted at a PR.

## In a shell cleanup trap, signal a started child by PID before you `wait` on it
- Why: cleanup that relies on another tool (e.g. `adb emu kill`) to stop the child hangs forever in `wait` when that tool cannot reach it, so a timeout path never exits.
- Seen in: repo-skeleton, R1
- Scope: `scripts/**`, CI shell steps
- Status: accepted (PR #13)

## Make screen-effect calls such as `initialize()` idempotent
- Why: a screen that re-runs `initialize()` on every mount reset the Retry target, so Retry did nothing or hit another companion.
- Seen in: connect-companion, R1
- Scope: `apps/mobile/src/application/**`, `apps/mobile/src/app/**`
- Status: proposed in the PR for connect-companion

## Give every port that starts native work an error path
- Why: a callback-only scan API swallowed ble-plx errors and the UI showed "No companions found".
- Seen in: connect-companion, R2
- Scope: `apps/mobile/src/application/**/ports.ts`, `apps/mobile/src/platform/**`
- Status: proposed in the PR for connect-companion

## Do not accept a mutant because the shared fake cannot reach it; write a minimal port double in the test
- Why: "no fake throws that" hid the real BLE write failure path and the frame-kind filter.
- Seen in: connect-companion, R3
- Scope: `packages/meshcore-adapter/test/**`, mutation reviews
- Status: proposed in the PR for connect-companion

## Re-run mutation after the last test change and copy every survivor into `mutation.md`; never mark a mutant `strengthen` without seeing it killed
- Why: five surviving mutants were recorded as killed, so the record hid real gaps (stale timers, listeners left on a closed client).
- Seen in: connect-companion, R5
- Scope: `context/changes/*/mutation.md`, all mutation targets
- Status: proposed in the PR for connect-companion

## Run mutation on every test-plan target file the diff touches; never skip a target because its change looks small
- Why: a "thin" change to `mesh-client.ts` added three timers and a pending handler whose cleanup no test noticed missing.
- Seen in: sync-contacts, R1
- Scope: `context/changes/*/mutation.md`, all test-plan mutation targets
- Status: proposed in the PR for sync-contacts

## Do not let an error mapper's default branch claim a specific cause; unknown errors get a neutral reason
- Why: an unrecognised error was shown as "the Bluetooth link was lost" while the link was fine, which breaks honest status.
- Seen in: sync-contacts, R4
- Scope: `apps/mobile/src/application/**`, `packages/domain/**` failure types
- Status: proposed in the PR for sync-contacts

## Capture the context a stored record needs when the operation starts; never read it from live state after an await that can span a disconnect
- Why: a run that lost the link was saved with an empty companion identity, because the session state was already cleared when the run finished.
- Seen in: run-diagnostic, R1
- Scope: `apps/mobile/src/application/**`
- Status: proposed in the PR for run-diagnostic

## Give every plan-review finding a line in *Review response*, and log a PRD or roadmap conflict as a `[REVIEW]` deviation, not only as an error-model row
- Why: two artifacts were overruled in code and the PR would not have shown the person.
- Seen in: run-diagnostic, R2
- Scope: `context/changes/*/plan.md`
- Status: proposed in the PR for run-diagnostic
