# Review: repo-skeleton

Verdict: APPROVE WITH FOLLOW-UPS
Gates: GATES_PLACEHOLDER · Round: 1

## Plan vs diff
| File | Status | Note |
|------|--------|------|
| `package.json` | done | scripts `typecheck`, `lint`, `test`, `e2e`, `mutation`, `format`; pins as planned (prettier 3.9.9 and `vite` logged as deviations) |
| `pnpm-workspace.yaml` | done | `nodeLinker: hoisted`; `tooling`, `allowBuilds`, `autoInstallPeers: false`, `patchedDependencies` logged (D-18, D-19) |
| `pnpm-lock.yaml` | done | generated |
| `tsconfig.base.json` | done | strict flags as in Design |
| `eslint.config.mjs` | done | layer rules per D-16, react version (D-5), `jsx-no-literals` (logged); see R2, R4 |
| `.prettierrc.json`, `.prettierignore` | done | |
| `vitest.config.mts` | done | planned as `.ts`; rename logged |
| `stryker.config.mjs` | done | as test-plan *Tool setup*, plus `vitest.configFile` (logged) |
| `stryker.targets` | done | mirrors test-plan *Mutation targets* |
| `scripts/mutation-changed.sh` | done | D-13; Stryker path verified locally only (logged) |
| `scripts/e2e.sh` | done | D-11, D-20; see R1 |
| `.github/workflows/ci.yml` | done | `checks` + `mutation-report` (PR only, `continue-on-error`) |
| `.gitignore` | done | see R3 |
| `.env.example` | done | three empty `HW_*` keys, commented `EXPO_PUBLIC_TRANSPORT` |
| `packages/domain/**` | done | `result-code.ts` + table test (D-7) |
| `packages/meshcore-adapter/**` | done | empty entry + workspace-resolution test |
| `packages/storage/**` | done | `openTestDb` on `node:sqlite`, integration test |
| `tooling/lint/layer-rules.test.ts` | done | D-4, covers every layer row and look-alike relative imports |
| `tooling/package.json`, `tooling/tsconfig.json` | unplanned | logged (plan-review #4) |
| `patches/@stryker-mutator__vitest-runner@10.0.0.patch` | unplanned | logged (D-19) |
| `apps/mobile/package.json` | done | `@expo/metro-runtime` added (logged) |
| `apps/mobile/app.json` | done | D-10 id, ble-plx `neverForLocation`, minSdk 31; `userInterfaceStyle` dropped (logged) |
| `apps/mobile/tsconfig.json` | done | |
| `apps/mobile/src/app/*.tsx` (5 routes + `_layout`) | done | |
| `apps/mobile/src/components/placeholder-screen.tsx` | unplanned | logged |
| `apps/mobile/src/i18n/{en.json,index.ts,i18next.d.ts,catalog.test.ts}` | done | |
| `apps/mobile/src/config/transport-mode{,.test}.ts` | done | D-9 table |
| `apps/mobile/src/composition/{index,transport}.ts` | done | D-8 |
| `apps/mobile/e2e/smoke.yaml` | done | asserts the dashboard placeholder line instead of the title (same screen) |
| `context/changes/repo-skeleton/**`, `context/roadmap.md` | done | workflow artifacts and status |

## Areas
| Area | Result | One-line reason |
|------|--------|-----------------|
| Correctness | concern | `pnpm e2e` hangs instead of failing when the AVD does not boot in time (R1) |
| Design | ok | packages source-only, native code confined to `apps/mobile`, single composition point |
| Safety | concern | `.env.local` (loaded by Expo) is not gitignored (R3); no secrets in the diff |
| Tests | ok | behaviour tables, failure paths covered; mutation `equivalent` on `result-code.ts:13` is plausible |
| Simplicity | ok | small modules, no dead code |
| Plan fidelity | ok | every divergence is logged under *Deviations* |
| Agent decisions | concern | D-10 (costly) lives in `app.json` and `smoke.yaml` only, as claimed; lint rules leave two gaps against their stated intent (R2, R4) |

## Findings
### R1: `pnpm e2e` hangs forever when the emulator it started does not finish booting
- Severity: major
- Where: `scripts/e2e.sh:36-43`, `scripts/e2e.sh:49-71`
- Problem: `boot_emulator` keeps the new serial in the local variable `serial` and exports `ANDROID_SERIAL` only after boot completes. On the timeout path (`exit 1` at line 65), and on Ctrl-C during boot, `ANDROID_SERIAL` is still the empty string assigned at line 75, so `cleanup` runs `adb -s "" emu kill` (fails, swallowed by `|| true`) and then `wait "$started_emulator_pid"` blocks until the still-running emulator exits, which it never does. Reproduced with the same `cleanup` body, a failing `adb` and a background `sleep` as the emulator: the script printed `stopping emulator ''` and was still blocked when `timeout 10` killed it. The plan's Design step 2 requires "timeout 300 s, then fail with a clear message", and test-plan says the script "stops the emulator it started".
- Fix: track the serial in a global (`started_serial`) as soon as it appears in `adb devices`, use it in `cleanup`, and after `emu kill` fall back to `kill "$started_emulator_pid"` (then `wait`) so cleanup never depends on adb seeing the device.
- Effort: small
- Lesson candidate: In shell cleanup traps, never `wait` on a child you have not first signalled directly by PID.
- Decision: fixed (f48b3a0) + lesson proposed

### R2: Domain layer rule misses Node built-ins imported without the `node:` prefix
- Severity: minor
- Where: `eslint.config.mjs:38` (`forbid.nodeBuiltins`, regex `^node:`)
- Problem: `CLAUDE.md` says "`domain` imports nothing" and the rule message says "domain is pure TypeScript without I/O", but only `node:`-prefixed specifiers are caught. Verified with `eslint --stdin --stdin-filename packages/domain/src/x.ts`: `import "node:fs"` fails lint, `import "fs"`, `import "path"` and `import "crypto"` pass. The TR-22 table has no bare built-in row.
- Fix: build the regex from `module.builtinModules` in `eslint.config.mjs` (e.g. `^(node:|(${builtinModules.join("|")})(/.*)?$)`) and add a `[domainFile, "fs"]` row to `tooling/lint/layer-rules.test.ts`.
- Effort: small
- Lesson candidate: no
- Decision: fixed (bc8b8c6)

### R3: `.env.local` and other local Expo env files are not gitignored
- Severity: minor
- Where: `.gitignore:13`
- Problem: only `.env` is ignored. Expo CLI (`@expo/env`) also loads `.env.local` and `.env.<mode>.local`, which its own docs describe as "gitignored by convention" (`node_modules/@expo/env/build/constants.js:33`). `git check-ignore .env.local` reports nothing, so an operator who follows Expo's convention and puts `HW_GUEST_PASSWORD` in `.env.local` can commit it (CLAUDE.md: no secrets in commits).
- Fix: add `.env*.local` (and `apps/mobile/.env*.local` is then covered too) under the *Local configuration* block.
- Effort: small
- Lesson candidate: no
- Decision: fixed (fba48bb)

### R4: C-09 lint rule lets literal strings through visible and announced props
- Severity: minor
- Where: `eslint.config.mjs:95` (`react/jsx-no-literals` with `ignoreProps: true`), `tooling/lint/layer-rules.test.ts:86`
- Problem: the block comment says "every visible string comes from the i18n catalog, never a JSX literal", but `ignoreProps: true` exempts every prop. `<Button title="Save" />`, `<View accessibilityLabel="Battery low" />` and `<S options={{ title: "Dashboard" }} />` lint with only `jsx-no-undef` errors, no `jsx-no-literals` error. Accessibility labels are how S-04/S-10 meet TR-19 (no colour-only status), so they are user-facing text that C-09 covers.
- Fix: keep `ignoreProps: true` but add a small custom check, or switch to `noAttributeStrings: true` with `allowedStrings` for enum-like values (`"header"`, `"auto"`) and accept `testID`-style props via `elementOverrides`; extend the test with an `accessibilityLabel` row. If neither is worth it now, record the gap as a `[FOLLOW-UP]` for S-04 and narrow the comment to "children text".
- Effort: medium
- Lesson candidate: no
- Decision: deferred (medium effort; switching to `noAttributeStrings` needs an allow-list for enum props, best done with the first real status UI in S-04; lint comment narrowed in 2ab69a0; FOLLOW-UP in plan.md)
