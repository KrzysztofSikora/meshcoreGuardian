# Lessons

Rules from reviews. Binding for planning, implementing and reviewing once accepted at a PR.

## In a shell cleanup trap, signal a started child by PID before you `wait` on it
- Why: cleanup that relies on another tool (e.g. `adb emu kill`) to stop the child hangs forever in `wait` when that tool cannot reach it, so a timeout path never exits.
- Seen in: repo-skeleton, R1
- Scope: `scripts/**`, CI shell steps
- Status: proposed in the PR for repo-skeleton
