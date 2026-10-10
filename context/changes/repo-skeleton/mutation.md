# Mutation check: repo-skeleton

Targets: `packages/domain/src/diagnostics/result-code.ts` (whole file),
`apps/mobile/src/config/transport-mode.ts` (whole file) · Tests: `stryker.config.mjs`
(`pnpm mutation --mutate <file>`, Vitest via `vitest.config.mts`, `coverageAnalysis: "perTest"`)
Score: 96.43% -> 96.43% (27 killed / 1 survived / 0 no coverage / 0 timeout)

- `result-code.ts`: 85.71% (6 / 1 / 0 / 0)
- `transport-mode.ts`: 100% (21 / 0 / 0 / 0)

Why these targets: no file from test-plan *Mutation targets* exists yet (they arrive with S-01..S-04).
Of the logic files this change adds, these two hold logic where a silent bug hurts:

- `result-code.ts`: domain guard for the FR-06 result codes (later used to validate stored and
  decoded values).
- `transport-mode.ts`: input validation of `EXPO_PUBLIC_TRANSPORT`. A wrong mapping would let a
  mistyped e2e build drive the real radio (D-9).

Skipped: `composition/transport.ts` (stub wiring), `i18n/index.ts` (configuration), routes and
`placeholder-screen.tsx` (presentation), `meshcore-adapter/src/index.ts` and
`storage/src/index.ts` (empty or re-exports), `scripts/*.sh`, `tooling/` (not TS logic under test).

## Mutants
| File:line | Mutator | Change | Decision | Note / test added |
|-----------|---------|--------|----------|-------------------|
| `packages/domain/src/diagnostics/result-code.ts:13` | ConditionalExpression | `typeof value === "string" && …` → `true && …` | equivalent | `RESULT_CODES` holds only primitive strings, and `Array.prototype.includes` (SameValueZero) is false for every non-string, including `new String("RESPONDED")` and `["RESPONDED"]`, which the table already rejects. The `typeof` check only narrows the type for the compiler. |

## Dead-weight tests
None to fold. Several rows of the `isResultCode` and `parseTransportMode` tables show "covered,
0 killed" because Stryker stops at the first failing test per mutant, so another row got the kill
first. They are already rows of one `it.each` table, not copied setups, and each pins a distinct
boundary (case, whitespace, non-string types).

`RESULT_CODES > lists the FR-06 result codes in order` reports "covered 0": the array literal is
a static mutant (evaluated at import), so Stryker credits the kill to another test. The test
still pins the FR-06 list and order. Keep it.

## Gaps for the test plan
- `apps/mobile/src/config/transport-mode.ts` is outside the default `mutate` glob in
  `stryker.config.mjs` (`packages/domain/src/**`) and outside `stryker.targets`, so CI never
  mutates it. `--mutate <file>` works for it, as this run shows. That is fine while it stays a
  two-branch parser. If app-side config parsing grows, add it to test-plan *Mutation targets*.

## Proposed lessons
none
