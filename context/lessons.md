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

## When a filter narrows data to "the last operation", test a partial last operation from the same source, not only one from a different source
- Why: a filter on the last sync time hid every repeater a partial sync from the same companion did not report, and the card claimed there were none.
- Seen in: nearest-repeater, R2
- Scope: `packages/domain/**`, `apps/mobile/src/application/**`
- Status: proposed in the PR for nearest-repeater

## When a change adds height above a shared list, grep every e2e flow for assertions on that list's rows and run the full suite before committing the phase
- Why: one flow was missed and the e2e gate failed at review.
- Seen in: nearest-repeater, R1
- Scope: `apps/mobile/e2e/**`, `apps/mobile/src/app/**`
- Status: proposed in the PR for nearest-repeater

## When a PR decision changes visible text or layout, re-take every evidence screenshot that shows it in the same commit
- Why: stale screenshots make the human check approve wording and layout that no longer ship
- Seen in: nearest-repeater, R6
- Scope: `context/changes/*/evidence/`, e2e flows with `takeScreenshot`
- Status: proposed in the PR for nearest-repeater

## When you build navigation with expo-router `navigate`, check the resulting back stack in an e2e flow
- Why: `navigate` pushes unless the target is the current route, so custom tab bars silently grow the stack and Android back walks through earlier tabs.
- Seen in: app-look, R1
- Scope: `apps/mobile/src/components/ui`, `apps/mobile/e2e`
- Status: proposed in the PR for app-look

## When an e2e step asserts that a screen scrolls, run it in a state where the target is below the fold
- Why: `scrollUntilVisible` passes without scrolling when the element is already visible, so the step guarded nothing.
- Seen in: app-look, R5
- Scope: `apps/mobile/e2e/**`
- Status: proposed in the PR for app-look

## When a flat-config block narrows a restricted-imports rule, restate every entry of the broader block and add a layer-rules case for each one
- Why: flat config replaces the rule options of the earlier block, so an omitted entry silently stops applying.
- Seen in: guest-password, R2
- Scope: `eslint.config.mjs`, `tooling/lint/layer-rules.test.ts`
- Status: proposed in the PR for guest-password

## Never render an empty-data message ("none recorded") from the default values of a loading or error state
- Why: the screen claims something about the node that the app does not know, e.g. "No response recorded" after a failed storage read.
- Seen in: node-details-telemetry, R2
- Scope: `apps/mobile/src/app`, `apps/mobile/src/application`
- Status: proposed in the PR for node-details-telemetry

## When a component that renders relative time is reused for a stored record, pass the real "now" and test it with a record older than a minute
- Why: passing the record's own time as "now" gives age 0, so every old record reads "just now".
- Seen in: node-details-telemetry, R1
- Scope: `apps/mobile/src/application`, `apps/mobile/src/components`
- Status: proposed in the PR for node-details-telemetry
