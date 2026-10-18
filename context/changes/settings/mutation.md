# Mutation check: settings

Targets: `settings/settings.ts`, `settings/settings-controller.ts`, `settings/data-deletion.ts`, `storage/src/data/data-eraser.ts` (all new, test-plan targets), and `diagnostics/run-controller.ts` (touched by the diff, test-plan target) · Tests: `stryker.config.mjs` (vitest, perTest)

Score (settings targets):
- `settings.ts` 100% -> 100% (51 killed)
- `settings-controller.ts` 97.8% -> 100% (46 killed)
- `data-deletion.ts` 90.7% (94.2% covered) -> 94.4% (51 killed / 3 survived / 0 no coverage / 0 timeout)
- `data-eraser.ts` 100% -> 100% (22 killed)
- `run-controller.ts` 96.1% (9 survived), not changed

## Mutants
| File:line | Mutator | Change | Decision | Note / test added |
|-----------|---------|--------|----------|-------------------|
| settings-controller.ts:36 | BooleanLiteral | initial `unreadable: false` -> `true` | strengthen | `is loading, with defaults…` now asserts `unreadable` is false before load. Killed on re-run |
| data-deletion.ts:23-24 | BlockStatement / BooleanLiteral | catch around `passwords.remove` emptied / `removed=true` | strengthen | new test "reports SECRET_ERROR when the password store throws" (remove and clearAll throw). Line 24 killed on re-run |
| data-deletion.ts:23 | BlockStatement | empty catch (still `removed` false) | equivalent | `removed` is already `false` before the try, so the assignment in catch is redundant |
| data-deletion.ts:20 | BooleanLiteral | `removed = true` initial | equivalent | always overwritten by `remove().ok`, or by the catch, before it is read |
| data-deletion.ts:49 | BlockStatement | `finally` emptied (`inFlight` never reset) | strengthen | new test "runs again once the previous deletion has finished". Killed on re-run |
| data-deletion.ts:62 | BlockStatement | `erase` catch emptied | equivalent | returns `undefined`, which `!erased` treats like `false` |
| run-controller.ts:137,188,196,216,250,267,314,346,349 | various | pre-existing code (notice seen fallback, empty-string defaults, early returns, preflight `cancelled`) | accept | not lines this change added; none of the new lines (`cooldownMs`, `lastRequestAt`, `attemptsPerCheck`, `busy`, `refreshLatest`) survived. Belongs to the run-diagnostic mutation record |

## Dead-weight tests
None found.

## Gaps for the test plan
None.

## Proposed lessons
none
