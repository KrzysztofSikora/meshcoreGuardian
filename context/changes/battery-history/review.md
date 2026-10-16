# Review: battery-history

Verdict: CHANGES REQUESTED
Gates: typecheck ok, lint ok, unit tests ok, e2e fail (20/21 flows; `diag-responded` fails, R6), mutation ok (voltage.ts 85.2 %, voltage-presenter.ts 89.8 %; new axis-label mutants all killed, survivors unchanged and decided in `mutation.md`) · Round: 2

Round 2 re-checks the fixes from round 1 (d62042a, 19cb280, d404f7b, 0b3d776). R1, R3 and R4 are fixed. R2's fix fails the e2e gate (R6). R5 stays deferred.

## Plan vs diff
| File | Status | Note |
|------|--------|------|
| `packages/domain/src/telemetry/voltage.ts` | done | D-1 status-over-telemetry per run, A-01 gate, least squares on times relative to the first point, no prediction field |
| `packages/domain/src/telemetry/voltage.test.ts` | done | gate boundaries, band ±0.049/0.051, middle outlier (plan-review #4, #5 taken), key pinning |
| `packages/domain/src/index.ts` | done | exports |
| `packages/domain/src/telemetry/ports.ts` | done | `voltageForNode` contract as designed |
| `packages/storage/src/telemetry/telemetry-repository.ts` | done | one query, newest runs by `MAX(measured_at)`, ties by run id |
| `packages/storage/src/telemetry/sample-rows.ts` | done | Zod row schema |
| `packages/storage/test/telemetry-repository.int.test.ts` | done | all eight planned cases |
| `apps/mobile/src/application/nodes/node-history.ts` | done | `voltage` in the same `Promise.all`, `[]` in `LOADING` |
| `apps/mobile/src/application/nodes/voltage-presenter.ts` | diverged | Design says a single point "is centred by `initialSpacing`"; the chart always uses `initialSpacing = 4`, so one point sits on the y axis (see R1) |
| `apps/mobile/src/application/nodes/voltage-presenter.test.ts` | done | states, D-4 texts, rows, geometry |
| `apps/mobile/src/application/nodes/node-history.int.test.ts` | done | one point per run, AC4 with 0 mV, error keeps data |
| `apps/mobile/src/i18n/en.json`, `catalog.test.ts` | done | D-11 word bans in place |
| `apps/mobile/package.json`, `pnpm-lock.yaml` | done | gifted-charts 1.4.81 exact |
| `apps/mobile/src/components/voltage-chart.tsx` | diverged | y labels via `showFractionalValues` (logged `[minor]`); spacing budget ignores `initialSpacing`/`endSpacing`, so the plot overflows (R1, not logged) |
| `apps/mobile/src/components/voltage-card.tsx` | done | |
| `apps/mobile/src/app/node/[id].tsx` | done | card after telemetry, only from loaded history (D-5, lesson) |
| `apps/mobile/e2e/diag-responded.yaml` | done | as planned, but the planned list assertion is vacuous (R2) |
| `apps/mobile/e2e/contacts-sync.yaml`, `guest-password.yaml`, `guest-password-admin.yaml` | unplanned | logged `[minor]` deviation (added card height) |
| `apps/mobile/src/composition/index.ts` | unplanned | `runRepository` factory for the seed route; logged `[minor]`, answers plan-review #1 |
| `apps/mobile/src/debug/voltage-seed.ts`, `voltage-seed.test.ts` | done | check `startedAt` follows the run and the test goes through `samplesFromChecks` (plan-review #3 taken) |
| `apps/mobile/src/app/debug/seed/[name].tsx` | done | fake-only guard as in `debug/scenario`; see R3 |
| `apps/mobile/e2e/battery-history.yaml` | done | |
| `context/test-plan.md` | done | TR-17 covered, mutation targets renamed/added (D-12) |
| `context/changes/battery-history/evidence/*.png` | done | both under 300 KB |
| `context/roadmap.md` | unplanned | workflow status field |
| `context/lessons.md` | unplanned | two lessons proposed from R1 and R2 (review round 1) |

## Areas
| Area | Result | One-line reason |
|------|--------|-----------------|
| Correctness | ok | round 2: the chart fits its view, so both end points and the short x labels (`10/13` … `10/16`, `4:00 PM`) show in full, and a single point is centred (Maestro screenshots from this run); seeding happens once and catches errors; the summary has a singular form |
| Design | ok | layers respected: domain pure, one storage query, pure presenter, one file imports gifted-charts |
| Safety | ok | no secrets, Zod at the storage boundary, seed route inert outside the fake build |
| Tests | fail | round 2: the new `voltage-row-0` assertion in `diag-responded` fails because the row is below the fold (R6); the committed evidence predates the fixes (R7) |
| Simplicity | ok | small, cohesive functions; no dead code beyond `yLabels` (logged) |
| Plan fidelity | ok | round 2: single-point centring is implemented, plan-review #2 and #7 were answered by the R2/R3 fixes, and the follow-up for short x labels is closed |
| Agent decisions | ok | D-6 lives in one file (`voltage-chart.tsx`) and can be swapped for the SVG alternative as claimed; mutation `equivalent`/`accept` rows checked against the fresh report and plausible |

## Findings
### R1: The chart is wider than its view: the newest point and both x labels are clipped
- Severity: major
- Where: `apps/mobile/src/components/voltage-card.tsx:37`, `apps/mobile/src/components/voltage-chart.tsx:50-51`
- Problem: the presenter spreads the gaps over the full `plotWidth`, and the chart gets `width={plotWidth}` plus `initialSpacing={4}` and `endSpacing={4}`. gifted-charts-core computes `totalWidth = initialSpacing + maxSpacingSum + endSpacing` (`node_modules/gifted-charts-core/dist/LineChart/index.js:583`), so the content is 8 px wider than the view and, with `disableScroll`, the newest point is cut in half at the right edge (`evidence/battery-trend.png`: the 3.98 V dot is half visible, the last label reads "10/16/2026, 1"). The first label is centred on the first point and cut on the left, so it reads "13/2026, 3:1…", which looks like a date in month 13. The newest reading is the one an operator looks at first. Separately, Design says a single point "is centred by `initialSpacing`", but it is drawn on the y axis (`evidence/battery-one-sample.png`).
- Fix: give the presenter the spacing budget `plotWidth - 2 * POINT_RADIUS` (or pass `initialSpacing`/`endSpacing` into `voltageCard`), centre a single point with `initialSpacing = plotWidth / 2`, and shorten the x labels (date only, or time only when both ends fall on one day) so they fit; this also closes the logged `[FOLLOW-UP]`. Re-take both evidence screenshots (lesson on screenshots).
- Effort: small
- Lesson candidate: When a chart library adds its own padding, subtract it from the width the geometry is computed for, and check the evidence screenshot at both ends of the axis.
- Decision: fixed (d62042a) + lesson proposed

### R2: The `diag-responded` "Show values" check passes without the list
- Severity: major
- Where: `apps/mobile/e2e/diag-responded.yaml:37`
- Problem: after `tapOn: "Show values"` the flow asserts `.*3\.35 V.*`, but *Latest telemetry* shows "3.35 V" twice on the same screen. `evidence/battery-one-sample.png`, taken right after that assertion, shows both telemetry rows and no list row at all, so the assertion matched the telemetry card. FR-12 AC1 at e2e level (one point) is therefore not proved. Plan-review #2 flagged exactly this, and the plan has no *Review response* line, decision or deviation for it. `battery-history.yaml:19` has the same weakness in milder form: the newest seeded run also puts "3.98 V" in *Latest telemetry*, and the step only works because that row is scrolled above the fold.
- Fix: assert something only the list renders, e.g. a `testID` per row (`voltage-row-0`) or `"Status reply"` together with `"Hide values"` inside `voltage-card`, and `assertNotVisible` it before the tap. Re-take `battery-one-sample.png` with the open list on screen.
- Effort: small
- Lesson candidate: When an e2e step asserts a value that appears in a list, assert an element only that list renders, not a value another card on the screen also shows.
- Decision: fixed (19cb280) + lesson proposed

### R3: The seed route swallows save errors and duplicates history on each open
- Severity: minor
- Where: `apps/mobile/src/app/debug/seed/[name].tsx:29-36`
- Problem: the `void (async () => …)()` has no `catch`: a failed `save` leaves a blank screen and an unhandled rejection. Opening the link twice stores 12 runs and changes the "6 samples" text (plan-review #7, not answered). Fake build only.
- Fix: catch and redirect to `/` (or show the error), and skip seeding when Room K already has runs; or record the duplication as accepted in *Decisions*.
- Effort: small
- Lesson candidate: no
- Decision: fixed (d404f7b)

### R4: The chart's accessible summary says "1 samples"
- Severity: minor
- Where: `apps/mobile/src/i18n/en.json` (`battery.summary`)
- Problem: `battery.summary` is a single string with `{{count}} samples`, so TalkBack reads "Battery voltage chart, 1 samples from …" for the one-point case, which is the first state every user sees (D-8, NFR-05).
- Fix: add `battery.summary_one` / `battery.summary_other` (i18next plurals already key off `count`) and a catalog case for count 1.
- Effort: small
- Lesson candidate: no
- Decision: fixed (0b3d776)

### R5: One commit has no issue reference
- Severity: minor
- Where: commit `b9cd62d` "test(battery-history): strengthen assertions from mutation check"
- Problem: `CLAUDE.md` requires `Refs #<n>` on commits; this one has an empty body.
- Fix: no history rewrite needed; make sure later commits on this branch carry `Refs #8`, or reword when squashing.
- Effort: small
- Lesson candidate: no
- Decision: deferred (history is not rewritten; later commits carry Refs #8)

### R6: The `diag-responded` "Show values" step fails: the first row is off screen
- Severity: blocker
- Where: `apps/mobile/e2e/diag-responded.yaml:40-42`
- Problem: the R2 fix runs `tapOn: "Show values"` and then `assertVisible: {id: voltage-row-0}` without scrolling. In this run (`pnpm e2e`, 20/21) the flow failed with "Assertion is false: id: voltage-row-0 is visible". The screen hierarchy at the failure contains "Hide values", so the list did open, but the card's bottom edge is at the bottom of the screen and the row is below the fold. `battery-history.yaml` does the same thing with `scrollUntilVisible` and passes. The extra `assertVisible: "Status reply"` would not prove anything once that is fixed either: *Latest telemetry* shows a "Status reply" heading on the same screen.
- Fix: replace the `assertVisible` on `voltage-row-0` with `scrollUntilVisible: {element: {id: "voltage-row-0"}}` and drop the "Status reply" assertion (or scope it to the row). Keep the `assertNotVisible` before the tap: it holds with the list closed whatever the scroll position. Re-run `pnpm e2e` and take `battery-one-sample.png` with the row on screen.
- Effort: small
- Lesson candidate: no (the R2 lesson covers it; when an assertion targets content that a tap reveals inside a card, scroll to it first)
- Decision: open

### R7: The committed evidence screenshots predate the R1/R2 fixes
- Severity: minor
- Where: `context/changes/battery-history/evidence/battery-trend.png`, `battery-one-sample.png`
- Problem: both files are from before d62042a (14:42 and 15:10), so the PR still shows the clipped chart that R1 fixed. The *Review response* line in `plan.md` says a green `pnpm e2e` must re-take them, and that has not happened yet. This run's `battery-trend.png` (`~/.maestro/tests/2026-10-16_155738/battery-history/takeScreenshot/`) already shows the fixed chart with the list open.
- Fix: after R6, copy both screenshots from the green run into `evidence/` (each under 300 KB) and commit them.
- Effort: small
- Lesson candidate: no
- Decision: open
