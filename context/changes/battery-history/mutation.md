# Mutation check: battery-history

Targets: `packages/domain/src/telemetry/voltage.ts` (whole file), `apps/mobile/src/application/nodes/voltage-presenter.ts` (whole file) · Tests: `stryker.config.mjs` (vitest, perTest), run with `pnpm mutation --mutate <both files>`
Score: 84.9% -> 88.1% (after: 281 killed / 38 survived / 0 no coverage / 0 timeout; before: 271 / 48 / 0 / 0)
Per file after: voltage.ts 85.2% (86/101), voltage-presenter.ts 89.5% (195/218).

Other changed logic files (`node-history.ts`, `telemetry-repository.ts`, `sample-rows.ts`, `voltage-seed.ts`) are not in the test-plan *Mutation targets* list and are wiring/mapping covered by integration tests; not mutated. The incremental cache (`reports/stryker-incremental.json`) kept stale statuses after test-only edits, so the final numbers come from a run with the cache deleted.

## Mutants
| File:line | Mutator | Change | Decision | Note / test added |
|-----------|---------|--------|----------|-------------------|
| voltage.ts:43 | Conditional/LogicalOp (earlier) | status-over-telemetry replacement | strengthen | killed: both arrival orders keep the status reading; two telemetry readings keep the first |
| voltage.ts:43 | Conditional `true`, StringLiteral `""` | `kept.source !== "status"` always true | equivalent | only differs for two *status* readings of one run, where the rule is undefined (either is valid) |
| voltage.ts:57 | Conditional/Logical | drop empty-guard in `spanMs` | equivalent | line 58 returns `insufficient` for empty input anyway; a manual `false` mutant made `voltageTrend([])` throw and failed 2 tests, so Stryker's "survived" is a perTest-coverage artefact |
| voltage.ts:58 | Conditional `first === undefined` → false | | equivalent | `count < 5` already rejects empty input |
| voltage.ts:62 | Arithmetic `p.at + first.at` | | equivalent | constant shift of x; the fit is shift-invariant (only float precision differs) |
| voltage.ts:64,70 | Arithmetic on `meanY`, `x + meanX`, `voltageV + meanY` | | equivalent | Σ(x−x̄)=0 and Σ(y−ȳ)=0, so the constant terms cancel in the slope |
| voltage.ts:69 | Conditional `p === undefined` | | equivalent | unreachable type guard (xs and points have equal length) |
| voltage.ts:73 | Conditional `sxx === 0` → false | | equivalent | span ≥ 24 h with ≥ 5 points makes sxx > 0 |
| voltage.ts:75 | `<` → `<=` on the band | | accept | needs a fitted change of exactly 0.05 in floating point; ±0.049/±0.051 already pin the band |
| voltage.ts:75 | `changeV < 0` → `<= 0` | | equivalent | changeV = 0 is always "stable" |
| voltage-presenter.ts:69 | `changeV < 0` → `<= 0` | | equivalent | 0 prints as "+0.00" vs "−0.00" only for a value that is never "falling"/"rising" |
| voltage-presenter.ts:95 | `<` → `<=` | | equivalent | at exactly 4 units the widening adds 0 |
| voltage-presenter.ts:96 | `extra = 4 + (hi-lo)` | | strengthen | killed by "widens a range of one grid unit symmetrically to four units" (exact yMin/yMax/step) |
| voltage-presenter.ts:117 | all | single-point / empty guard | equivalent | one point gives `[0]` either way; empty is not reachable (chart needs ≥ 1 point). The `< 2` boundary for two points is killed by "two points take the whole plot width" |
| voltage-presenter.ts:121 | span-0 share `1 * (n-1)` → | | equivalent | shares are renormalised by `scale`/`fit` to the plot width |
| voltage-presenter.ts:124,127,132 | `<` → `<=` on MIN_GAP_PX | | equivalent | at exactly the minimum gap both branches yield 6 px |
| voltage-presenter.ts:127 | filter dropped (`false`) | | strengthen | killed by "a close pair keeps the minimum gap..." ([6, 94, 0]) |
| voltage-presenter.ts:130 | `>` → `>=`, condition `true` | | equivalent | with `room > 0` the large gaps always exceed `room`; at equality the scale is 1 |
| voltage-presenter.ts:130 | `room > 0` → `>= 0` | | strengthen | killed by "with no width left after the minimum gaps, scales all gaps into the plot" |
| voltage-presenter.ts:136 | `fit` conditions (`true`, `>=`, `||`) | | accept | after `scale` the total already equals the plot width unless minimum gaps overflow it (covered); the `plotWidth > 0` guard only matters before layout (width 0), where pinning a pixel value would mirror the implementation |
| voltage.ts (trend) | least-squares arithmetic | | strengthen | "fits a least-squares line through uneven readings" asserts exact −0.16 V, span and count with epoch-ms times |

## Dead-weight tests
None found. The five `±0.049/0.051` table rows each guard a different side of the band.

## Gaps for the test plan
- Stryker's incremental file returns stale statuses after test-only edits (even with `--force`). Delete `reports/stryker-incremental.json` before a re-run, or the "after" score is wrong.

## Proposed lessons
Re-running mutation after a test-only change must clear `reports/stryker-incremental.json` first; otherwise survivors are copied from the previous run.
