# Plan: repo-skeleton (F-01)

Issue: #1

## Goal and end state
A pnpm workspace in which every gate in `CLAUDE.md` exists and passes on an empty app:

- `pnpm install`, `pnpm typecheck`, `pnpm lint`, `pnpm test` pass from a clean clone.
- Packages `apps/mobile` (name `mobile`), `packages/domain`, `packages/meshcore-adapter`,
  `packages/storage`; TypeScript 6.0.3 strict; `nodeLinker: hoisted`. (C-03)
- ESLint `no-restricted-imports` enforces the tech-stack layer rules, and a test proves a
  forbidden import fails lint (TR-22).
- Expo SDK 57 dev-build app with expo-router, five empty routes (`/connect`, `/`, `/node/[id]`,
  `/run/[id]`, `/settings`), every visible string in `apps/mobile/src/i18n/en.json` (C-09);
  ble-plx config plugin; Android `minSdkVersion` 31 (C-01, C-02).
- `EXPO_PUBLIC_TRANSPORT=fake` selects a stub transport; the Settings screen shows which one.
- `openTestDb` helper on `node:sqlite`; Stryker config from `context/test-plan.md` that runs on
  one domain file; `pnpm e2e` that boots AVD `guardian` headless when no device is attached and
  runs one Maestro smoke flow.
- `.github/workflows/ci.yml` (typecheck, lint, test; `mutation-report` job, report only).
- `.env.example` with `HW_COMPANION`, `HW_REPEATER`, `HW_GUEST_PASSWORD` empty; `.env` ignored.

No PRD functional AC is covered by this item; it covers constraints C-02, C-03, C-09 and the
tooling side of TR-22.

## Scope
- In: everything in the roadmap F-01 *Acceptance* list.
- Out: `MeshTransport` / `MeshCoreConnection` / `@liamcottle/meshcore.js` (S-01), `SqlDriver`,
  migrations and `expo-sqlite` (S-03), Zustand / Zod / secure store / charts (added by the slice
  that first uses them), real screen content, EAS config (S-10), `expo-localization` (no second
  locale yet, see D-14).

## Findings
- Repo today: only docs and workflow files (`CLAUDE.md`, `context/`, `docs/workflow.md`,
  `.claude/`); `.gitignore:1-2` ignores only `.workflow/`. No `package.json`, no lockfile.
- Toolchain on this machine: Node 24.21.0, **pnpm 12.9.1** (tech-stack says 10.x, see D-6),
  JDK 17 at `~/.local/opt/jdk-17`, SDK `~/Android/Sdk` with `platforms/android-35`,
  `build-tools/35.0.0`, system image `android-35/google_apis/x86_64`, **no NDK and no CMake**
  (Gradle for RN 0.86 will try to download them, see Risks). AVD `guardian` exists (Pixel 6,
  API 35, x86_64); `/dev/kvm` present. Maestro 2.11.0 at `~/.local/bin/maestro`. GitHub repo
  `KrzysztofSikora/meshcoreGuardian`.
- Registry (2026-10-10): expo 57.0.27, expo-router 57.0.25, expo-build-properties 57.0.22,
  react-native-ble-plx 3.5.1, i18next 26.4.3, react-i18next 17.0.16, eslint 10.12.0,
  eslint-config-expo 57.0.2, typescript-eslint 8.71.1 (peer `typescript <6.1.0`), vitest 5.0.3,
  @stryker-mutator/core + vitest-runner 10.0.0, prettier 3.9.10. `expo-template-blank-typescript`
  for SDK 57 pins react 19.2.3, react-native 0.86.3, typescript ~6.0.3 — exact RN/React versions
  come from `npx expo install`, not from us.
- **ble-plx 3.5.1 ships its own config plugin** (`app.plugin.js`, plugin name
  `react-native-ble-plx`). The separate `@config-plugins/react-native-ble-plx` (7.0.0) declares
  peer `expo ^49` and is not needed. Plugin options: `isBackgroundEnabled` (default false),
  `neverForLocation` (adds `usesPermissionFlags="neverForLocation"` to `BLUETOOTH_SCAN` and
  caps the location permissions at `maxSdkVersion 30`, i.e. never requested on our API ≥ 31),
  `modes` (iOS only). Source: `react-native-ble-plx/plugin/build/withBLE.js`,
  `withBLEAndroidManifest.js`. We use `{ isBackgroundEnabled: false, neverForLocation: true }`
  (FR-01 AC1 "no location", NFR-07).
- **eslint-config-expo 57.0.2 crashes on ESLint 10** (`react/display-name`:
  `contextOrFilename.getFilename is not a function`) because eslint-plugin-react 7.37.5
  auto-detects the React version through an API ESLint 10 removed. Verified in a scratch dir:
  setting `settings.react.version` explicitly avoids the crash and ESLint 10.12 then lints TS
  and TSX. eslint-plugin-react and eslint-plugin-import declare peer `eslint ^9`, so pnpm will
  print peer warnings (see D-5).
- **Vitest 5.0.3 `test.projects`** with inline project objects works, and `node:sqlite`
  (`DatabaseSync`) imports and runs inside a Vitest test on Node 24 without flags (verified in a
  scratch dir).
- Expo SDK 52+ detects monorepos in Metro automatically; with `nodeLinker: hoisted` no custom
  `metro.config.js` should be needed. The app's `main` is `expo-router/entry`.
- `EXPO_PUBLIC_*` variables are inlined into the JS bundle at bundle time, so the e2e build must
  have `EXPO_PUBLIC_TRANSPORT=fake` in the environment of the Gradle bundling task.
- Conflict between artifacts: `context/tech-stack.md` (*Architecture sketch*) places
  `BleTransport` (ble-plx) in `packages/meshcore-adapter` and `ExpoSqlDriver`/`SecretStore`
  (expo-secure-store) in `packages/storage`, while `CLAUDE.md` and tech-stack *Lint and format*
  say "only `apps/mobile` imports Expo/RN modules". Resolved in D-1.

## Decisions
| ID | Question | Chosen | Alternatives (and what they would buy) | Why | Reversal | Decided by |
|----|----------|--------|----------------------------------------|-----|----------|------------|
| D-1 | Where do the thin native wrappers (`BleTransport`, `ExpoSqlDriver`, `ExpoSecretStore`) live, given the artifacts disagree? | In `apps/mobile/src/platform/`; lint forbids `react-native*`, `expo*`, `@expo/*` imports in every `packages/*` | B: in `packages/meshcore-adapter` / `packages/storage` as in the tech-stack sketch, with a lint exception per file — keeps each adapter in one package; C: separate `packages/native` — one more package to maintain | `CLAUDE.md` rule and tech-stack *Lint and format* both say only `apps/mobile` imports Expo/RN; packages then stay testable in Node without RN mocks. Strongest case against: the transport splits across two packages (interface in adapter, implementation in app) | cheap (no wrapper exists yet; the rule is one block in `eslint.config.mjs`) | agent |
| D-2 | Package names | `@guardian/domain`, `@guardian/meshcore-adapter`, `@guardian/storage`; app package `mobile` | B: `@meshcore-guardian/*` — more explicit, longer imports | `CLAUDE.md` already uses `pnpm --filter mobile`, so the app must be `mobile`; short scope keeps imports readable | cheap (find/replace before more code exists) | agent |
| D-3 | How do workspace packages expose code? | Source-only: `exports: { ".": "./src/index.ts" }`, no build step; each package typechecks with `tsc --noEmit` | B: TS project references with `tsc -b` and `dist/` — faster incremental typecheck, but Metro, Vitest and Stryker would need to point at built output | Metro, Vitest and Stryker all consume TS source directly; no stale `dist/` | cheap | agent |
| D-4 | How to prove a forbidden import fails lint without breaking `pnpm lint`? | A Vitest test (`tooling/lint/layer-rules.test.ts`) runs ESLint's Node API `lintText` with virtual file paths in each package and asserts `no-restricted-imports` errors (and that allowed imports pass) | B: a committed fixture file excluded from `pnpm lint` plus a script expecting failure — visible as a file, but needs a second lint invocation and an ignore entry; C: `eslint-rule-tester` on a custom rule — overkill | Runs inside `pnpm test`, covers every package rule, no ignored files | cheap | agent |
| D-5 | ESLint major given the expo config crash on 10 | ESLint 10.12 (tech-stack) with `settings.react.version` set explicitly; if a crash remains after that, pin ESLint 9.39.x and log `[REVIEW]` | B: ESLint 9.39 from the start — matches plugin peer ranges, no warnings; C: drop eslint-config-expo and use typescript-eslint only — loses Expo/React hooks rules | Tech-stack chose 10; the scratch run shows the workaround works; the fallback is one version string | cheap | research |
| D-6 | pnpm version (tech-stack says 10.x, machine has 12.9.1) | `packageManager: "pnpm@12.9.1"` (the installed one); workspace settings (`nodeLinker: hoisted`) in `pnpm-workspace.yaml`, not `.npmrc` | B: pin pnpm 10.x via Corepack — matches the doc, but installs a new tool, which a run must not do | Use what is installed; `pnpm-workspace.yaml` settings work from pnpm 10 on. CI reads the same `packageManager` field | cheap | agent |
| D-7 | Which domain file does the Stryker smoke run on? | `packages/domain/src/diagnostics/result-code.ts`: the FR-06 result codes (`RESPONDED`, `NO_RESPONSE`, `TRANSPORT_UNAVAILABLE`, `UNSUPPORTED`, `NOT_TESTED`) as a const tuple, a `ResultCode` type and an `isResultCode(value: unknown)` guard | B: a throwaway `sum()` — no product value and must be deleted later; C: `timeout.ts` policy — real S-04 logic, out of scope | Codes are fixed by PRD FR-06, so S-04 can build on it; the guard has real branches for Stryker to mutate | cheap | agent |
| D-8 | What is the "stub transport" before S-01 defines `MeshTransport`? | `apps/mobile/src/config/transport-mode.ts` (`parseTransportMode`) and `apps/mobile/src/composition/transport.ts` (`createTransport(mode)` returning `{ kind: "ble" \| "fake" }` stubs). No `MeshTransport` interface in F-01 | B: define a draft `MeshTransport` in `packages/meshcore-adapter` now — S-01 would inherit a guess made without hardware | S-01 owns the transport interface (Decided up front); the composition file is the single place S-01/S-02 swap | cheap | agent |
| D-9 | `EXPO_PUBLIC_TRANSPORT` parsing | Unset or empty → `ble`; `ble` → `ble`; `fake` → `fake`; anything else throws `Error("Unknown EXPO_PUBLIC_TRANSPORT: <v>")` at startup | B: unknown → `ble` silently — never crashes, but a typo (`Fake`) would run real BLE in e2e | Failing loudly catches misconfigured builds; production builds leave it unset | cheap | agent |
| D-10 | Android application id and URL scheme | `applicationId` / `package` `io.github.krzysztofsikora.guardian`; scheme `guardian` (test-plan uses `guardian://debug/...`) | B: `com.meshcoreguardian.app` — nicer, but implies a domain nobody owns; C: decide at S-10 — but the id is baked into every build and the e2e `appId` now | Namespace derived from the GitHub owner needs no domain; only the id is permanent, and only after the first Play upload (S-10) | costly (permanent once uploaded to Play in S-10; cheap until then — one value in `app.json` and in `apps/mobile/e2e/*.yaml`) | agent |
| D-11 | Which build does `pnpm e2e` install? | Release variant (`assembleRelease`, JS bundle embedded, signed with the debug keystore Expo's prebuild template configures), `x86_64` only, `EXPO_PUBLIC_TRANSPORT=fake` | B: debug build + Metro started by the script — faster rebuilds, but a second long-running process and flaky "Unable to load script" failures | No Metro dependency makes Maestro runs deterministic; `E2E_SKIP_BUILD=1` reuses the last APK for fast re-runs | cheap | agent |
| D-12 | Commit the generated `android/` folder? | No: Continuous Native Generation; `apps/mobile/android/` and `apps/mobile/ios/` are gitignored and produced by `expo prebuild` | B: commit `android/` — native edits possible without plugins, but every SDK upgrade becomes a manual merge | All native config so far is expressible in `app.json` plugins (ble-plx, expo-build-properties) | cheap | agent |
| D-13 | Scope of the CI `mutation-report` job | `scripts/mutation-changed.sh`: for files changed vs the PR base whose path is listed in `stryker.targets` (one glob per line, mirroring test-plan *Mutation targets*), run `pnpm mutation --mutate <file>` and append the score to `$GITHUB_STEP_SUMMARY`; job has `continue-on-error: true` | B: run Stryker on all of `packages/domain/src` each PR — simpler, slow and noisy; C: no job until S-04 — roadmap asks for it now | Mirrors the test-plan table; one text file to edit when a slice renames a target | cheap | agent |
| D-14 | Install `expo-localization` now? | No. i18next initialised with `lng: "en"`, `fallbackLng: "en"`, one resource `en.json` | B: install and detect device locale — ready for Polish, but a native module with nothing to choose between | English only (C-09); adding it later touches `src/i18n/index.ts` only | cheap | agent |
| D-15 | Install `expo-dev-client`? | No. `expo run:android` builds a debug app that loads JS from Metro without it | B: install it — dev launcher UI and network inspector, plus a larger native surface | Not needed for any gate or check in this item | cheap | agent |

## Design

### Workspace layout
```
package.json               root scripts, devDependencies (tooling only), packageManager
pnpm-workspace.yaml        packages: apps/*, packages/*; nodeLinker: hoisted
tsconfig.base.json         strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes,
                           module esnext, moduleResolution bundler, noEmit
eslint.config.mjs          eslint-config-expo/flat + layer rules + react version setting
.prettierrc.json, .prettierignore
vitest.config.ts           test.projects: domain, meshcore-adapter, storage, mobile, tooling
stryker.config.mjs         as fixed in test-plan *Tool setup*
stryker.targets            mutation target globs (D-13)
scripts/e2e.sh             emulator boot, build, install, maestro
scripts/mutation-changed.sh
tooling/lint/layer-rules.test.ts
.github/workflows/ci.yml
.env.example
packages/<pkg>/{package.json,tsconfig.json,src/index.ts,src/**/*.test.ts}
apps/mobile/{package.json,app.json,tsconfig.json,src/app/**,src/i18n/**,src/config/**,src/composition/**,e2e/smoke.yaml}
```

### Root scripts (contract used by `CLAUDE.md` Gates)
| Script | Command |
|--------|---------|
| `typecheck` | `pnpm -r --if-present typecheck` (each package: `tsc --noEmit -p .`) |
| `lint` | `eslint .` |
| `test` | `vitest run` |
| `e2e` | `bash scripts/e2e.sh` (extra args passed to Maestro; `--flow <file>` runs one flow) |
| `mutation` | `stryker run` (so `pnpm mutation --mutate <file>` scopes to one file) |
| `format` | `prettier --write .` (not a gate) |

### Layer rules (`no-restricted-imports`, per file glob)
| Files | Forbidden |
|-------|-----------|
| `packages/domain/**` | `@guardian/*`, `react`, `react-*`, `react-native`, `react-native-*`, `expo`, `expo-*`, `@expo/*`, `@liamcottle/*`, `node:*` |
| `packages/meshcore-adapter/**` | `@guardian/storage`, `@guardian/*/src/*` deep imports, `react*`, `expo*`, `@expo/*` |
| `packages/storage/**` | `@guardian/meshcore-adapter`, deep imports, `react*`, `expo*`, `@expo/*`, `@liamcottle/*` |
| `packages/**` except test files of `storage` | `node:sqlite` only allowed in `packages/storage/test/**` |
| `apps/mobile/**` | deep imports `@guardian/*/src/*` (only package entry points) |

`@liamcottle/meshcore.js` is not installed yet; the rule restricting it to
`packages/meshcore-adapter` is written now so S-01 inherits it.

### Domain smoke module (D-7)
`packages/domain/src/diagnostics/result-code.ts`: `RESULT_CODES` (readonly tuple of the five
FR-06 codes), `type ResultCode = (typeof RESULT_CODES)[number]`,
`isResultCode(value: unknown): value is ResultCode`. Re-exported from `src/index.ts`.

### Transport switch (D-8, D-9)
- `parseTransportMode(raw: string | undefined): TransportMode` where
  `TransportMode = "ble" | "fake"`.
- `createTransport(mode: TransportMode): StubTransport` with
  `StubTransport = { readonly kind: TransportMode }`; replaced in S-01/S-02.
- `apps/mobile/src/composition/index.ts` reads `process.env.EXPO_PUBLIC_TRANSPORT` once (literal
  access, required for Expo inlining) and exports the container `{ transport }`.
- Settings screen renders `t("settings.transport", { mode })` → "Transport: BLE" / "Transport:
  Fake (development)" (mode labels are catalog keys too).

### App shell
- `apps/mobile/app.json`: name "MeshCore Guardian", slug `meshcore-guardian`, scheme `guardian`,
  `android.package` (D-10), `newArchEnabled` default, plugins: `expo-router`,
  `["react-native-ble-plx", { "isBackgroundEnabled": false, "neverForLocation": true }]`,
  `["expo-build-properties", { "android": { "minSdkVersion": 31 } }]`. Expo router root
  `src/app` (`expo-router` plugin option `root` if needed, else the default `app/` — the
  implementer follows the SDK 57 template convention and records it).
- Routes: `_layout.tsx` (Stack, initialises i18n), `index.tsx` (Dashboard), `connect.tsx`,
  `node/[id].tsx`, `run/[id].tsx`, `settings.tsx`. Each renders a heading
  (`accessibilityRole="header"`) and one placeholder line, both from `en.json`.
- `src/i18n/en.json` keys: `app.name`, `<screen>.title`, `<screen>.placeholder` for the five
  screens, `settings.transport`, `transport.ble`, `transport.fake`. `src/i18n/index.ts` exports
  the initialised i18next instance; typed keys via `i18next` module augmentation
  (`CustomTypeOptions.resources`).

### Test DB helper (roadmap acceptance; storage foundation is S-03)
`packages/storage/test/helpers/open-test-db.ts`:
`openTestDb(): { db: DatabaseSync; path: string; close(): void }` — creates a temp directory,
opens a file-backed `node:sqlite` database, `close()` closes and removes the directory. No
migrations and no `SqlDriver` yet; S-03 extends the signature to `openTestDb({ upTo? })`
returning a `SqlDriver` with migrations applied, as described in test-plan *Cookbook*.

### e2e script (`scripts/e2e.sh`)
1. Default `JAVA_HOME=${JAVA_HOME:-$HOME/.local/opt/jdk-17}`,
   `ANDROID_HOME=${ANDROID_HOME:-$HOME/Android/Sdk}`; prepend `platform-tools`, `emulator`,
   `$HOME/.local/bin` to `PATH`.
2. If `adb devices` lists no device: `emulator -avd guardian -no-window -no-audio
   -no-boot-anim -no-snapshot-save &`, `trap` kills it on exit; wait for `sys.boot_completed=1`
   (timeout 300 s, then fail with a clear message).
3. Unless `E2E_SKIP_BUILD=1`: in `apps/mobile`, `EXPO_PUBLIC_TRANSPORT=fake npx expo prebuild
   --platform android --no-install`, then `./gradlew assembleRelease
   -PreactNativeArchitectures=x86_64`.
4. `adb install -r` the release APK.
5. `maestro test` with the given flow (`--flow <file>`) or the whole `apps/mobile/e2e` dir.

Smoke flow `apps/mobile/e2e/smoke.yaml`: `appId` (D-10), `clearState`, `launchApp`,
`assertVisible` the dashboard title, `openLink: guardian://settings`, `assertVisible`
"Transport: Fake (development)".

### CI (`.github/workflows/ci.yml`)
- `on: pull_request` and `push` to `main`; Node 24 via `actions/setup-node`, pnpm via
  `pnpm/action-setup` (reads `packageManager`), `pnpm install --frozen-lockfile`.
- Job `checks`: `pnpm typecheck`, `pnpm lint`, `pnpm test`.
- Job `mutation-report` (pull_request only, `continue-on-error: true`, `fetch-depth: 0`):
  `bash scripts/mutation-changed.sh origin/${{ github.base_ref }}`.
- No e2e in CI (no emulator on hosted runners in scope; test-plan runs e2e locally).

## Phases

### Phase 1: Workspace, packages and quality tooling
- Files:
  - `package.json`: root scripts `typecheck`, `lint`, `test`, `format` (e2e/mutation in Phase 3);
    devDependencies `typescript@6.0.3` (exact), `eslint@10.12.0`, `eslint-config-expo@57.0.2`,
    `typescript-eslint@8.71.1`, `vitest@5.0.3`, `prettier`, `@types/node`;
    `packageManager: pnpm@12.9.1`; `engines.node: ">=24"`. Contract: root script names.
  - `pnpm-workspace.yaml`: `packages: [apps/*, packages/*]`, `nodeLinker: hoisted`.
  - `tsconfig.base.json`: compiler options listed in Design. Contract: every package extends it.
  - `eslint.config.mjs`: expo flat config, `settings.react.version` (D-5), layer rules table,
    ignores (`**/node_modules`, `apps/mobile/android`, `reports`, `.workflow`).
  - `.prettierrc.json`, `.prettierignore`.
  - `vitest.config.ts`: `test.projects` for `packages/domain`, `packages/meshcore-adapter`,
    `packages/storage`, `tooling` (include `src/**/*.test.ts`, `test/**/*.int.test.ts`,
    `test/**/*.test.ts`). `apps/mobile` project is added in Phase 2.
  - `packages/domain/{package.json,tsconfig.json,src/index.ts}`,
    `src/diagnostics/result-code.ts` + `result-code.test.ts`. Contract: `RESULT_CODES`,
    `ResultCode`, `isResultCode` (D-7).
  - `packages/meshcore-adapter/{package.json,tsconfig.json,src/index.ts,src/index.test.ts}`:
    depends on `@guardian/domain` (`workspace:*`); the test imports `isResultCode` through the
    package name to prove workspace resolution.
  - `packages/storage/{package.json,tsconfig.json,src/index.ts}`,
    `test/helpers/open-test-db.ts`, `test/open-test-db.int.test.ts` (creates a table, writes and
    reads a row through a file-backed DB, `close()` removes the temp dir).
  - `tooling/lint/layer-rules.test.ts` (D-4): `it.each` over (file path, import, expected
    error?) rows covering each row of the layer table, including one allowed import per package.
  - `.gitignore`: add `node_modules/`, `.env`, `reports/`, `apps/mobile/android/`,
    `apps/mobile/ios/`, `apps/mobile/.expo/`, `*.apk`, `coverage/`.
  - `.env.example`: `HW_COMPANION=`, `HW_REPEATER=`, `HW_GUEST_PASSWORD=` with one comment line
    each; commented `# EXPO_PUBLIC_TRANSPORT=fake`.
  - `pnpm-lock.yaml`: generated.
- Proves: TR-22 (lint, via Vitest + ESLint API); C-03 package layout (typecheck + resolution test).
- Agent checks: `pnpm install`, `pnpm typecheck`, `pnpm lint`, `pnpm test`; `git check-ignore .env`.
- Human checks: none.

### Phase 2: Expo app shell with routes, i18n and transport switch
- Files:
  - `apps/mobile/package.json`: name `mobile`, `main: expo-router/entry`, scripts `android`
    (`expo run:android`), `start`, `typecheck`; dependencies installed with `npx expo install`
    (`expo`, `expo-router`, `react`, `react-native`, `react-native-screens`,
    `react-native-safe-area-context`, `expo-linking`, `expo-constants`, `expo-status-bar`,
    `expo-build-properties`, `react-native-ble-plx@3.5.1`), plus `i18next`, `react-i18next`,
    `@guardian/domain` (`workspace:*`). Contract: `pnpm --filter mobile android` from `CLAUDE.md`.
  - `apps/mobile/app.json`: as in Design (D-10, ble-plx plugin options, minSdk 31).
  - `apps/mobile/tsconfig.json`: extends `expo/tsconfig.base` and applies the strict flags of
    `tsconfig.base.json`; includes `expo-env.d.ts` / `.expo/types`.
  - `apps/mobile/src/app/{_layout,index,connect,settings}.tsx`, `node/[id].tsx`, `run/[id].tsx`.
  - `apps/mobile/src/i18n/{en.json,index.ts,i18next.d.ts}`.
  - `apps/mobile/src/i18n/catalog.test.ts`: every key under the five screens has a non-empty
    string; `t("settings.transport", { mode })` interpolates for both modes.
  - `apps/mobile/src/config/transport-mode.ts` + `transport-mode.test.ts` (D-9 table:
    undefined, "", "ble", "fake", "Fake", "usb").
  - `apps/mobile/src/composition/{transport.ts,index.ts}` (D-8).
  - `vitest.config.ts`: add the `mobile` project (`apps/mobile/src/**/*.test.ts`, Node
    environment; tests import no React Native).
  - `eslint.config.mjs`: only if the app needs globs adjusted (e.g. `expo-env.d.ts` ignore).
- Proves: C-02 (Expo dev build config, ble-plx plugin, minSdk 31), C-09 (catalog), transport
  switch (unit tests).
- Agent checks: `pnpm install`, `pnpm typecheck`, `pnpm lint`, `pnpm test`;
  `cd apps/mobile && npx expo config --type public` (plugins resolve);
  `npx expo prebuild --platform android --no-install` then grep the generated
  `android/app/src/main/AndroidManifest.xml` for `BLUETOOTH_SCAN` with
  `neverForLocation` and `android/gradle.properties` / `build.gradle` for `minSdkVersion` 31
  (save the grep output to `evidence/phase-2-manifest.txt`); the generated `android/` stays
  ignored.
- Human checks: on a real Android phone with USB debugging, `pnpm --filter mobile android`
  installs and opens the app on the Dashboard title; deep link
  `adb shell am start -d guardian://settings` shows "Transport: BLE". No location permission is
  listed under App info → Permissions.

### Phase 3: Mutation, e2e and CI
- Files:
  - `package.json`: scripts `e2e`, `mutation`; devDependencies `@stryker-mutator/core@10.0.0`,
    `@stryker-mutator/vitest-runner@10.0.0`.
  - `stryker.config.mjs`: `testRunner: "vitest"`, `coverageAnalysis: "perTest"`,
    `reporters: ["clear-text", "html", "json"]`, `thresholds: { high: 80, low: 70, break: null }`,
    `incremental: true`, `incrementalFile: "reports/stryker-incremental.json"`, default
    `mutate: ["packages/domain/src/**/*.ts", "!**/*.test.ts"]`, `htmlReporter.fileName` /
    `jsonReporter.fileName` under `reports/mutation/`.
  - `stryker.targets` and `scripts/mutation-changed.sh` (D-13).
  - `scripts/e2e.sh` (Design *e2e script*, D-11).
  - `apps/mobile/e2e/smoke.yaml`.
  - `.github/workflows/ci.yml` (Design *CI*).
- Proves: mutation gate runs (score on `result-code.ts`); e2e gate runs the smoke flow
  (launch + fake transport selected); CI definition.
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`;
  `pnpm mutation --mutate packages/domain/src/diagnostics/result-code.ts` (report saved to
  `evidence/phase-3-mutation.txt`); `bash -n scripts/e2e.sh scripts/mutation-changed.sh`;
  `pnpm e2e` (output saved to `evidence/phase-3-e2e.txt`). If the emulator or Gradle cannot
  complete on this machine (e.g. NDK/CMake download fails), log `[REVIEW]` with the failing step
  and turn the e2e run into a human check, as the roadmap *Unknowns* allow.
- Human checks: CI workflow `ci` is green on this PR (both jobs; `mutation-report` shows a
  summary or "no target files changed"); if the agent could not run it, `pnpm e2e` on the laptop
  passes the smoke flow.

## Risks and unknowns
- **Gradle needs NDK/CMake** that are not installed; RN 0.86's Gradle plugin downloads them on
  first build (network, several GB, 10+ min). If that fails, `pnpm e2e` becomes a human check
  (Phase 3). Installing SDK components by hand is a tool setup the run must not do.
- **ESLint 10 vs expo plugins** (peer `^9`): workaround verified for the known crash; other rules
  may hit removed APIs on TSX. Fallback D-5.
- **Stryker 10 + Vitest 5 `projects`** with `perTest` coverage is not verified; if Stryker cannot
  run through the projects config, give Stryker its own `vitest.stryker.config.ts` limited to the
  domain project and log `[minor]`.
- **TS 6 + `expo/tsconfig.base`**: the template pins TS ~6.0.3, so it should be fine; if
  `ignoreDeprecations` is needed, set it in `apps/mobile/tsconfig.json` only.
- **First Gradle build time** may exceed tool timeouts; run `pnpm e2e` in the background with a
  long timeout.
- **pnpm 12 vs tech-stack 10.x** (D-6): tech-stack needs a one-line update; logged as
  `[FOLLOW-UP]` for `/tech-stack` rather than edited here.
- Tech-stack *Architecture sketch* vs `CLAUDE.md` on native wrapper placement (D-1): the
  tech-stack sketch should be updated if the PR reviewer confirms D-1.

## Progress
<!-- One line per phase. /implement ticks it in the phase's own commit. -->
- [ ] Phase 1: Workspace, packages and quality tooling
- [ ] Phase 2: Expo app shell with routes, i18n and transport switch
- [ ] Phase 3: Mutation, e2e and CI

## Human checks
<!-- Filled by /implement: one open checkbox per human check, with how to run it and evidence. -->

## Deviations
<!-- [minor] / [REVIEW] / [FOLLOW-UP] / [STUCK] entries, see autonomy.md section 3 -->
- [FOLLOW-UP] `context/tech-stack.md` says pnpm 10.x; the machine and this change use pnpm 12.9.1 (D-6). Update the tech-stack row.
- [FOLLOW-UP] `context/tech-stack.md` *Architecture sketch* places `BleTransport`/`ExpoSqlDriver`/`SecretStore` inside packages; D-1 puts them in `apps/mobile/src/platform/`. Update the sketch once D-1 is confirmed.

## Review response
<!-- revise mode only: one line per plan-review finding and what changed -->
