# feat(battery-history): battery voltage chart and honest trend on node details

Roadmap item S-07 (FR-12). The node details screen now has a "Battery voltage (V)" card under *Latest telemetry*: a line chart with one point per run on a real time axis, a "Show values" list with every point's local time, value and source (AC1), and a trend line. With fewer than 5 points or under 24 h of span it reads exactly "Not enough data to determine trend" (AC2, A-01); above that it says falling / rising / stable with the fitted change, span and sample count. No prediction appears anywhere, in types or strings (AC3). A node that answered without any voltage shows "Voltage not available from this node" (AC4). This completes the voltage chart that FR-08 AC2 lists for node details.
Closes #8

> **Status:** Ready for review

## ⚠ Needs your decision
- **D-6 (costly):** new runtime dependency `react-native-gifted-charts` **1.4.81** (exact pin, as in the tech stack), imported only by `apps/mobile/src/components/voltage-chart.tsx` through the undocumented deep path `react-native-gifted-charts/dist/LineChart`, so no gradient package is needed. Alternatives: B: also add `expo-linear-gradient` and use the package root (a second native module and a rebuild for a gradient we never draw); C: hand-written chart on `react-native-svg` (~100 lines, no new dependency, departs from the tech-stack choice). Switching costs: one file, `voltage-chart.tsx`. The deep import type-checks, bundles and runs in the emulator e2e; it is unproven on a real phone.
- **D-1 (reads an AC):** FR-12 AC1 says "each sample"; I read it as one point **per run** (status voltage, else telemetry), so a run that answered both requests is not drawn twice and counts once towards the 5-sample threshold. Alternative B: every voltage sample, both sources. Switching costs: `voltagePoints` in `packages/domain/src/telemetry/voltage.ts` and the tests around it.
- **D-5 / AC4 depends on an `UNVERIFIED` rule:** a node that reports 0 mV is treated as "no voltage" (S-06 D-5), so it shows "Voltage not available from this node". Not confirmed on a repeater. AC4 has no e2e (it would need a doctored fixture); it is proved at presenter and integration level (D-10).
- **Review leftover R5 (minor, deferred):** commit `b9cd62d` has no `Refs #8`. History is not rewritten; later commits carry it. Reword when squashing if you care.

Reply in a review comment, e.g. `D-6: take C`, `R5: fix it`, `drop the lessons commit`, then run `.claude/workflow/address-pr <PR number>`.

## Human checks
- [ ] (Phase 4) Two diagnostics on Room K at least 60 s apart, then open the node: the voltage card shows 2 points, "Not enough data to determine trend", and "Show values" lists both runs with local time, V and source matching the run screens. Run: CI APK (`android-apk`) on a real phone with companion + Room K. Evidence: none
- [ ] (Phase 4) Look of the voltage card in light and dark and at 200 % font size: chart not clipped, axis labels readable, rows wrap without overlap. Run: CI APK, system theme and font settings. Evidence: [`battery-one-sample.png`](context/changes/battery-history/evidence/battery-one-sample.png) (emulator, light, one point; retaken after the chart fixes)
- [ ] (Phase 4) TalkBack on the voltage card: the chart reads its summary (count, time range, min/max V); "Show values" announces as a button with expanded state. Run: CI APK on a real phone, TalkBack on. Evidence: none
- [ ] (Phase 5) Wording (D-4): "Trend: falling, about −0.10 V over 2 d 22 h (6 samples)" reads as a measurement, not a forecast, and nothing on the card suggests remaining battery life (AC3). Run: fake build `EXPO_PUBLIC_TRANSPORT=fake pnpm --filter mobile android`, connect, open `guardian://debug/seed/voltage-history`. Evidence: [`battery-trend.png`](context/changes/battery-history/evidence/battery-trend.png)
- [ ] (Phase 5) Chart shape (D-7): the six seeded points are spread by time, not evenly. Run: same as above. Evidence: [`battery-trend.png`](context/changes/battery-history/evidence/battery-trend.png)

## Other decisions made by the agent (cheap to change)
Full table with reasons: [plan.md#decisions](context/changes/battery-history/plan.md#decisions).

| ID | Question | Chosen | Alternatives |
|----|----------|--------|--------------|
| D-2 | How much history? | Newest 50 runs with a voltage reading, oldest → newest; trend uses the same points | Last 30 days; all history |
| D-3 | Trend rule | Least-squares line, fitted change = slope × span; under 0.05 V → stable | Last minus first; change only, no word |
| D-4 | Trend wording | AC2 sentence verbatim + muted counts; "Trend: falling, about −0.06 V over 3 d 4 h (n samples)" | AC2 sentence only; judgemental words |
| D-5 | Card states | Not loaded → nothing; error → existing alert; no samples → "No voltage recorded yet."; samples without voltage → AC4 text | AC4 text also with no samples; AC4 only after a status reply |
| D-7 | x axis | Points spaced in proportion to time (min 6 px); labels on first and last point only | Equal spacing; a label per point |
| D-8 | AC1 timestamp + unit, NFR-05 | Title and y labels carry the unit; chart has an accessible summary; collapsed "Show values" list (button with expanded state) | List always open; tap a point |
| D-9 | Position | Directly after *Latest telemetry* | After the edit cards |
| D-10 | e2e | Extend `diag-responded`; new flow `battery-history` with fake-only seed route `guardian://debug/seed/voltage-history`; no AC4 e2e | No seed route; doctored fixture for AC4 |
| D-11 | AC3 guard | Trend type has no prediction fields (key-pinning test) + catalog test banning battery-life words | Rely on review |
| D-12 | Mutation targets | `packages/domain/src/telemetry/voltage.ts` (replaces `trend.ts`) and `voltage-presenter.ts` | Domain only |

## Quality
- Gates: typecheck, lint, unit tests, mutation ok. e2e was 20/21 in review round 2 (`diag-responded`, R6); R6 was fixed in `82d09b6` and the evidence was retaken from a green `pnpm e2e` (21/21) in `dad4e9f`. The review file itself has no gate re-run after those two commits; the 21/21 is from [plan.md](context/changes/battery-history/plan.md#review-response).
- Review: CHANGES REQUESTED in round 2, 0 open findings after fix-review. Round 1: R1 (major, chart clipped), R2 (major, vacuous list assertion), R3, R4 fixed, R5 deferred. Round 2: R6 (blocker, off-screen row in e2e), R7 (stale evidence) fixed. Rejected: none. Plan review: READY WITH NOTES; its 7 notes were taken or answered by fixes (seed route repository, list assertion, seed times, band tests, seed idempotence).
- Mutation: 84.9 % → 88.1 % (`voltage.ts` 85.2 %, `voltage-presenter.ts` 89.5 %; target 80 %). `bug` mutants: none; survivors are `equivalent` or `accept`, listed in [mutation.md](context/changes/battery-history/mutation.md).
- Proposed lessons (commit `3f238bc`, drop it to reject): "When a chart library adds its own padding, subtract it from the width the geometry is computed for, and check the evidence screenshot at both ends of the axis"; "When an e2e step asserts a value that appears in a list, assert an element only that list renders". Mutation also proposes: clear `reports/stryker-incremental.json` before re-running mutation after test-only changes (not yet in `lessons.md`).

## Follow-ups
- [minor] `ChartModel.yLabels` is only used by the presenter tests and the summary (gifted-charts ignored `yAxisLabelTexts` together with `yAxisOffset`, so the chart uses `showFractionalValues`). Dead weight if the chart is swapped (D-6).
- Stryker's incremental file returns stale statuses after test-only edits; delete `reports/stryker-incremental.json` before a re-run.
- Shorter x axis labels were a follow-up from Phase 4; closed by R1.

Deviations logged as `[minor]` (see [plan.md#deviations](context/changes/battery-history/plan.md#deviations)): three e2e flows (`contacts-sync`, `guest-password`, `guest-password-admin`) needed scroll fixes because the new card adds height; `container.runRepository` was added for the debug seed route.

## Commits
```
146c2e3 docs(battery-history): triage review round 2
dad4e9f fix(battery-history): retake evidence after chart fixes (R7)
82d09b6 fix(battery-history): scroll to the value list row in diag-responded (R6)
9555a2e docs(battery-history): review round 2
6b0756d docs(battery-history): triage review round 1
3f238bc docs(battery-history): propose lessons
0b3d776 fix(battery-history): singular chart summary (R4)
d404f7b fix(battery-history): seed route catches errors and seeds once (R3)
19cb280 fix(battery-history): assert the value list by test id in e2e (R2)
d62042a fix(battery-history): keep chart ends and axis labels inside the view (R1)
1a86ccc docs(battery-history): review
78e7f1d docs(battery-history): mutation
b9cd62d test(battery-history): strengthen assertions from mutation check
2abb86e feat(battery-history): seeded history and the trend flow
1aaad40 feat(battery-history): voltage card on the node screen
ac583f8 feat(battery-history): voltage in node history and the voltage presenter
5b6d2f3 feat(battery-history): voltage readings from storage
b15eecc feat(battery-history): voltage points and trend rule in the domain
6282929 docs(battery-history): plan-review
f933a00 docs(battery-history): plan
```

<details><summary>Run</summary>

Branch `change/battery-history`, base `main`. Failed step: none. Draft reason: none. Plan review: READY WITH NOTES (round 1). Review: round 1 APPROVE WITH FOLLOW-UPS (5 open), round 2 CHANGES REQUESTED (2 open, fixed). Phases ticked 5/5.

| Step | Attempts | Cost |
|------|----------|------|
| plan (opus) | 1 | $2.15 |
| plan-review (opus) | 1 | $0.63 |
| implement ×5 (sonnet) | 1 each | $0.26 + $0.24 + $0.53 + $1.26 + $0.56 |
| mutation (sonnet) | 1 | $0.43 |
| review round 1 (opus) | 1 | $1.84 |
| fix-review round 1 (sonnet) | 1 | $0.40 |
| review round 2 (opus) | 1 | $1.80 |
| fix-review round 2 (sonnet) | 1 | $0.21 |

Total about $10.32 (runner-reported step costs; some steps report 0 turns).
</details>
