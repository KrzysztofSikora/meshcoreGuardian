# Mutation check: export-report

Targets: `packages/domain/src/export/{report,redact,serialize}.ts`, `apps/mobile/src/application/export/export-controller.ts` · Tests: `vitest.config.mts` via `stryker.config.mjs` (`pnpm mutation --force --mutate <file>`)
Score: 82% -> 97% (before 217 killed / 46 survived / 2 no coverage of 265; after 257 killed / 8 survived / 0 no coverage / 0 timeout of 265)

| File | Before (killed / survived / no cov) | After (killed / survived) |
|------|-------------------------------------|---------------------------|
| report.ts | 46 / 18 / 1 (71%) | 63 / 2 (97%) |
| serialize.ts | 51 / 9 / 0 (85%) | 59 / 1 (98%) |
| redact.ts | 13 / 0 / 0 (100%) | 13 / 0 (100%) |
| export-controller.ts | 107 / 19 / 1 (84%) | 122 / 5 (96%) |

Targets are the four `context/test-plan.md` export rows; all were touched by the diff. `schema.ts` and `presenter.ts` are not test-plan targets and were not mutated.

Note on the first run: `export.test.ts` built `redacted` / `full` at module load, so every mutant in `report.ts` and `serialize.ts` that ran on import was "static" and Stryker could not switch it on; ~25 mutants survived for that reason alone (emptied function bodies, dropped keys). The reports are now built per call. Not a product bug.

## Mutants
| File:line | Mutator | Change | Decision | Note / test added |
|-----------|---------|--------|----------|-------------------|
| report.ts:85 | ConditionalExpression | `ms === null ? null : iso(ms)` -> `iso(ms)` | strengthen (killed) | "writes a node never heard and a check never started as null" |
| report.ts:152 | LogicalOperator | tie-break `a.id ?? 0` -> `a.id && 0` | strengthen (killed) | tied runs also checked in reversed input order |
| report.ts:176 | ArrayDeclaration | unsaved run gets `["Stryker was here"]` | strengthen (killed) | "exports an unsaved run (no id) with no telemetry" |
| report.ts:156 | ConditionalExpression | `if (sample.runId === null) continue` -> `false` | equivalent | a null-run sample lands under key `null` that no run looks up |
| report.ts:176 | ConditionalExpression | `run.id === undefined ? [] : ...` -> `false` | equivalent | `byRun.get(undefined) ?? []` is `[]` too |
| serialize.ts:60 | ConditionalExpression | noise finder `e.name === "noise_floor"` -> `true` | strengthen (killed) | "takes the noise floor by name" |
| serialize.ts:40 | ConditionalExpression | `cell === null` -> `false` | equivalent | a null cell then falls through to `Array.join`, which prints it as an empty string |
| export-controller.ts:104 | ConditionalExpression | `input === null` -> `false` | equivalent | `status` is `ok` only after input is set; the status test returns first |
| export-controller.ts:104 | other 2 mutants | `status !== "ok"` -> `false`, `\|\|` -> `&&` | strengthen (killed) | "refuses to share while a re-read has failed" asserts no file and share state `idle` |
| export-controller.ts:131-146,160-161 | initial state, redaction default, status/share while re-reading | strengthen (killed) | "starts idle and redacting...", "takes the redaction default from the setting...", "shows loading until the first read finishes..." |
| export-controller.ts:87 | setDays without a key | strengthen (killed) | "starts idle ... and setDays does nothing" |
| export-controller.ts:174,196,179 | stale `notFound` / `error`; ids passed to `forRuns` | strengthen (killed) | "a slow earlier read that finds no node or fails...", "asks for telemetry of saved runs only" |
| export-controller.ts:78 | LogicalOperator | `opening ?? Promise.resolve()` -> `&&` | accept | returns `null` once the read is done; callers only `await` it. Pinning it would mirror the implementation |
| export-controller.ts:79 | BlockStatement | `.finally` that clears `opening` -> `{}` | equivalent | a finished promise returned for a later `open` is the same to an `await` |
| export-controller.ts:151,157 | UpdateOperator | `seq++` -> `seq--` | equivalent | `seq` only needs to differ between reads; a decreasing counter does too |

### bug
- export-controller.ts:78: two `open()` calls at once on a not-yet-open key both start a read, because `publicKey` is set only after `await redactionDefault()`. Found while writing the test for the `opening` mutant. Recorded as `[REVIEW]` in `plan.md`; not fixed here.

## Dead-weight tests
None. The seven CSV prefix cases and the `it.each` golden table are parametrised already.

## Gaps for the test plan
- None. The export controller test file now has a second `describe` with port doubles that can be gated; the first uses SQLite and the real diagnostic flow.

## Proposed lessons
- Do not build the subject's output at module load in a test file (`const report = build(...)` at the top). Stryker's vitest runner cannot activate a mutant for code that runs on import, so those mutants survive whatever the assertions say. Build it inside the test or a function. Scope: `**/*.test.ts` of mutation targets.
