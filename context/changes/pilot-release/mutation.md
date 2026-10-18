# Mutation check: pilot-release

Targets: `apps/mobile/src/application/about/licenses-presenter.ts` (sort order and row mapping, D-4), `apps/mobile/src/application/about/privacy.ts` (block list shown to the user, D-5) · Tests: Vitest via `pnpm mutation --mutate <file>`
Score: licenses-presenter 100 % -> 100 % (31 / 0 / 0 / 0); privacy 94.74 % -> 100 % (before 17 / 1 / 0 / 1, after 18 / 0 / 0 / 1)

None of the test-plan *Mutation targets* is touched by this diff. The two files above are the only changed logic files with behaviour a silent bug would hurt. Skipped: `large-seed.ts`, `voltage-seed.ts` (debug-only seed data), `release-config.test.ts`, `notices.json` and `release.md` (config and constants), the screens and `settings.tsx` (presentation or wiring).

## Mutants
| File:line | Mutator | Change | Decision | Note / test added |
|-----------|---------|--------|----------|-------------------|
| privacy.ts:16 | StringLiteral | paragraph `kind: "paragraph"` -> `""` | strengthen | `privacy.test.ts` now also counts `kind === "paragraph"` blocks (sections + effective line). Killed on re-run |
| privacy.ts:14 | UpdateOperator | `n++` -> `n--` | equivalent | Timeout (infinite loop), counted as caught |

## Dead-weight tests
None.

## Gaps for the test plan
None.

## Proposed lessons
none
