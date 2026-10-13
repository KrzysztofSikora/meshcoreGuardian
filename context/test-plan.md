# Test plan

Sources: `context/prd.md`, `context/tech-stack.md`, `context/roadmap.md`. No application code
exists yet; F-01 creates the tooling described here, and this file is revisited when a slice adds
an integration or a bug escapes.

Test levels in this repo:

| Level | Tool | Where | Touches |
|-------|------|-------|---------|
| **unit** | Vitest | `packages/*/src/**/*.test.ts`, `apps/mobile/src/**/*.test.ts`, `tools/*/src/**/*.test.ts` | pure functions only |
| **integration** | Vitest | `packages/*/test/**/*.int.test.ts` | adapter ↔ `FakeTransport` with recorded fixtures; repositories ↔ real SQLite (`node:sqlite`); use-cases ↔ real adapter + storage with fake transport and clock |
| **e2e** | Maestro on Android emulator (AVD `guardian`, API 35) | `apps/mobile/e2e/*.yaml` | app build with `EXPO_PUBLIC_TRANSPORT=fake` |
| **hardware** | `pnpm capture` (S-01 only) and human checks | `tools/capture`, PR checklist | real Heltec companion + repeater; never a gate |

## Risk register
Impact × likelihood: H/M/L. Status: `planned` until the item that owns it lands, then `covered`.

| ID | Risk | Impact | Likelihood | Level | Test(s) | Status |
|----|------|--------|------------|-------|---------|--------|
| TR-01 | A timeout, or any no-reply path, is shown as "offline/down" (brief's main honesty risk) | H | M | unit + e2e | domain: every path to `NO_RESPONSE` maps to the "cause unknown" text; catalog test forbids "offline", "down", "dead" (any case) in `en.json`; e2e `diag-no-response.yaml` asserts the visible text | covered (S-04) |
| TR-02 | Result classification wrong: partial reply classified `NO_RESPONSE`; disconnect classified `NO_RESPONSE`; malformed classified `RESPONDED` | H | M | unit | table-driven test over all check-outcome combinations → overall result + reasons (best-evidence rule, S-04) | covered (S-04) |
| TR-03 | Timeout policy wrong: cap not applied, estimate ignored, override out of range, retries exceed limit | H | M | unit | `timeoutPolicy` and `retryPolicy` tests with boundary values (estimate 0, 29 999, 30 001 ms, none; attempts 1/2/3/4) | covered (S-04) |
| TR-04 | Two requests in flight on one companion, or cooldown bypassed — radio spam | H | M | integration | `MeshClient` with `FakeTransport` + fake clock: concurrent `runDiagnostic` → second refused; run within 60 s → refused; after 60 s → allowed | covered (S-04) |
| TR-05 | Cancel does not stop retries, or leaves a dangling listener that resolves a later run | H | M | integration | abort during attempt 1 → no attempt 2 frame written; late reply after abort is ignored and not stored | covered (S-04) |
| TR-06 | Frame decoding drifts from firmware (library upgrade or firmware change) | H | M | integration | fixture tests decode every file in `packages/meshcore-adapter/fixtures/` and compare with the values logged at capture time | covered (S-01) |
| TR-07 | meshcore.js does not run under Hermes / RN (Node or Web globals) | H | M | hardware | human check in S-02: app on real phone connects and decodes contacts; recorded in PR evidence | planned (S-02 human check) |
| TR-08 | Response matched to the wrong request (late reply from a previous run, different node) | H | L | integration | fixture with interleaved replies; reply carrying another node's key prefix is not attributed to the current run | covered (S-04) |
| TR-09 | Guest password leaks to SQLite, logs, fixtures or export | H | L | integration | write known password `pw-LEAK-CANARY`, then scan the SQLite file bytes, captured log output and export output: none contain it; capture tool test asserts password field is never serialised | covered (S-01 capture, S-05 SQLite files and logs); planned (S-08 export) |
| TR-10 | Export includes full public keys by default or omits redaction preview | M | M | unit | golden files for JSON and CSV with redaction on/off; default settings → 8 hex chars only | planned (S-08) |
| TR-11 | Data lost on restart or on schema migration | H | L | integration | repository round-trip on file-backed `node:sqlite`; migration test applies every migration in order to a DB seeded at each earlier version and checks rows survive | covered S-03 (migration, restart round-trip); S-06 planned |
| TR-12 | Link drop not surfaced; in-flight run hangs; reconnect needs app restart | H | M | integration + e2e | `FakeTransport.drop()` mid-request → run ends `TRANSPORT_UNAVAILABLE` within 5 s fake time; e2e `reconnect.yaml` | covered (S-02) |
| TR-13 | Permission denied / Bluetooth off shown as "no devices found" | M | M | e2e | `permission-denied.yaml`, `bluetooth-off.yaml` with fake transport scripted states | covered (S-02) |
| TR-14 | Unsupported capability still callable or unlabelled | M | M | unit + e2e | capability → enabled-actions mapping; e2e asserts disabled button and reason text | covered (S-02: mapping + reason text); S-04: `runButton` unit tests and the `diag-unsupported.yaml` e2e |
| TR-15 | Contact sync duplicates nodes, overwrites user label/role, or deletes history of removed contacts | M | M | integration | sync twice → one row per key; user label kept over protocol name; contact missing from companion → node kept with flag | covered (S-03) |
| TR-16 | Telemetry shown without unit, 0 instead of N/A, RSSI/SNR presented as end-to-end | M | M | unit | mapping tests from decoded telemetry → domain samples; presenter tests for N/A and "last hop" labels | planned (S-06) |
| TR-17 | Trend or prediction shown on too little data | M | L | unit | trend rule: 4 samples / 23 h → "Not enough data"; 5 samples / 24 h → trend; no API returns a prediction | planned (S-07) |
| TR-18 | Background BLE activity or automatic remote requests | M | L | integration | use-case tests: app-state `background` → transport receives no writes; no timer schedules a run | covered (S-02, S-04: no write without a tap, none in the background) |
| TR-19 | Status relies on colour only; missing accessibility labels | M | M | e2e + hardware | Maestro asserts accessibility labels on status chips; S-10 audit with contrast checker and 200 % font scale | covered for the run status (S-04: e2e asserts the status words); S-10 audits the rest |
| TR-20 | Settings accept out-of-range values | L | M | unit | Zod schema boundary tests (4/5/60/61 s; 0/1/3/4 attempts) | planned (S-09) |
| TR-21 | Delete/clear leaves secrets or rows behind | M | L | integration | after delete: repository queries empty and `SecretStore` fake has no key | covered (S-05 secrets); planned (S-09 rows) |
| TR-22 | Layer boundary violated (domain imports RN, storage imports adapter) | M | M | lint | ESLint `no-restricted-imports` + one fixture file asserting lint fails | planned (F-01) |
| TR-23 | Live capture spams the radio or runs unintentionally | M | L | unit | capture tool refuses to start without `HW_COMPANION`/`HW_REPEATER`; request budget and 60 s spacing enforced with fake clock | covered (S-01) |
| TR-24 | Large history makes lists janky | L | M | hardware | S-10 profiler trace with seeded 200 nodes / 1,000 runs | planned (S-10) |

## Not tested (and why)
- **Real BLE in automated tests.** Emulators have no BLE; real behaviour is covered by fixtures (TR-06) and hardware human checks (TR-07). CI never touches radio.
- **react-native-ble-plx, expo-sqlite, expo-secure-store internals.** Third-party; we test our wrappers against fakes and the SQL against `node:sqlite`. The thin native wrappers (`BleTransport`, `ExpoSqlDriver`, `ExpoSecretStore`) are exercised by hardware human checks only.
- **meshcore.js encoder/decoder in isolation.** Covered indirectly through fixture tests on our adapter.
- **Visual layout and styling.** No snapshot tests; screen behaviour is asserted by e2e text/labels.
- **Pilot success metrics (8 of 10 users).** Measured in the pilot, not by tests.
- **Play Store upload.** Human step in S-10.

## Quality gates
| Gate | Runs | Must pass |
|------|------|-----------|
| typecheck `pnpm typecheck` | `/implement` each phase; `/review`; CI on every PR | yes |
| lint `pnpm lint` | `/implement` each phase; `/review`; CI on every PR | yes |
| unit + integration `pnpm test` | `/implement` each phase; `/review`; CI on every PR | yes |
| e2e `pnpm e2e` | `/review` on the laptop (emulator `guardian` started by the script); result attached to the PR as evidence | yes for merge, from S-02 on; F-01 needs only the smoke flow |
| mutation `pnpm mutation --mutate <file>` | `/mutation` per change on its target files; CI job `mutation-report` on PRs touching target modules | no (report only, target 80 %) |
| hardware `pnpm capture` | S-01 only, when `.env` has `HW_COMPANION` and `HW_REPEATER` | not a gate |

- `android-apk` (CI, every PR and push to `main`): release APK, `arm64-v8a`, real BLE transport, debug-signed, artifact `meshcore-guardian-<pr|branch>-<sha>` kept 14 days. It is how a person tests a PR on a real phone; not a merge gate.
- Physical devices are never used by agents (CLAUDE.md, Rules): `scripts/e2e.sh` refuses any serial that is not `emulator-*`; the runner stops while a phone is attached.
- No pre-commit hook: autonomous runs are gated by the skills; human commits rely on CI.
- CI (`.github/workflows/ci.yml`, created in F-01): Node 24 + pnpm, `pnpm install --frozen-lockfile`, then typecheck, lint, test. A separate `mutation-report` job runs Stryker on changed target files and posts the score as a job summary; it never fails the build.
- `pnpm e2e` boots the AVD `guardian` headless if no emulator is running, builds and installs the fake-transport **release** APK (JS embedded, no Metro; D-11 in repo-skeleton; `E2E_SKIP_BUILD=1` reuses it), runs `maestro test apps/mobile/e2e`, and stops the emulator it started.

## Mutation targets
| Module | Why | Target score | CI (report / break at N%) |
|--------|-----|--------------|---------------------------|
| `packages/domain/src/diagnostics/classify.ts` | best-evidence rule decides what the user is told (TR-01, TR-02) | 80 % | report |
| `packages/domain/src/diagnostics/check.ts` | check planning and the rule that stops a run (D-2) | 80 % | report |
| `apps/mobile/src/application/diagnostics/run-controller.ts` | start, cancel, refusals and the stored result (FR-05, FR-10) | 80 % | report |
| `packages/domain/src/diagnostics/rules.ts` | result × reason → explanation/next steps (FR-09) | 80 % | report |
| `packages/domain/src/policy/timeout.ts`, `retry.ts`, `cooldown.ts` | radio hygiene and false NO_RESPONSE (TR-03, TR-04) | 80 % | report |
| `packages/meshcore-adapter/src/client/mesh-client.ts` | orchestration: abort, single-flight, error → reason mapping (TR-04, TR-05, TR-08) | 80 % | report |
| `packages/meshcore-adapter/src/decode/*.ts` | companion frames → JSON-safe decoded records, corrections of meshcore.js misreads (TR-06, TR-16) | 80 % | report |
| `packages/domain/src/export/redact.ts`, `packages/domain/src/export/serialize.ts` | privacy defaults (TR-09, TR-10) | 80 % | report |
| `packages/domain/src/companion/capabilities.ts`, `firmware.ts` | capability/untested-firmware rules shown to the user (TR-14) | 80 % | report |
| `apps/mobile/src/application/connection/companion-session.ts` | connect/scan/drop state machine, background and no-auto-reconnect rules (FR-01, FR-02, TR-12, TR-13, TR-18) | 80 % | report |
| `packages/domain/src/trend.ts` | no trend on thin data (TR-17) | 80 % | report |
| `packages/storage/src/sync/contacts.ts` | merge rules for labels/roles and removed contacts (TR-15) | 70 % | report |
| `apps/mobile/src/application/nodes/guest-passwords.ts` | secret key scheme, index and clear-all leave nothing behind (TR-09, TR-21) | 80 % | report |
| `packages/domain/src/geo/geo.ts`, `packages/domain/src/nodes/nearest.ts` | distance, direction and the order of the nearest-repeater card (FR-21) | 80 % | report |

File names are the intended layout; the plan of each slice may rename them and must then update
this table. After S-04 lands, revisit whether CI should break below 70 % on the domain targets.

Tool setup (done in F-01, configuration fixed here): `@stryker-mutator/core` and
`@stryker-mutator/vitest-runner` 10.x at the root; `stryker.config.mjs` with
`testRunner: "vitest"`, `coverageAnalysis: "perTest"`, `reporters: ["clear-text", "html", "json"]`,
`thresholds: { high: 80, low: 70, break: null }`, `incremental: true`
(`incrementalFile: reports/stryker-incremental.json`, gitignored). Root script
`"mutation": "stryker run"` so that `pnpm mutation --mutate <file>` scopes to one file.

## Test data and isolation
- **Fixtures** (`packages/meshcore-adapter/fixtures/<firmware>/<scenario>.json`): produced only by `pnpm capture` on real hardware (S-01) or derived from them by documented edits (e.g. truncate a frame to make `malformed`). Each file has a header: firmware version, capture date, companion model, tool version. Public keys stay (they are public); passwords are never recorded.
- **FakeTransport**: plays a fixture as a script — on write of a matching request frame, emit the recorded response frames after the recorded delay (scaled by the fake clock). Fault scripts: `dropAfter(n)`, `silence(kind)`, `corrupt(frameIndex)`.
- **Clock**: domain and adapter take a `Clock` port; tests use a fake clock (`vi.useFakeTimers()` only inside adapter tests that rely on library timers).
- **SQLite**: each integration test opens a fresh `node:sqlite` database in a temp directory and runs all migrations; no shared state between tests.
- **SecretStore**: in-memory fake in tests; the Expo implementation is never imported by tests.
- **e2e**: the fake-transport build starts with an empty database each flow (`clearState: true`); scripted scenarios are selected by deep link `guardian://debug/scenario/<name>` available only when `EXPO_PUBLIC_TRANSPORT=fake`.

## Device matrix (Q-05)
- **Automated:** AVD `guardian` — Pixel 6 profile, Android 15 (API 35), x86_64, google_apis.
- **Hardware human checks:** your Android phone (record model and Android version in `docs/compatibility.md`); companion and repeater Heltec V3 with the firmware pinned in S-01.
- **Before the pilot (S-10):** one more phone from a different vendor, Android 12 (API 31) — the minimum.

## Cookbook

### Add a unit test
1. Put the test next to the code: `packages/domain/src/policy/timeout.test.ts` for `timeout.ts`.
2. Import only from the module under test and `packages/domain` types; no fakes needed for pure functions.
3. Prefer table-driven `it.each` over copies with one changed input.
4. Assert on returned values or thrown errors, never on internal calls.
5. Run `pnpm vitest run packages/domain/src/policy/timeout.test.ts`, then `pnpm test`.

### Add an integration test
- **Adapter with fixtures** (`packages/meshcore-adapter/test/<name>.int.test.ts`):
  1. `const t = FakeTransport.fromFixture("fixtures/<fw>/status-ok.json", { clock })`.
  2. `const client = new MeshClient(new MeshCoreConnection(t), { clock, policy })`.
  3. Drive the public API (`client.runChecks(node, { signal })`) and advance the fake clock.
  4. Assert on the returned domain result and on `t.writtenFrames` (e.g. number of attempts).
  5. For faults, use `FakeTransport.fromFixture(...).dropAfter(2)` / `.silence("status")` / `.corrupt(1)`.
- **Storage** (`packages/storage/test/<name>.int.test.ts`):
  1. `const db = await openTestDb()` (helper: temp file, `node:sqlite` driver, all migrations).
  2. Construct the repository with `db`; write through one method, read through another.
  3. For migrations, `openTestDb({ upTo: n })`, seed rows, then `migrateToLatest(db)` and assert.
- **Use-case** (`apps/mobile/src/application/<name>.int.test.ts`): wire real adapter (fake transport), real storage (`openTestDb`), `InMemorySecretStore`, fake clock via the composition helper `createTestContainer()`; assert on stored rows and returned view models.

### Add an e2e test
1. Add a scenario to `apps/mobile/src/debug/scenarios.ts` (fixture file + fault script) if none fits.
2. Create `apps/mobile/e2e/<flow>.yaml`: `appId`, `clearState`, `openLink: guardian://debug/scenario/<name>`, then taps and `assertVisible` on text or `id` (accessibility label).
3. Assert user-visible outcomes only (text, enabled/disabled, labels). Never assert colours.
4. Run one flow: `pnpm e2e --flow apps/mobile/e2e/<flow>.yaml`; all: `pnpm e2e`.
5. Keep the e2e suite under ~15 flows; push detail down to integration tests. Flows that need a connected companion share `apps/mobile/e2e/lib/connect-diag.yaml` (`runFlow` with `env: SCENARIO`); it sits in a subfolder so Maestro does not run it alone.
6. The diagnostic flows (S-04) are `diag-responded`, `diag-no-response`, `diag-transport-drop`, `diag-unsupported`, `diag-malformed` and `diag-cancel`: 15 flows in all. S-12 adds `app-look` (look pass: every screen in light and dark via the fake-build `guardian://debug/theme/<light|dark>` link, status words asserted in both schemes, TR-19; shared steps in `lib/look-screens.yaml`): 18 flows, above the ~15 guideline (plan D-13). S-05 adds `guest-password` (FR-14 AC1: save, persistence across `stopApp`/`launchApp`, remove; a smoke run with a password saved on a guest session). PR #22 adds `guest-password-admin` (a saved password that opens an admin session is removed and the user is told; scenario `diag-guest` is the guest-session variant): 20 flows.

Existing S-03 flows: `contacts-sync.yaml` (FR-04 AC1, AC2, AC4: sync after connect, Unknown role, chat contacts only under All contacts, pin to Dashboard, second sync) and `contacts-label-restart.yaml` (FR-04 AC3: label and role survive `stopApp`/`launchApp` without `clearState`).

### Run a mutation check
1. Pick the target from *Mutation targets* (or the file your change touched in that list).
2. `pnpm mutation --mutate packages/domain/src/policy/timeout.ts`
3. Open `reports/mutation/mutation.html` or read the clear-text summary.
4. Triage each survivor per `.claude/skills/mutation/SKILL.md` (`strengthen` / `equivalent` / `accept` / `bug`).
5. Never widen `--mutate` to the whole repo; never lower the targets in this file without a recorded reason.

### Install a PR build on a phone (human check)
1. Prefer a dedicated test phone without personal data. USB/wireless debugging stays **off**; the laptop never connects to the phone.
2. On the PR: Checks → `ci` → job `android-apk` → Artifacts → `meshcore-guardian-pr<N>-<sha>` (a zip with the `.apk`). From a terminal: `gh run download <run-id> -n meshcore-guardian-pr<N>-<sha>`.
3. Move the `.apk` to the phone (download it on the phone, or any file transfer) and open it; allow "install unknown apps" for that app once.
4. The version in Android's App info (`0.0.0-pr<N>.<sha>`) tells which commit you are testing. Installing a newer artifact updates the app in place; data is kept.
5. Do the PR's human checks, then tick them and comment on the PR.

### Run a hardware capture (S-01 only)
1. Pair the companion with the laptop once: `bluetoothctl` → `scan on` → `pair <MAC>` (PIN from the companion display or default) → `trust <MAC>`.
2. `.env`: `HW_COMPANION=<MAC, AA:BB:CC:DD:EE:FF>`, `HW_REPEATER=<public key hex prefix>`, optional `HW_GUEST_PASSWORD=` (read at runtime, never written).
3. `pnpm capture --scenario handshake` (device query, app start, contact list; no LoRa TX) writes `packages/meshcore-adapter/fixtures/<fw>/handshake.json`, overwriting the previous one.
4. `pnpm capture --scenario remote` adds a guest login, a status and a telemetry request to `HW_REPEATER` (≥ 60 s apart, one retry each when unanswered) and writes `remote.json`, or `remote-2.json` if that exists. The tool refuses a third remote capture (plan D-6). Exit codes: 0 done, 1 usage or `.env`, 2 no BLE connection (no file), 3 run aborted (file written).
5. Review the file (no password present), commit it, run `pnpm test`.
6. After a decoder fix: `pnpm capture --redecode <fixture.json>` rewrites `decoded`/`decodeError` from the recorded hex, without BLE. This is the only allowed edit of a recorded fixture.
