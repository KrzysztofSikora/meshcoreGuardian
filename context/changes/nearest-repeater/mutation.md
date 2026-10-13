# Mutation check: nearest-repeater

Targets: `packages/domain/src/geo/geo.ts`, `packages/domain/src/nodes/nearest.ts`, `packages/storage/src/sync/contacts.ts`, `packages/meshcore-adapter/src/client/mesh-client.ts` (the changed lines only: `position` in the handshake result, `pathHops`/`position` in the contact record) · Tests: `stryker run --mutate <file>`, Vitest, perTest coverage
Score: 93.3% -> 93.6% (killed 528 / survived 36 / no coverage 5 / timeout 0 across the four files)

| File | Before | After |
|------|--------|-------|
| geo.ts | 98.5% (65/1 survived) | 100% (66/0) |
| nearest.ts | 82.3% (65/14) | 83.5% (66/13) |
| contacts.ts | 96.8% (30/1) | 96.8% (30/1) |
| mesh-client.ts | 94.3% (366/17 survived, 5 no coverage) | unchanged |

Targets not run: `packages/meshcore-adapter/src/decode/*.ts` (not in the diff). `node-repository.ts` is not a test-plan target.

## Mutants
| File:line | Mutator | Change | Decision | Note / test added |
|-----------|---------|--------|----------|-------------------|
| geo.ts:43 | ArithmeticOperator | `sin(lat a) * cos(lat b) / cos(dLon)` in the bearing | strengthen | killed by a bearing test off the equator and the shared meridian (50,10 -> 51,12 = 51.0618°) |
| nearest.ts:20 | ConditionalExpression | `a === b` early return -> `false` (two unknowns compared as "a is later") | strengthen | killed by "falls through to the next criterion when both values are unknown", run with three input orders |
| nearest.ts:22 | ArithmeticOperator | `sign * (a - b)` -> `sign / (a - b)` | equivalent | only the sign of the result is used, and it is the same; `a === b` is handled earlier |
| nearest.ts:49 (x6) | ConditionalExpression / LogicalOperator | guards in `direction` | equivalent | `distanceM !== null` already implies companion and position are set, so the other guards are redundant. The `distanceM > 0` guard is killed |
| nearest.ts:59 col 10 | EqualityOperator | `<` -> `<=` | equivalent | two different nodes never share a public key |
| nearest.ts:59 col 53 (x4) | Conditional / Equality | second key comparison (`>`) -> `true`/`false`/`>=`/`<=` | equivalent | the sort moves an element only on a negative result, so 0 and 1 give the same order; only identical keys differ, and those cannot occur. Order by key is pinned by the all-permutations test |
| contacts.ts:30 | OptionalChaining | `known[0]?.n` -> `known[0].n` | equivalent | `count(*)` always returns one row |
| mesh-client.ts:148-150, 161, 173-174, 202, 254, 297-310, 352, 374, 389, 450, 513, 543 | various | no-op callbacks, empty messages, defensive branches | accept | none is on a line this change touched (the new lines 183 and 458-459 have no survivors); older code, covered by the connect-companion and sync-contacts reviews. Not pursued here |

## Dead-weight tests
None found. The existing "breaks a full tie by public key" test is now covered by the all-permutations test; keep both (cheap), fold if it grows.

## Gaps for the test plan
- `mesh-client.ts` carries 22 older survivors/uncovered mutants (score 94.3%, above the 80% target). No action for this change.

## Proposed lessons
none
