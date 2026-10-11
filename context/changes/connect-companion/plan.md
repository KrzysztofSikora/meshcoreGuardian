# Plan: connect-companion (S-02)

## Goal and end state
From the app, the operator grants Bluetooth access, scans, connects to the MeshCore companion,
sees its firmware and capabilities, and gets an honest state when the link drops or a step fails.
When done:

- The Connect screen explains local BLE access and asks for `BLUETOOTH_SCAN` and
  `BLUETOOTH_CONNECT` only. If access is denied it shows "Permission required" with an "Open
  settings" button and starts no scan (FR-01 AC1, AC2).
- With Bluetooth off, a scan attempt shows "Bluetooth is off", never "No companions found" (FR-01 AC3).
- A scan lists an advertising companion and the user can connect to it (FR-01 AC4). The
  connection shows exactly one of Disconnected / Connecting / Connected / Connection failed (with
  reason), and a failure offers Retry (FR-01 AC5).
- A link drop sets Disconnected as soon as the transport reports it, and ends any in-flight request
  as `TRANSPORT_UNAVAILABLE` (FR-02 AC1). Reconnect works without restarting the app (FR-02 AC2).
  In the background, no scan, connect or request starts (FR-02 AC3, NFR-07).
- After the handshake the screen shows the firmware version and the five capabilities (contacts,
  login, status request, telemetry request, trace) (FR-03 AC1). An unsupported capability reads "Not
  supported by companion firmware <version>" (FR-03 AC2). A firmware outside the compatibility
  record shows "Untested firmware" and nothing else is disabled (FR-03 AC3).
- The last companion is remembered for a quick reconnect. Connecting is always started by the user.
- The e2e flows on `FakeTransport` cover permission denied, Bluetooth off, connect success, connect
  failure + Retry, link drop + Reconnect, and an unsupported capability. A person checks the CI APK
  on a real phone against the Heltec (bonding, MTU, meshcore.js under Hermes).

## Scope
- In: domain connection/capability/firmware model; `FakeTransport` (fixture replay + faults) and a
  handshake-only `MeshClient` in `packages/meshcore-adapter`; application session controller
  (pure TS, Zustand vanilla store); ble-plx `BlePlatform` + `BleTransport`, Android permissions,
  remembered companion, Metro config for meshcore.js; Connect screen, connection status on the
  Dashboard, debug scenario deep link (fake builds only); six Maestro flows; test-plan and
  compatibility updates.
- Out: contacts sync and the `0x90` contacts-full push (S-03); login/status/telemetry requests,
  timeout/retry policy and cooldown (S-04); storage foundation / migrations (S-03); settings UI
  (S-09); removing Expo's default manifest permissions (S-10 follow-up from F-01); iOS.

## Findings
- `MeshTransport` (`packages/meshcore-adapter/src/transport/mesh-transport.ts:8`) starts at an open
  link: `write`, `onFrame`, `onDisconnect`, `close`. Connecting belongs to each implementation's
  factory (S-01 D-2). So scanning, permissions and connecting need their own port in the app.
- `MeshCoreConnection` (`src/connection/mesh-core-connection.ts:19`) subclasses meshcore.js
  `Connection` over any transport. meshcore.js emits events through `setTimeout(0)`
  (`node_modules/@liamcottle/meshcore.js/src/events.js:38`), and it reads firmware 1.17 device
  info wrongly. Our `decodeFrame` (`src/decode/decode-frame.ts:151`) re-reads it
  (`src/decode/device-info.ts:26`).
- Handshake as captured (`fixtures/v1.17.1-d929643/handshake.json` frames 0–3): tx `1603`
  (device query, protocol 3), rx device info (~95 ms), tx `01 01 000000000000 74657374` (app start,
  appName "test", hard-coded in meshcore.js `sendCommandAppStart`, `connection.js:37`), rx self
  info (~96 ms). Device info: firmware `v1.17.1-d929643`, `firmwareVerCode` 13, model `Heltec V3`.
  Self-info name redacted to `companion` (S-01 D-13).
- Firmware source (`meshcore-dev/MeshCore` `examples/companion_radio/MyMesh.cpp`, read
  2026-10-11) tags device-info fields `v3+`, `v9+`, `v10+`, the telemetry-mode byte `v5+`, and
  `v8+`/`v12+`/`v13+` commands. It gives **no** version tag for `CMD_SEND_LOGIN`,
  `CMD_SEND_STATUS_REQ`, `CMD_SEND_TELEMETRY_REQ` or `CMD_SEND_TRACE_PATH`. Capability detection
  by version is therefore mostly `UNVERIFIED` (D-5).
- **Metro risk:** meshcore.js `src/index.js:4` imports `NodeJSSerialConnection` and
  `TCPConnection`. They hold `await import('serialport')` and `await import("net")`
  (`nodejs_serial_connection.js:16`, `tcp_connection.js:18`). `serialport` is a real dependency of
  the library (`package.json:35`), so Metro will try to bundle it and its Node-only modules. This
  probably fails the app bundle as soon as the app imports the adapter (D-13).
- **Hermes risk:** meshcore.js uses `TextEncoder` (`buffer_writer.js:46`, app start) and
  `TextDecoder` (`buffer_reader.js:27`). So does our `cString` (`src/decode/bytes.ts:15`). The e2e
  release build runs Hermes on the emulator with the fake transport, so the handshake flow
  exercises both before any phone test.
- App today: `apps/mobile/src/composition/transport.ts:6` returns a `StubTransport`. The F-01 D-8
  placeholder is replaced here. `parseTransportMode` (`src/config/transport-mode.ts:7`) already
  separates `ble`/`fake`. Native wrappers live in `apps/mobile/src/platform/` (F-01 D-1). Lint
  forbids RN/Expo in `packages/*` and meshcore.js outside the adapter (`eslint.config.mjs:86-108`).
  `apps/mobile` does not depend on `@guardian/meshcore-adapter` yet, and Zustand is not installed.
- ble-plx 3.5.1 (`node_modules/react-native-ble-plx/src/BleManager.js`): `state()` /
  `onStateChange` (`:291`, `:312`), `startDeviceScan(UUIDs, options, listener)` (`:364`),
  `connectToDevice(id, { requestMTU, timeout })` (`:487`), `requestMTUForDevice` (`:442`). Values
  are base64 strings. The config plugin is set to `neverForLocation: true`
  (`apps/mobile/app.json:14`).
- BLE IDs are verified in S-01 (`docs/compatibility.md`, BLE table): NUS service `6e400001-…`,
  RX write `6e400002-…`, TX notify `6e400003-…`. Each write or notification is one frame, and the
  longest frame seen was 148 bytes (laptop MTU). The companion needs a PIN bond. Once, after a run,
  the companion did not advertise for ~5 min (S-01 FOLLOW-UP).
- `fixtures.int.test.ts:16` globs `../fixtures/**/*.json` and decodes every file. Derived scenario
  data therefore stays out of `fixtures/` (D-3).
- Test plan: e2e scenarios are chosen by the deep link `guardian://debug/scenario/<name>`, fake
  builds only, with scenarios in `apps/mobile/src/debug/scenarios.ts`. Risks TR-07, TR-12, TR-13,
  TR-14 and TR-18 are planned for S-02.

## Decisions
| ID | Question | Chosen | Alternatives (and what they would buy) | Why | Reversal | Decided by |
|----|----------|--------|----------------------------------------|-----|----------|------------|
| D-1 | Where does `FakeTransport` live? | `packages/meshcore-adapter/src/transport/fake-transport.ts`, exported from the adapter entry point. Pure TS, used by adapter tests, app tests and the fake app build | B: `apps/mobile/src/platform/fake/`. Keeps test doubles out of the package, but adapter integration tests (test-plan cookbook) could not use it. C: adapter `test/support`. Not reachable by the app build | The tech stack puts `FakeTransport` next to `BleTransport` under `MeshTransport`. One replay engine for unit, integration and e2e. Strongest case against: test tooling becomes part of the package surface (S-01 D-12) | cheap | agent |
| D-2 | How does `FakeTransport` match a write to recorded replies? | By command code (byte 0) in recorded order: the first unconsumed tx frame with the same code releases the rx frames that follow it (until the next tx), each after its recorded `tMs` gap. A write that matches nothing gets no reply. Faults: `silence(code)`, `corrupt(rxSeq)` (truncates the frame to 1 byte), `dropAfterWrites(n)`, and a manual `drop()` | B: exact hex match. Strict, but our app start may send a different appName or protocol byte than the capture tool. C: ignore writes and replay on a timer. Simple, but cannot prove request/response order | The code-based match survives harmless payload differences and still fails a test that sends the wrong command | cheap | agent |
| D-3 | What replay data does the fake app build use? | `packages/meshcore-adapter/src/transport/handshake-script.ts`: frames 0–3 of `handshake.json` (hex and `tMs`) as a constant. A test asserts they equal the fixture's frames byte for byte. `withFirmware(frames, { verCode, version })` derives the unsupported/untested variant by rewriting device-info bytes 1 and 60–79 | B: import the full `handshake.json` into the app. Real contacts for S-03, but it ships ~290 KB and 350 contact frames in every APK. C: derived JSON files under `fixtures/`. The fixture test would decode them as captures, and test-plan says fixtures come from hardware | Small, locked to the real capture by a test, and lives outside `fixtures/`. S-03 decides how to replay contacts | cheap | agent |
| D-4 | Handshake protocol, timeouts and retries | `MeshClient.handshake({ signal })`: send device query (protocol `COMPANION_PROTOCOL_VERSION`) and wait for `deviceInfo` (**30 s**, which covers the Android pairing/PIN dialog that the first encrypted access may trigger). Then send app start and wait for `selfInfo` (**5 s**). No automatic retry: the user taps Retry. Errors: `HandshakeTimeoutError` (step name), `MalformedFrameError` passed through, `TransportUnavailableError` on disconnect or abort-by-drop, `AbortError` on the signal | B: one 10 s budget for the whole handshake. Simpler, but a PIN dialog would fail it. C: retry the device query once. Hides a stuck link from the user | Captured answers took ~100 ms, so the bounds are generous but finite (radio hygiene). The pairing time on Android is `UNVERIFIED` (human check). Constants sit in one file | cheap | agent |
| D-5 | How are capabilities derived without a version table in firmware source? | Domain table `CAPABILITY_MIN_VER_CODE`: contacts 1, login 1, status 1, trace 1, telemetry 5 (the firmware tags the telemetry-mode byte `v5+`). Capability = supported if `firmwareVerCode ≥ min`. Each entry is marked `UNVERIFIED` in `docs/compatibility.md`, except that contacts/login/status/telemetry were verified at ver code 13 in S-01 (trace was not exercised) | B: every capability supported on tested firmware, "unknown" on untested. Honest, but nothing is ever "unsupported", so FR-03 AC2 cannot happen. C: probe each command at connect. Login, status and trace would transmit over LoRa without a user tap (FR-10 AC6) | The only version facts available, kept in one constant that S-04 can correct when an `ERR` reply shows a command is unknown | cheap | research |
| D-6 | What is the "compatibility record" for FR-03 AC3? | Domain constant `TESTED_FIRMWARE = ["1.17"]`, matched on `major.minor` parsed from `firmwareVersion` (`/^v?(\d+)\.(\d+)/`). Unparseable → untested | B: exact string `v1.17.1-d929643`. Every build hash would read as untested. C: by `firmwareVerCode`. Several releases share a ver code | S-01 verified 1.17.1; patch releases rarely change the protocol. Adding a line adds a version | cheap | agent |
| D-7 | How is the last companion remembered across restarts? | `LastCompanionStore` port in the application layer. Implementation `apps/mobile/src/platform/last-companion-store.ts` on `expo-sqlite/kv-store` (key `companion.last`, JSON `{ id, name }`, Zod-parsed; invalid → null). `expo-sqlite` 57.0.4 is installed with `npx expo install` | B: memory only until S-03. No new native module, but the companion is forgotten on every restart. C: wait for the S-03 settings table. Correct long-term home, but the user decided "remembered" for this item and S-03 owns migrations. D: expo-file-system JSON. Another native module with no later use | `expo-sqlite` is the stack's choice, so S-03 adds it anyway. One file behind a port, so S-03 can move the key into its settings table | costly (persisted data shape, first native storage module) | agent |
| D-8 | How does the scan find companions? | No OS-level UUID filter. Client side, `isCompanionAdvertisement(ad)` keeps devices that advertise the NUS service UUID **or** have a local name starting with `MeshCore`. The scan stops itself after 10 s (and on background or leaving the screen). Devices are deduplicated by id | B: OS filter on the NUS UUID. Cheaper scanning, but if the companion does not put the UUID in its advertisement, the list stays empty (`UNVERIFIED` on Android). C: list every BLE device. Always finds it, but noisy and confusing | Robust to either advertising style. The 10 s window matches FR-01 AC4 and bounds radio use | cheap | agent |
| D-9 | MTU handling | Request MTU 512 in `connectToDevice`. Keep the negotiated value in the session and show it under "Technical details" on the Connect screen. No refusal for a small MTU (truncated frames already surface as `MalformedFrameError`) | B: refuse when MTU < 151 (148 + 3). Explicit, but the firmware may fragment and work anyway (`UNVERIFIED`). C: do not request. Android's default 23 would truncate 148-byte contact frames | Gives the human check the number it needs (roadmap unknown) without guessing a rule | cheap | agent |
| D-10 | Connection state and failure reasons | Domain `ConnectionState = { kind: "disconnected" } \| { kind: "connecting" } \| { kind: "connected", companion } \| { kind: "failed", reason }`. `ConnectFailureReason` = `CONNECT_TIMEOUT` (no BLE link in 15 s), `CONNECT_ERROR` (platform refused or pairing failed), `HANDSHAKE_NO_RESPONSE`, `HANDSHAKE_MALFORMED`, `LINK_LOST` (dropped while connecting), `BLUETOOTH_OFF`. Labels "Disconnected", "Connecting", "Connected", "Connection failed: <reason text>". A drop while connected → `disconnected` (with a "Link lost" note), not `failed` | B: `failed` after a drop as well. One error path, but FR-02 AC1 says the state becomes Disconnected. C: free-text platform errors. Precise, but not translatable and sometimes cryptic | Matches FR-01 AC5 and FR-02 AC1 literally. Reason texts are catalog keys. A platform message is kept only in technical details | cheap | prd |
| D-11 | What happens when the app goes to the background? | A running scan stops. `startScan`/`connect` called while backgrounded are refused (state unchanged). An established link stays open and idle (no traffic, nothing scheduled). Coming back starts nothing by itself | B: disconnect on background. Frees the companion for other apps, but the user reconnects after every app switch. C: no special handling. Lets a scan run on in the background (NFR-07) | NFR-07 forbids starting BLE activity in the background, not holding a link. Least surprise for the user | cheap | agent |
| D-12 | Permission UX (FR-01 AC1/AC2) | Not granted → explanation card "MeshCore Guardian uses Bluetooth only to talk to your companion nearby. It does not use your location." with a "Grant access" button that requests the two permissions. Denied or "never ask again" → "Permission required" with "Open settings" (`Linking.openSettings()`) and "Try again". Permission state is checked again whenever the app becomes active, which covers coming back from settings | B: request as soon as the screen opens. One tap less, but the system dialog appears before any explanation. C: request at app start. Asks before the user wants BLE | AC1 needs an explanation and AC2 needs the return path. The wording is open to change at the PR | cheap | agent |
| D-13 | How does Metro bundle meshcore.js without `serialport`/`net`? | `apps/mobile/metro.config.js` (Expo default config) with `resolver.resolveRequest` returning `{ type: "empty" }` for `serialport` and `net`. A bundle check (`expo export`) is an agent check | B: deep-import meshcore.js files (`src/connection/connection.js`, `src/constants.js`, `src/cayenne_lpp.js`) in the adapter, with one ambient declaration per path. Smaller bundle, but it reworks S-01's reviewed imports and relies on internal paths. C: vendor the codec. Largest change | One app-only file, no adapter change. The stubbed modules are only reached by connection classes we never construct | cheap | agent |
| D-14 | How do e2e flows pick a fake scenario? | expo-router route `apps/mobile/src/app/debug/scenario/[name].tsx`: in fake mode it selects the scenario in the fake platform, resets the session and replaces the route with `/connect`. In ble mode it redirects to `/` and does nothing. The default fake scenario is `connect-ok` | B: a hidden dev menu. More taps in every flow. C: a separate APK per scenario. Slow builds | Matches the test-plan recipe (`openLink: guardian://debug/scenario/<name>`). The route cannot affect the BLE build | cheap | agent |
| D-15 | Which actions does "untested firmware" still allow (FR-03 AC3)? | Every MVP action is read-only (no config writes, NG-04), so untested firmware only adds a visible "Untested firmware" notice. Capabilities still follow D-5 | B: allow only contacts on untested firmware. Safer, but blocks diagnostics on any new firmware release | The PRD allows read-only actions, and all actions in scope are read-only | cheap | prd |
| D-16 | Where does connection orchestration live? | `apps/mobile/src/application/connection/companion-session.ts`: a class that owns a Zustand **vanilla** store (`zustand/vanilla`), the `BlePlatform`, `AppStatePort` and `LastCompanionStore` ports, and one `MeshClient` per link. It has no RN imports, so Vitest tests it with fakes. Screens read it with `useStore` | B: put it in the adapter. The adapter would need permission and app-state concepts it should not know. C: React hooks only. Not testable without RN | Follows the layers (use-case in the application layer) and test-plan ("view models with no React Native imports") | cheap | agent |
| D-17 | How are BLE values converted between base64 and bytes? | Own `apps/mobile/src/platform/ble/base64.ts` (pure, unit-tested both ways, ~30 lines) | B: global `atob`/`btoa`. Present in recent Hermes, but binary strings need a manual char loop anyway and the behaviour can only be tested on a device. C: the `buffer` package. A new dependency | Testable in Node, no dependency | cheap | agent |

## Design

### Layers and data flow
```
Connect screen / Dashboard chip ──useStore──▶ CompanionSession (application, pure TS, zustand/vanilla)
                                                │ ports
     ┌──────────────────────────────────────────┼────────────────────────────┐
     ▼                                          ▼                            ▼
BlePlatform (port)                     AppStatePort (port)          LastCompanionStore (port)
  ble:  platform/ble/ble-platform.ts      RN AppState adapter          platform/last-companion-store.ts
  fake: platform/fake/fake-ble-platform.ts  (fake: in-memory)          (fake/tests: in-memory)
     │ connect(id) → MeshTransport
     ▼
MeshClient(handshake) ─▶ MeshCoreConnection (meshcore.js encoders) ─▶ MeshTransport
                         decodeFrame (adapter)                         BleTransport | FakeTransport
domain: ConnectionState, ConnectFailureReason, CompanionInfo, deriveCapabilities, isTestedFirmware
```

### Domain (`packages/domain/src/companion/`)
- `companion.ts`: `CompanionInfo { publicKey: string; name: string; model: string;
  firmwareVersion: string; firmwareVerCode: number; buildDate: string }`.
- `capabilities.ts`: `CAPABILITIES = ["contacts","login","status","telemetry","trace"] as const`;
  `Capability`; `CAPABILITY_MIN_VER_CODE` (D-5);
  `deriveCapabilities(info) → Record<Capability, { supported: true } | { supported: false; reason: "FIRMWARE_TOO_OLD"; firmwareVersion: string }>`;
  `actionAvailability(capabilities, needs: Capability) → { enabled: true } | { enabled: false, reason, firmwareVersion }`
  (S-04 uses it to disable buttons; TR-14).
- `firmware.ts`: `TESTED_FIRMWARE`, `isTestedFirmware(firmwareVersion) → boolean` (D-6).
- `connection-state.ts`: `ConnectionState`, `CONNECT_FAILURE_REASONS`, `ConnectFailureReason` (D-10).

### Adapter (`packages/meshcore-adapter/src/`)
- `transport/fake-transport.ts`: `class FakeTransport implements MeshTransport` with
  `static fromFrames(frames: Pick<FixtureFrame,"dir"|"tMs"|"hex">[], options?)`,
  `static fromFixture(fixture)`, chainable `silence(code)`, `corrupt(rxSeq)`, `dropAfterWrites(n)`,
  `drop()`, `writtenFrames: Uint8Array[]`, `closed`. Uses `setTimeout` (tests use
  `vi.useFakeTimers()`). After a drop or close, `write` rejects and no more frames are delivered.
- `transport/handshake-script.ts`: `HANDSHAKE_FRAMES` (D-3), `withFirmware(frames, { verCode, version })`.
- `client/errors.ts`: `TransportUnavailableError`, `HandshakeTimeoutError { step: "deviceQuery" | "appStart" }`.
- `client/mesh-client.ts`: `class MeshClient { constructor(transport: MeshTransport, options?: { deviceQueryTimeoutMs?, appStartTimeoutMs? }); handshake({ signal }?): Promise<CompanionInfo>; onDisconnect(cb): Unsubscribe; close(): Promise<void> }`.
  Sends through a `MeshCoreConnection`. Receives by `transport.onFrame` + `decodeFrame`, which is
  synchronous, so it does not depend on the library's `setTimeout(0)` events. A transport
  disconnect rejects every pending wait with `TransportUnavailableError` in the same tick.
  Single-flight: a second `handshake` while one runs rejects (`Error("busy")`). S-04 extends this
  class with remote requests.

### Application (`apps/mobile/src/application/connection/`)
- `ports.ts`:
  - `BlePlatform { permissionStatus(): Promise<"granted"|"denied"|"blocked">; requestPermissions(): Promise<…same>; openSettings(): Promise<void>; adapterState(): Promise<"on"|"off"|"unavailable">; scan(onDevice: (d: { id; name: string | null }) => void, signal: AbortSignal): void; connect(id, signal): Promise<{ transport: MeshTransport; mtu: number | null }> }`.
  - `AppStatePort { current(): "active"|"background"; onChange(cb): Unsubscribe }`.
  - `LastCompanionStore { load(): Promise<{ id; name } | null>; save(v): Promise<void> }`.
- `companion-session.ts`: store state `{ permission, bluetooth, scan: { status: "idle"|"scanning"|"done", devices }, connection: ConnectionState, lastCompanion, mtu, capabilities, firmwareTested, linkLostNote }`.
  Methods: `refreshPermission()`, `requestPermission()`, `openSettings()`, `startScan()`,
  `stopScan()`, `connect(id)`, `retry()`, `reconnect()` (last companion), `disconnect()`, `dispose()`.
  Invariants: one connection attempt at a time; nothing starts without a method call (no timers
  that connect); background refuses `startScan` and `connect` and stops a scan (D-11); a
  `startScan` with Bluetooth off sets `bluetooth: "off"` and never sets `scan.status` to `done`
  with an empty list; a scan stops after 10 s (D-8). Connect bound: 15 s for the BLE link
  (`CONNECT_TIMEOUT`), then the D-4 handshake. On success it saves the last companion.
- `advertisement.ts`: `isCompanionAdvertisement({ name, serviceUUIDs })` (D-8).

### Platform (`apps/mobile/src/platform/`)
- `ble/ble-platform.ts`: lazily created `BleManager`. Permissions through `PermissionsAndroid`
  using `REQUIRED_PERMISSIONS` from `ble/permissions.ts` (pure: the two permission strings).
  `startDeviceScan(null, { allowDuplicates: false })` with the D-8 filter;
  `connectToDevice(id, { requestMTU: 512, timeout: 15000 })` → `discoverAllServicesAndCharacteristics`
  → `BleTransport`.
- `ble/ble-transport.ts`: `MeshTransport` over ble-plx: write with response to RX
  (base64), `monitorCharacteristicForService` on TX (one notification = one frame), and
  `onDeviceDisconnected` → disconnect listeners. `close()` is idempotent and bounded (5 s per step,
  like `node-ble-transport.ts`).
- `ble/base64.ts` (D-17); `ble/uuids.ts` (NUS IDs, verified in S-01).
- `fake/fake-ble-platform.ts`: scripted by a `Scenario` (pure TS): `{ permission, bluetooth,
  devices, attempts: Array<"ok" | "connect-error" | "connect-timeout" | { dropAfterMs } | { firmware }> }`,
  where each `connect` uses the next attempt (the last one repeats).
- `last-companion-store.ts` (D-7); `app-state.ts` (RN `AppState` → `AppStatePort`).

### Error model
| Source | Session result |
|--------|----------------|
| permission denied/blocked | `permission: "denied"/"blocked"`; no scan; connection unchanged |
| adapter off at scan or connect | `bluetooth: "off"`; connect → `failed(BLUETOOTH_OFF)` |
| `connect` throws / times out | `failed(CONNECT_ERROR / CONNECT_TIMEOUT)`; Retry offered |
| `HandshakeTimeoutError` | `failed(HANDSHAKE_NO_RESPONSE)`; transport closed |
| `MalformedFrameError` during handshake | `failed(HANDSHAKE_MALFORMED)`; transport closed |
| transport drop during Connecting | `failed(LINK_LOST)` |
| transport drop while Connected | `disconnected` + link-lost note; in-flight waits reject `TransportUnavailableError` (S-04 maps it to `TRANSPORT_UNAVAILABLE`) |

## Phases

### Phase 1: Domain companion model
- Files:
  - `packages/domain/src/companion/companion.ts`: `CompanionInfo`. Contract: field names above (S-03/S-04 store the companion identity from it).
  - `packages/domain/src/companion/capabilities.ts` + `.test.ts`: D-5 table, `deriveCapabilities`, `actionAvailability`. Contract: `Capability` union and the reason shape `{ supported: false, reason: "FIRMWARE_TOO_OLD", firmwareVersion }`.
  - `packages/domain/src/companion/firmware.ts` + `.test.ts`: `TESTED_FIRMWARE`, `isTestedFirmware`. Table tests: `v1.17.1-d929643` → true, `1.17.0` → true, `v1.16.2` → false, `v2.17.0` → false, `garbage` / `""` → false.
  - `packages/domain/src/companion/connection-state.ts` + `.test.ts`: `ConnectionState`, `CONNECT_FAILURE_REASONS`, `isConnectFailureReason`.
  - `packages/domain/src/index.ts`: export the above.
  - `stryker.targets` and `context/test-plan.md` *Mutation targets*: add `packages/domain/src/companion/capabilities.ts` and `firmware.ts` (TR-14, 80 %, report).
- Proves: FR-03 AC2 and AC3 rules (unit): verCode 4 → telemetry unsupported with the firmware version, 5 → supported, 13 → all supported; `actionAvailability` disabled with the reason; tested/untested firmware.
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm vitest run --project domain`, `pnpm test`.
- Human checks: none.

### Phase 2: FakeTransport and handshake client
- Files:
  - `packages/meshcore-adapter/src/transport/fake-transport.ts` + `.test.ts`: D-1/D-2. Unit tests: reply order and delay; unmatched write gets silence; `silence(0x16)`; `corrupt(n)`; `dropAfterWrites(n)` fires the disconnect listeners and later writes reject; `close` unsubscribes.
  - `packages/meshcore-adapter/src/transport/handshake-script.ts`: `HANDSHAKE_FRAMES`, `withFirmware` (D-3).
  - `packages/meshcore-adapter/src/client/errors.ts`, `client/mesh-client.ts`: D-4 contract above.
  - `packages/meshcore-adapter/test/handshake-script.int.test.ts`: `HANDSHAKE_FRAMES` equal frames 0–3 of `fixtures/v1.17.1-d929643/handshake.json`. `withFirmware(…, { verCode: 4, version: "v1.4.0" })` decodes to those values with every other field unchanged.
  - `packages/meshcore-adapter/test/mesh-client.int.test.ts`: on `FakeTransport.fromFrames(HANDSHAKE_FRAMES)`, `handshake()` → `CompanionInfo { firmwareVersion: "v1.17.1-d929643", firmwareVerCode: 13, model: "Heltec V3", name: "companion", publicKey: <64 hex> }` and the written frames are device query then app start. `silence(0x16)` → `HandshakeTimeoutError("deviceQuery")` at 30 s of fake time and not before. `silence(0x01)` → `"appStart"` at 5 s. `corrupt` on device info → `MalformedFrameError`. `dropAfterWrites(1)` → `TransportUnavailableError` in the same tick as the drop, and no late resolve after it (TR-12 adapter part). An aborted signal → `AbortError` with no further write. A concurrent `handshake` is refused.
  - `packages/meshcore-adapter/src/index.ts`: export `FakeTransport`, `HANDSHAKE_FRAMES`, `withFirmware`, `MeshClient`, the errors.
- Proves: FR-02 AC1 (in-flight request ends on drop; integration), the TR-12 adapter part, and the D-4 bounds.
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm vitest run --project meshcore-adapter`, `pnpm test`.
- Human checks: none.

### Phase 3: Companion session (application layer) and fake platform
- Files:
  - `apps/mobile/package.json`: add `@guardian/meshcore-adapter: workspace:*` and `zustand` `5.0.15` (exact, tech-stack).
  - `apps/mobile/src/application/connection/ports.ts`, `advertisement.ts` + `.test.ts`, `companion-session.ts`: contracts in *Design*.
  - `apps/mobile/src/platform/fake/fake-ble-platform.ts`: scripted platform. Also in-memory `AppStatePort` and `LastCompanionStore` fakes (`fake/in-memory.ts`).
  - `apps/mobile/src/debug/scenarios.ts`: `SCENARIOS` record: `connect-ok`, `permission-denied`, `bluetooth-off`, `connect-fail` (attempts `["connect-error", "ok"]`), `link-drop` (attempts `[{ dropAfterMs: 3000 }, "ok"]`), `unsupported-capability` (`{ firmware: { verCode: 4, version: "v1.4.0" } }`). Device name `MeshCore-companion`.
  - `apps/mobile/src/application/connection/companion-session.int.test.ts`: real `MeshClient` + `FakeTransport` + fake platform, fake timers. Cases:
    - each scenario reaches its state;
    - every state transition is exactly one of the four kinds (FR-01 AC5);
    - permission denied → `scan` is never called (FR-01 AC2);
    - Bluetooth off → `bluetooth: "off"` and the scan is not `done` with an empty list (FR-01 AC3);
    - a device appears and connect succeeds, capabilities and `firmwareTested` are set (FR-01 AC4, FR-03 AC1);
    - connect-error → `failed(CONNECT_ERROR)`, and `retry()` → connected (FR-01 AC5);
    - drop while connected → `disconnected` within the same tick of fake time, ≤ 5 s (FR-02 AC1), and `reconnect()` → connected with the same session object (FR-02 AC2);
    - drop during the handshake → `failed(LINK_LOST)`;
    - after a drop, advancing 10 min of fake time makes no `connect` call (no auto-reconnect, FR-10 AC6);
    - with the app state `background`: `startScan`/`connect` make no platform call and no transport write, and a running scan is aborted (FR-02 AC3, TR-18);
    - the scan stops at 10 s;
    - the last companion is saved on success and offered by `reconnect()`;
    - a second `connect` while connecting is refused.
  - `stryker.targets` and test-plan *Mutation targets*: add `apps/mobile/src/application/connection/companion-session.ts` (80 %, report).
- Proves: FR-01 AC2–AC5, FR-02 AC1–AC3 and FR-03 AC1 at integration level; TR-12, TR-13, TR-18 (logic).
- Agent checks: `pnpm install` (lockfile updated), `pnpm typecheck`, `pnpm lint`, `pnpm vitest run --project mobile`, `pnpm test`.
- Human checks: none.

### Phase 4: BLE platform, persistence, composition and bundle
- Files:
  - `apps/mobile/package.json`: `expo-sqlite` via `npx expo install expo-sqlite` (SDK-pinned, ~57.0.4).
  - `apps/mobile/metro.config.js`: D-13.
  - `apps/mobile/src/platform/ble/{uuids,permissions,base64,ble-transport,ble-platform}.ts`, plus `base64.test.ts` and `permissions.test.ts`. The latter asserts the list is exactly `BLUETOOTH_SCAN`, `BLUETOOTH_CONNECT` and contains no `LOCATION` (FR-01 AC1).
  - `apps/mobile/src/platform/last-companion-store.ts` (D-7), `platform/app-state.ts`.
  - `apps/mobile/src/composition/transport.ts` → replaced by `composition/platform.ts`: `createPlatform(mode)` returns `{ ble: BlePlatform, appState, lastCompanion }`, with the fake platform and in-memory stores in `fake` mode. `composition/index.ts`: `container = { mode, session: new CompanionSession(...) }`. Remove `StubTransport` (F-01 D-8 placeholder).
  - Settings screen: still shows the transport mode from `container.mode` (smoke flow unchanged).
- Proves: FR-01 AC1 (unit on the permission list, plus a human check of the system dialog). The app bundles with meshcore.js under Metro.
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`. Bundle check: `pnpm --filter mobile exec expo export --platform android --output-dir /tmp/guardian-export` exits 0 (save the last lines to `evidence/phase-4-bundle.txt`). Manifest check after `expo prebuild --platform android --no-install` or the e2e build: grep `android/app/src/main/AndroidManifest.xml` for `BLUETOOTH_SCAN` (with `neverForLocation`), `BLUETOOTH_CONNECT` and any `LOCATION` entry; save to `evidence/phase-4-manifest.txt` (a location entry with `maxSdkVersion` ≤ 30 is inert at minSdk 31; note it).
- Human checks: none (the real BLE path is checked in Phase 5's human checks with the CI APK).

### Phase 5: Connect screen, dashboard status, scenarios route and e2e
- Files:
  - `apps/mobile/src/app/connect.tsx`: permission card (D-12); Scan button with a scan list (FlatList, one row per device: name or "Unnamed device", id); the connection state line (one of the four labels with a text label and an icon, never colour only); Retry on failure; Reconnect / "Connect to <last companion>"; Disconnect when connected; companion card: name, model, firmware version, "Untested firmware" notice when applicable, the five capabilities each "Supported" or "Not supported by companion firmware <version>"; "Technical details" (MTU, build date). It refreshes permission when the app becomes active.
  - `apps/mobile/src/app/index.tsx`: keep the placeholder text and add the connection status line plus a "Connect companion" button to `/connect`.
  - `apps/mobile/src/app/debug/scenario/[name].tsx`: D-14.
  - `apps/mobile/src/app/_layout.tsx`: register the debug route (hidden header).
  - `apps/mobile/src/components/connection-status.tsx`: shared status line (text + icon glyph + `accessibilityLabel`).
  - `apps/mobile/src/i18n/en.json` + `catalog.test.ts`: new `connect.*`, `connection.*`, `capability.*` keys. The test asserts every `ConnectFailureReason` and `Capability` has a key, and that no value contains "offline", "down" or "dead" (case-insensitive; this starts TR-01's guard). The `connect` screen drops its placeholder key, and its row moves from the placeholder check to a title-only check.
  - `apps/mobile/e2e/{permission-denied,bluetooth-off,connect-ok,connect-fail,reconnect,unsupported-capability}.yaml`: each `launchApp: clearState`, `openLink: guardian://debug/scenario/<name>`, taps, and `assertVisible` on text. `connect-ok` asserts "Connected", "v1.17.1-d929643" and "Supported" for telemetry, which proves meshcore.js encoding + adapter decoding under Hermes on the emulator. `reconnect` asserts "Disconnected" then "Connected" after tapping Reconnect. `unsupported-capability` asserts "Not supported by companion firmware v1.4.0" and "Untested firmware".
  - `docs/compatibility.md`: an "Android phone" table with rows to fill from the human check (phone model, Android version, bonding dialog, negotiated MTU, scan finds companion by UUID or name, handshake under Hermes), all `not verified`. Capability rows per D-5.
  - `context/test-plan.md`: set TR-12, TR-13, TR-14, TR-18 to `covered (S-02)` and TR-07 to `planned (S-02 human check)`.
- Proves: FR-01 AC1–AC5, FR-02 AC1–AC2 and FR-03 AC1–AC3 at e2e level (TR-13, TR-14, TR-12 e2e).
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm e2e` (all flows including `smoke.yaml`; output to `evidence/phase-5-e2e.txt`), and one Maestro screenshot of `connect-ok` (< 300 KB) in `evidence/`.
- Human checks (CI APK `android-apk`, real BLE build, on a phone without USB debugging):
  1. Fresh install → Connect: explanation card shown; "Grant access" → the system dialog asks for "Nearby devices" only, with no location prompt.
  2. Deny → "Permission required" with "Open settings". Grant in settings, return → the scan becomes available without restarting the app.
  3. Bluetooth off → Scan shows "Bluetooth is off" (not "No companions found").
  4. Bluetooth on → Scan lists the Heltec companion within 10 s. Connect → note whether a pairing/PIN dialog appears and that the handshake completes after entering the PIN. The screen shows "Connected", firmware `v1.17.1-…`, model Heltec V3, all five capabilities, and no "Untested firmware". Record the MTU shown under Technical details. This also proves meshcore.js under Hermes (TR-07).
  5. While connected, power off the companion → "Disconnected" within ~5 s. Power it on, tap Reconnect → "Connected" without restarting (the companion may need a few minutes before it advertises again).
  6. Kill and reopen the app → Connect offers the remembered companion; nothing connects until tapped.
  7. Read the Connect screen wording (permission text, failure reasons, capability reasons) and accept or change it.
  8. Fill the "Android phone" table in `docs/compatibility.md` from checks 1–6.

## Risks and unknowns
- **Metro bundling of meshcore.js** (Findings). D-13 resolves it, and the Phase 4 bundle check
  catches it early. If `expo export` still fails on another Node module, add it to the same stub
  list, or switch to D-13 B and log a `[REVIEW]`.
- **Hermes `TextDecoder`/`TextEncoder`.** If the e2e `connect-ok` flow fails on a missing global,
  add a small UTF-8 encoder/decoder in the adapter (`decode/bytes.ts`), assigned only when the
  global is missing (no new dependency), and log `[REVIEW]`.
- **Android bonding/PIN dialog and MTU** (roadmap unknowns) are `UNVERIFIED` and judged by human
  check 4. D-4's 30 s first step and D-9's MTU display are there for them.
- **Companion advertisement content** (UUID vs name) is unknown on Android. D-8 accepts either.
- **D-5 capability minimums** come from firmware comments, not observation. The rows are marked
  `UNVERIFIED`. S-04 will see the `ERR` replies.
- **Emulator has no BLE.** The real `BleTransport`/`BlePlatform` run only in human checks
  (test-plan *Not tested*).
- **expo-sqlite native module** adds build time. If the e2e build breaks on it, keep D-7's port with
  the in-memory store (D-7 B) and log `[REVIEW]`.

## Progress
<!-- One line per phase. /implement ticks it in the phase's own commit. -->
- [x] Phase 1: Domain companion model
- [ ] Phase 2: FakeTransport and handshake client
- [ ] Phase 3: Companion session (application layer) and fake platform
- [ ] Phase 4: BLE platform, persistence, composition and bundle
- [ ] Phase 5: Connect screen, dashboard status, scenarios route and e2e

## Human checks
<!-- Filled by /implement: one open checkbox per human check, with how to run it and evidence. -->

## Deviations
<!-- [minor] / [REVIEW] / [FOLLOW-UP] / [STUCK] entries, see autonomy.md section 3 -->

## Review response
<!-- revise mode only: one line per plan-review finding and what changed -->
