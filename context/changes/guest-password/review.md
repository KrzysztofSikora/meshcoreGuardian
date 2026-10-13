# Review: guest-password

Verdict: APPROVE
Gates: typecheck ok, lint ok, unit tests ok (66 files, 1204 tests), e2e ok (19/19 flows) · Round: 1

## Plan vs diff
| File | Status | Note |
|------|--------|------|
| `packages/domain/src/secrets/secret-store.ts` | done | Three-call port, `null` = absent (D-1) |
| `packages/domain/src/nodes/guest-password.ts` + `.test.ts` | done | 15-byte UTF-8 limit, no trim; byte count by code point (logged `[minor]`) |
| `packages/domain/src/index.ts` | done | Exports port, validator, constant |
| `apps/mobile/src/application/nodes/guest-passwords.ts` | done | Key scheme, index, write order and serial chain match D-1, D-2, D-12 |
| `apps/mobile/src/application/nodes/guest-passwords.int.test.ts` | done | All planned cases plus chain poisoning and bad index (plan-review 5, 7) |
| `apps/mobile/src/application/diagnostics/ports.ts` | done | Comment only |
| `apps/mobile/src/application/diagnostics/run-controller.int.test.ts` | done | Frame bytes with/without password; failing store → `NOT_TESTED`/`UNEXPECTED_ERROR`, no remote write |
| `apps/mobile/src/platform/fake/in-memory.ts` | done | `InMemorySecretStore` with `failWith` and extra `failSetWith` |
| `apps/mobile/src/platform/secure-store.ts` | done | Thin wrapper |
| `apps/mobile/package.json`, `pnpm-lock.yaml` | done | `expo-secure-store ~57.0.4` |
| `apps/mobile/app.json` | done | Plugin entry (D-10) |
| `apps/mobile/src/composition/index.ts` | done | `passwords` wired into `runs` |
| `packages/storage/package.json` | done | `./testing` subpath (D-9) |
| `packages/storage/test/helpers/index.ts` | absent | Planned "if needed"; not needed |
| `eslint.config.mjs` | diverged | Mobile test-file block omits `forbid.nodeSqlite` (R2) |
| `tooling/lint/layer-rules.test.ts` | done | Test file allowed / app file rejected for `/testing` |
| `apps/mobile/src/application/nodes/guest-password-leak.int.test.ts` | done | File-backed DB scanned before cleanup, DB content and sent canary asserted |
| `apps/mobile/src/app/node/[id].tsx` | diverged | Card position logged `[minor]`; Remove hidden on read error, contrary to D-7 (R1) |
| `apps/mobile/src/application/nodes/presenter.ts` + `.test.ts` | done | Status and error text mapping |
| `apps/mobile/src/i18n/en.json` | done | All ten `password.*` keys |
| `apps/mobile/e2e/guest-password.yaml` | done | Run before restart, persistence after (logged `[minor]`) |
| `context/test-plan.md` | done | TR-09, TR-21, mutation target, flow count 19 |
| `context/changes/guest-password/evidence/*.png` | done | Light theme only (logged), each < 300 KB |
| `apps/mobile/tsconfig.json` | unplanned | `"types": ["node"]`, logged `[minor]`; `@types/node` was already picked up from the root type roots, so no new exposure |
| `context/roadmap.md` | unplanned | Status bookkeeping |
| `context/changes/guest-password/{plan,plan-review,mutation}.md` | unplanned | Workflow artifacts |

## Areas
| Area | Result | One-line reason |
|------|--------|-----------------|
| Correctness | concern | Service, run wiring and write orders are right; the card hides Remove when the status read fails (R1) |
| Design | ok | Port in domain, key logic in one tested application file, thin Expo wrapper, no RN in domain |
| Safety | concern | Password never in state, errors, logs or SQLite (leak test); test-file lint block loosened `node:sqlite` (R2) |
| Tests | ok | Behavioural, deterministic, failure paths covered; mutation `accept` on the internal error message is plausible |
| Simplicity | ok | Small functions, no dead code |
| Plan fidelity | concern | Two records in `plan.md` claim things the code/plan does not do (R2, R3) |
| Agent decisions | ok | D-1/D-2 (costly) live only in `guest-passwords.ts`; `[REVIEW]` deviations for AC3 and export scan are logged |

## Findings
### R1: Remove password is hidden when the stored status cannot be read
- Severity: minor
- Where: `apps/mobile/src/app/node/[id].tsx:216`
- Problem: D-7 says that when loading the card status fails, "Save/Remove still offered". The card renders Remove only for `saved === "yes"`, so after a read error (`saved === "error"`) the user cannot remove a secret that may still be stored, and the only way out is a successful save first.
- Fix: render Remove when `saved === "yes" || saved === "error"`, and add a presenter or e2e-free unit assertion if the condition moves to the presenter (e.g. a `canRemovePassword(saved)` helper with a table test).
- Effort: small
- Lesson candidate: no
- Decision: open

### R2: Mobile test-file lint block allows `node:sqlite`, and the deviation says it restates the full list
- Severity: minor
- Where: `eslint.config.mjs:98-107`
- Problem: Flat config replaces the `no-restricted-imports` options of the earlier `apps/mobile/**` block. The new `apps/mobile/**/*.test.ts` block lists only the deep-import pattern and `meshcoreJs`, so `forbid.nodeSqlite` no longer applies to mobile tests. Verified: `eslint --stdin --stdin-filename apps/mobile/src/application/nodes/x.int.test.ts` with `import { DatabaseSync } from "node:sqlite"` exits 0, while the same import in `x.ts` is rejected. Plan-review 1 asked for `[deepImport-except-/testing, meshcoreJs, nodeSqlite]`, and the `[minor]` deviation claims the block "restat[es] the full list". The leak test does not need `node:sqlite` directly (it comes in through `@guardian/storage/testing`).
- Fix: add `forbid.nodeSqlite` to the block and a `[mobileTestFile, "node:sqlite"]` rejected case in `tooling/lint/layer-rules.test.ts`.
- Effort: small
- Lesson candidate: When a flat-config block narrows a restricted-imports rule, restate every entry of the broader block and add a layer-rules case for each one.
- Decision: open

### R3: D-10 still gives the pre-review reason, although *Review response* says it was reworded
- Severity: minor
- Where: `context/changes/guest-password/plan.md:74`
- Problem: Plan-review 6 found that `configureAndroidBackup` already defaults to `true`, so the entry only makes the default explicit and alternative B ("default auto-backup includes shared prefs") is not real. *Review response* says "D-10 wording; D-10 is an explicit default", but the D-10 row is unchanged and still tells the PR reviewer the plugin line changes backup behaviour.
- Fix: reword D-10: "explicit default (excludes SecureStore prefs from auto-backup; restored values could not be decrypted anyway)", and drop or restate alternative B.
- Effort: small
- Lesson candidate: no
- Decision: open
