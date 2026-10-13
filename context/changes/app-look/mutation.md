# Mutation check: app-look

Targets: `apps/mobile/src/application/diagnostics/presenter.ts` (new `statusLook`, `connectionLook`, `RunDetails.look`), `apps/mobile/src/theme/contrast.ts` (new; guards the NFR-05 contrast tests) · Tests: `vitest.config.mts` via `pnpm mutation --mutate <file>`
Score: presenter.ts 88.3% -> 88.3% (173 / 21 / 2 / 0); contrast.ts 86.1% -> 94.4% (34 / 2 / 0 / 0)

Skipped as pure presentation or constants: `tokens.ts`, `theme-provider.tsx`, `components/**`, `app/**` screens, e2e flows.
Note: `--mutate` on a single file still ran other files' tests (perTest coverage); only the two targets are judged here.

## Mutants
| File:line | Mutator | Change | Decision | Note / test added |
|-----------|---------|--------|----------|-------------------|
| contrast.ts:9 | Regex | drop `^` anchor | strengthen | killed: `x#FFFFFF` must throw with the message |
| contrast.ts:9 | Regex | drop `$` anchor | strengthen | killed: `#FFFFFFAA` must throw |
| contrast.ts:9 | StringLiteral | empty error message | strengthen | killed by the message assertion |
| contrast.ts:5 | EqualityOperator | `s <= 0.03928` -> `<` | equivalent | both branches agree at the threshold within float precision |
| contrast.ts:19 | EqualityOperator | `a >= b` -> `>` | equivalent | equal luminances give ratio 1 either way |
| presenter.ts:124-125 | BlockStatement / LogicalOperator | `statusOf` body | accept | unchanged by this change; no coverage predates it (thin wrapper over `lastRunStatus`, covered in domain) |
| presenter.ts:41, 65-67, 151, 168-176, 194, 214, 229, 236-239 | various | string/object literals, catalog keys, fallbacks | accept | all on lines this change did not touch; key strings are pinned by the catalog tests, remaining are wording or unreachable defaults |
| presenter.ts `STATUS_LOOK`, `CONNECTION_LOOK`, `look` in `runDetails` | all | icon/tone table, `look` mapping | - | no survivors: all killed |

## Dead-weight tests
None found.

## Gaps for the test plan
- `statusOf` in `diagnostics/presenter.ts` has no direct test.
- `apps/mobile/src/application/diagnostics/presenter.ts` and `apps/mobile/src/theme/contrast.ts` are not in the test-plan *Mutation targets* table; consider adding them.

## Proposed lessons
none
