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
