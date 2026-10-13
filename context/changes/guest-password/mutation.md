# Mutation check: guest-password

Targets: `packages/domain/src/nodes/guest-password.ts` (byte-length validation of the password, FR-14),
`apps/mobile/src/application/nodes/guest-passwords.ts` (secret key scheme, index, clear-all; test-plan target, TR-09/TR-21) · Tests: `vitest.config.mts` via `pnpm mutation --mutate <file>` (one run per file)
Score: 96.2% -> 98.8% (guest-passwords.ts 75 -> 77 killed, 1 survived; guest-password.ts 28 -> 32 killed, 0 survived; 0 no coverage, 0 timeout)
Per file: guest-passwords.ts 96.2% -> 98.7%; guest-password.ts 87.5% -> 100%.

Not mutated: `presenter.ts` additions (`passwordStatusText`, `passwordErrorText`) are pure text-key mapping, and the nodes `presenter.ts` already scores 100% in the report. `[id].tsx`, composition, secure-store and fakes are wiring/presentation.

## Mutants
| File:line | Mutator | Change | Decision | Note / test added |
|-----------|---------|--------|----------|-------------------|
| guest-password.ts:12 | EqualityOperator | `code < 0x80` -> `<=` | strengthen | killed: U+0080 x8 is TOO_LONG |
| guest-password.ts:12 | EqualityOperator | `code < 0x800` -> `<=` | strengthen | killed: U+0800 x6 is TOO_LONG |
| guest-password.ts:12 | EqualityOperator | `code < 0x10000` -> `<=` | strengthen | killed: U+FFFF x5 ok, x6 and U+10000 x4 TOO_LONG |
| guest-password.ts:12 | ConditionalExpression | 3-byte branch -> false | strengthen | killed: 3-byte chars (U+0800, U+FFFF) accepted at 15 bytes |
| guest-passwords.ts:24 | ObjectLiteral | initial state `{ saved: {} }` -> `{}` | strengthen | killed: new test "starts with no password state" |
| guest-passwords.ts:102 | MethodExpression | `every` -> `some` on index entries | strengthen | killed: index `["a",1]` added to the unreadable-index table |
| guest-passwords.ts:103 | StringLiteral | error message -> `""` | accept | Wording of an internal error that is caught and mapped to STORAGE_ERROR or a rejection; asserting it would mirror the implementation. Survives. |

## PR #22 and R4 re-run
`pnpm mutation --mutate apps/mobile/src/application/nodes/guest-passwords.ts` after `b8dd64f` and the R4 fix: 106 killed, 1 survived (99.07%). The survivor is the same accepted error-message literal, now at line 141 (was 103). The reviewer's run of `run-controller.ts` (211 killed, 7 survivors, none on lines this change touched) stands. New R4 tests: `discardAdminPassword` leaves a password saved since the run started (`guest-passwords.int.test.ts`; `run-controller.int.test.ts`).

## Dead-weight tests
None found. The new byte-boundary rows are table rows in the existing `it.each`.

## Gaps for the test plan
None.

## Proposed lessons
none
