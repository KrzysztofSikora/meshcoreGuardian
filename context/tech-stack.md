# Tech stack

Versions verified on 2026-10-10 with `npm view` (registry) and the `meshcore-dev/meshcore.js`
source on GitHub. Exact React Native / React versions are whatever Expo SDK 57 pins
(`npx expo install --check`); we do not choose them independently.

## Summary
| Area | Choice | Version | Why (one line) |
|------|--------|---------|----------------|
| Runtime (tooling) | Node.js LTS | 24.x | Required by Vitest 5; ships `node:sqlite` for storage tests |
| Package manager / monorepo | pnpm workspaces, `node-linker=hoisted` | pnpm 10.x | Brief's package layout; hoisted mode is what Metro/Expo expect |
| Language | TypeScript, `strict` | 6.0.3 | typescript-eslint 8.71 supports `<6.1`; TS 7 not yet supported by the linter |
| App framework | Expo SDK 57, development build (prebuild) | expo 57.0.27 | Mandated (C-02); native BLE needs a dev build, not Expo Go |
| Navigation | expo-router | 57.0.25 | Default for SDK 57; file-based, five screens |
| BLE | react-native-ble-plx + its config plugin | 3.5.1 | Mandated (C-02) |
| MeshCore protocol codec | `@liamcottle/meshcore.js` (MIT), pinned exact | 1.15.0 | Existing frame codec with an abstract `Connection`; we add the RN transport and orchestration |
| Persistence | expo-sqlite, plain SQL migrations, `SqlDriver` interface | 57.0.4 | Four tables; no ORM; same SQL tested on `node:sqlite` |
| Secure storage | expo-secure-store (Android Keystore) | 57.0.4 | C-04 guest passwords |
| State | Zustand | 5.0.15 | Mandated; UI state only, domain stays framework-free |
| Validation | Zod | 4.6.5 | Mandated; settings, decoded responses, export schema |
| i18n | i18next + react-i18next + expo-localization | 26.4 / 17.0 / SDK 57 | C-09 catalog; plural rules ready for Polish |
| Charts | react-native-gifted-charts (+ react-native-svg) | 1.4.81 | One voltage line chart; SVG-only, no Skia/Reanimated stack |
| Lists | React Native `FlatList` | (RN) | Virtualised already; no extra dependency |
| Export / share | expo-file-system + expo-sharing | 57.0.7 / 57.0.22 | Write JSON/CSV to cache, open system share sheet |
| Unit / integration tests | Vitest (projects per package) | 5.0.3 | Mandated |
| E2E tests | Maestro CLI, Android emulator, fake-transport release APK | 2.x (cli-2.11.0) | Screen flows without BLE hardware |
| Mutation testing | Stryker + vitest-runner | 10.0.0 | Per-module mutation gate |
| Lint / format | ESLint 10 + eslint-config-expo + typescript-eslint; Prettier | 10.12 / 57.0.2 / 8.71.1 | Expo's flat config; layer rules via `no-restricted-imports` |
| Release build | EAS Build (`eas build --local` allowed) → AAB; EAS Submit to Play internal track | eas-cli current | C-07 |

## Decisions

### Monorepo and package manager
- Options considered: pnpm workspaces; npm workspaces; Yarn 4 workspaces.
- Chosen: pnpm workspaces with `node-linker=hoisted`, because it is installed locally, fast, and
  Expo documents it; hoisting avoids Metro symlink issues.
- Strongest case against: npm workspaces need no extra tool and hoist by default. We accept pnpm
  because `pnpm -r` / `--filter` make per-package gates trivial and the lockfile is stricter.
- Revisit if: Metro or EAS Build fails on pnpm resolution that `hoisted` does not fix.

### Language level
- Options considered: TypeScript 7.0 (native compiler); TypeScript 6.0.
- Chosen: 6.0.3 (exact), `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`.
- Strongest case against: TS 7 type-checks far faster. Its peer range is not yet supported by
  typescript-eslint (`<6.1.0`), and lint is a gate.
- Revisit if: typescript-eslint and Expo's template support TS 7.

### App framework and navigation
- Options considered: Expo SDK 57 dev build + expo-router; Expo + React Navigation; bare React Native.
- Chosen: Expo dev build (mandated) with expo-router — the SDK default, five routes
  (`/connect`, `/`, `/node/[id]`, `/run/[id]`, `/settings`).
- Strongest case against: React Navigation is explicit and avoids file-system conventions. With
  five screens either works; the default template means less config to maintain.
- Revisit if: routing needs outgrow file-based layout (unlikely in MVP).

### BLE transport
- Options considered: react-native-ble-plx; react-native-ble-manager.
- Chosen: ble-plx 3.5.1 (mandated), wrapped behind `MeshTransport` in `packages/meshcore-adapter`.
- Strongest case against: ble-manager has had more frequent releases; ble-plx's last publish is
  2026-02. The transport is isolated behind one interface, so a swap touches one file.
- Revisit if: the week-1 gate shows MTU/notification problems that ble-plx cannot handle.

### MeshCore protocol
- Options considered: depend on `@liamcottle/meshcore.js`; vendor its codec; write our own.
- Chosen: dependency pinned to exactly 1.15.0 (MIT). We subclass its abstract `Connection`
  (`sendToRadioFrame` → BLE write to the RX characteristic; notifications → `onFrameReceived`)
  and use it **only as a codec and event source**. Request orchestration — timeout from
  `estTimeout` × margin with the 30 s cap (D-06), `AbortSignal`, retries (D-07), single-flight
  per companion, result/reason classification — lives in our `MeshClient`, because the
  library's `login`/`getStatus`/`getTelemetry` use uncapped timers, reject with bare strings and
  cannot be cancelled.
- Strongest case against: vendoring removes surprise from upgrades and lets us type the codec.
  We accept the dependency because the version is pinned, the license is MIT (Q-04 resolved: keep
  the copyright notice in the app's licenses screen), and fixture tests catch decoding drift.
- Open risk: the library imports its own buffer utilities; whether anything needs `crypto` or
  Node/Web globals under Hermes is checked in the gate (FR-00). Fall back to vendoring if it does.
- Revisit if: a protocol change needs a fix upstream has not released, or Hermes compatibility fails.

### Persistence
- Options considered: expo-sqlite + plain SQL; Drizzle ORM + drizzle-kit; op-sqlite.
- Chosen: expo-sqlite with numbered `.sql` migrations and a minimal `SqlDriver`
  (`exec`, `run`, `all`, `transaction`). Repositories in `packages/storage` take a `SqlDriver`; the
  app passes an expo-sqlite driver, Vitest passes a `node:sqlite` driver, so repository tests run
  real SQL without a device.
- Strongest case against: Drizzle gives typed queries and generated migrations. For four tables,
  hand-written SQL plus Zod row parsing is smaller and has no codegen or pre-1.0 dependency.
- Revisit if: the schema grows past ~10 tables or queries become dynamic.

### Secure storage
- Options considered: expo-secure-store; react-native-keychain.
- Chosen: expo-secure-store (Keystore-backed, part of the SDK). Behind a `SecretStore` interface.
- Strongest case against: keychain offers biometric gating; not needed for a guest password.
- Revisit if: admin credentials enter scope.

### State and validation
- Chosen: Zustand 5 for UI/session state (connection status, run progress); Zod 4 at every
  boundary (decoded frames → domain, DB rows → domain, settings, export schema).
- Strongest case against: React context + reducer needs no dependency. Zustand is mandated and
  keeps stores testable outside React.
- Revisit if: never for MVP.

### i18n
- Options considered: i18next; own typed catalog; react-intl.
- Chosen: i18next + react-i18next, catalog `apps/mobile/src/i18n/en.json`, typed keys.
- Strongest case against: a typed object is zero-dependency for one language. Polish plurals
  (one/few/many) make a real library worth it once the second locale lands.
- Revisit if: bundle size matters (it does not at this scale).

### Charts and lists
- Options considered: victory-native (Skia); react-native-gifted-charts (SVG); hand-written SVG.
- Chosen: gifted-charts for the voltage line chart; every chart has an accessible table/list
  alternative (NFR-05). Lists use `FlatList`.
- Strongest case against: victory-native is better maintained but pulls Skia, Reanimated and
  Gesture Handler for one chart. Hand-written SVG is ~100 lines but reinvents axes and labels.
- Revisit if: chart needs grow (P1 success ratio) or FlatList misses NFR-06.

### Testing
- Options considered: Vitest + Maestro; Vitest + jest-expo/RNTL; Vitest only.
- Chosen: Vitest 5 for all logic — domain rules, adapter against recorded frame fixtures, storage
  on `node:sqlite`, use-cases and view models in `apps/mobile` (no React Native imports in
  view models). Maestro flows on an Android emulator run a build with `EXPO_PUBLIC_TRANSPORT=fake`,
  where `FakeTransport` replays fixture frames and scripted failures (timeout, disconnect,
  malformed). Real BLE behaviour is a human check with recorded evidence.
- Strongest case against: RNTL component tests are faster than e2e and check accessibility
  labels directly. We accept slower e2e to keep one unit runner, one coverage config and one
  Stryker setup; Maestro also asserts accessibility labels.
- Revisit if: e2e runtime makes the review gate impractical (> 10 min).

### Mutation testing
- Chosen: Stryker 10 with `@stryker-mutator/vitest-runner`, run per module
  (`--mutate <file>`), configured in `/test-plan`; targets `packages/domain` and the
  `MeshClient` orchestration first.

### Lint and format
- Chosen: ESLint 10 flat config from `eslint-config-expo` + typescript-eslint, Prettier.
  Layer boundaries enforced with `no-restricted-imports`: `packages/domain` imports nothing from
  other packages or React Native; `packages/storage` and `packages/meshcore-adapter` import only
  `domain`; only `apps/mobile` imports Expo/RN modules.
- Strongest case against: dependency-cruiser gives richer graphs; the ESLint rule needs no extra tool.

### Release
- Options considered: EAS Build + Submit; local Gradle from `expo prebuild`.
- Chosen: EAS Build profile `production` producing an AAB (cloud or `--local`), EAS Submit to the
  Play internal testing track.
- Strongest case against: local Gradle needs no Expo account. `eas build --local` keeps that
  option open with the same config.
- Revisit if: the Expo account or build quota becomes a blocker.

## Architecture sketch

```
apps/mobile            UI (expo-router screens) ─▶ view models / Zustand stores
   │                     └─▶ application use-cases (runDiagnostic, connectCompanion, exportReport)
   │                           │ composition root wires real or fake adapters
   ▼                           ▼
packages/domain        entities, result/reason codes, diagnostic rule table, timeout/retry policy,
                       redaction, trend rules  — pure TS, no I/O
   ▲                           ▲
packages/meshcore-adapter      packages/storage
  MeshTransport (BleTransport: ble-plx; FakeTransport: fixtures)
  MeshCoreConnection extends meshcore.js Connection   SqlDriver (expo-sqlite | node:sqlite)
  MeshClient: capabilities, contacts, login,          migrations/*.sql
    status/telemetry with abort, cap, single-flight   repositories implementing domain ports
                                                      SecretStore (expo-secure-store)
```

Dependency direction: `apps/mobile` → `domain`, `meshcore-adapter`, `storage`;
`meshcore-adapter` → `domain`; `storage` → `domain`; `domain` → nothing.
Domain defines the ports (`MeshClient`, repositories, `SecretStore`, `Clock`); adapters implement them.

## Local development
- `pnpm install` — workspaces, hoisted.
- `pnpm test` — Vitest across all packages (no device needed).
- `pnpm --filter mobile android` — `expo run:android`: prebuild + dev build on a connected phone
  (real BLE) or emulator.
- `EXPO_PUBLIC_TRANSPORT=fake pnpm --filter mobile android` — dev build with the fake transport
  (emulator, e2e).
- `pnpm e2e` — builds the fake-transport release APK (JS embedded, no Metro), installs it on the emulator and runs the Maestro flows.
- No Docker and no backend.
