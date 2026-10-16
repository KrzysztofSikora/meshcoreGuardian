# Mutation check: node-details-telemetry

Targets: `packages/domain/src/telemetry/samples.ts` and `apps/mobile/src/application/nodes/history-presenter.ts` (test-plan targets), plus `packages/domain/src/telemetry/lpp.ts` and `apps/mobile/src/application/nodes/node-history.ts` (logic touched by the diff) · Tests: `vitest.config.mts`, perTest coverage
Not mutated: storage files (`sample-rows.ts`, `backfill.ts`, `telemetry-repository.ts`), which are not test-plan targets and are covered by integration tests.

Score before -> after:
- `samples.ts`: 97.2% -> 100% (0 survived)
- `history-presenter.ts`: 95.8% -> 99.5% (1 survived)
- `lpp.ts`: 100% (no change)
- `node-history.ts`: 73.5% -> 97.1% (1 survived)

## Mutants
| File:line | Mutator | Change | Decision | Note / test added |
|-----------|---------|--------|----------|-------------------|
| samples.ts (GPS parts) | ConditionalExpression | `if (finite(part))` -> `true` | strengthen | "drops a non-finite GPS part but keeps the others" (killed) |
| samples.ts (voltage) | ConditionalExpression | `type === 116` -> `true` | strengthen | "does not read channel 1 of another type as the battery voltage" (killed) |
| samples.ts (selection) | ConditionalExpression | `result !== "RESPONDED"` -> `false` | strengthen | "makes no sample from an unanswered check even when it carries evidence" (killed) |
| history-presenter.ts (extraRow) | Regex x2 | drop `^` / drop `$` from `/^lpp_(\d+)$/` | strengthen | `xlpp_7` and `lpp_7x` are not shown as "Sensor type" (killed) |
| history-presenter.ts (telemetryCard) | ArrayDeclaration | `[]` -> `["Stryker was here"]` for a missing telemetry group | strengthen | status-only card has one group with the status title (killed) |
| history-presenter.ts (showsSignal) | Conditional x2, Logical | RSSI-or-SNR rule | strengthen | table: RSSI only / SNR only / neither (killed) |
| history-presenter.ts (durationText) | EqualityOperator | `seconds < 60` -> `<= 60` | strengthen | 59 s and 60 s cases (killed) |
| history-presenter.ts (extraRow) | ConditionalExpression | `if (extra.channel !== null)` -> `true` | equivalent | with a null channel the label key `telemetry.extra` has no `{{channel}}` placeholder, so the extra param is never rendered |
| node-history.ts (read) | Conditional, Equality, StringLiteral, ObjectLiteral, Logical (8) | keep-previous-data-while-reloading logic | strengthen | "shows loading with nothing on a first read, and keeps the previous data while reloading" (killed) |
| node-history.ts:28 | StringLiteral | `LOADING.status` "loading" -> "" | equivalent | every use of `LOADING` overrides `status` (first read, error) |

## Dead-weight tests
None found.

## Gaps for the test plan
- `node-history.ts` is not in the test-plan *Mutation targets* table. Its reload state (keep previous data) is user-visible, so adding it is worth a look.
- The stryker dry run prints two `✘ en catalog ... (covered 0)` lines for `history-presenter.ts` and `node-history.ts`. These come from the i18n catalog test, are not failures and are not caused by this change.

## Proposed lessons
When a controller keeps previous data while reloading, test the state during the pending read, not only the final state.
