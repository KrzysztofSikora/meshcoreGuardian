# Plan: protocol-feasibility-gate (S-01)

## Goal and end state
The go/no-go gate (D-09 in the roadmap) is decided on real hardware and the decision is written
down:

- `packages/meshcore-adapter` has the `MeshTransport` interface, `MeshCoreConnection` (a subclass
  of meshcore.js `Connection` over any `MeshTransport`) and `decodeFrame`. `decodeFrame` turns
  every companion frame this product needs into a JSON-safe typed record, and it corrects the
  places where meshcore.js 1.15.0 misreads firmware 1.17 (see *Findings*).
- `tools/capture` (dev only, Node) connects to the companion over BLE with `node-ble`. It runs a
  bounded, budgeted capture through the adapter and writes a redacted fixture file under
  `packages/meshcore-adapter/fixtures/<firmware>/`.
- FR-00 AC1: a real capture from the laptop completes the handshake (device query and app start),
  reads the contact list and decodes at least one status or telemetry response from `HW_REPEATER`.
- FR-00 AC2: `docs/compatibility.md` has the verdict (`PASSED` / `FAILED` + evidence) at the top,
  then firmware versions, BLE service and characteristic UUIDs, framing and fragmentation,
  response correlation, login behaviour and whether `estTimeout` is returned. Each item is marked
  `verified` or `not verified`.
- FR-00 AC3: `pnpm test` decodes every committed fixture and gets the values the capture logged.
- Test-plan risks TR-06, TR-09 (capture part) and TR-23 are covered.

## Scope
- In: the adapter transport interface, the connection subclass and frame decoders; the
  `tools/capture` workspace (node-ble transport, recorder, redaction, request budget, CLI); the
  fixture format; the hardware capture runs; fixture tests; `docs/compatibility.md`; lint, Vitest
  and workspace wiring for `tools/*`; test-plan status updates.
- Out: `MeshClient` orchestration (abort, retries, single-flight, result classification: S-04);
  `FakeTransport` and `BleTransport` for the app (S-02); Android or Hermes behaviour (S-02 human
  check); Zod schemas and domain entities for decoded data (S-02/S-03/S-06 define them); any UI.

## Findings
**Repo today**
- `packages/meshcore-adapter/src/index.ts:1` is an empty placeholder. The package depends only on
  `@guardian/domain` (`packages/meshcore-adapter/package.json`).
- Packages are source-only (`exports: ./src/index.ts`, D-3 of repo-skeleton) and use
  extensionless relative imports (`packages/domain/src/index.ts:1`). Node 24's built-in type
  stripping cannot run them, so a CLI that imports the adapter needs a TS-aware runner (D-5).
- Workspaces are `apps/*`, `packages/*`, `tooling` (`pnpm-workspace.yaml`). `tools/*` is new.
- Lint layer rules live in `eslint.config.mjs` (`layer(...)` blocks). meshcore.js imports are
  allowed only in `packages/meshcore-adapter` (`forbid.meshcoreJs`). They are tested in
  `tooling/lint/layer-rules.test.ts`.
- Vitest projects are in `vitest.config.mts`, one per package. Integration tests go in
  `test/**/*.int.test.ts` (test-plan).
- Mutation target `packages/meshcore-adapter/src/decode/*.ts` is already listed in
  `stryker.targets` and the test plan. The decoders in this change land there.
- `.env` has `HW_COMPANION` and `HW_REPEATER` set; `HW_GUEST_PASSWORD` is empty (keys checked,
  values not read). `bluetoothctl` is installed. The roadmap records that an interactive read-only
  session reached the companion through node-ble 1.13 with a `Connection` subclass on 2026-10-11.
- The repo is private (`gh repo view`).
- `pnpm-workspace.yaml` sets `allowBuilds`. meshcore.js depends on `serialport` (native, with an
  install script) and `@noble/curves`.

**meshcore.js 1.15.0** (read from the published package source)
- It has no TypeScript types. `src/index.js` exports `Connection`, `Constants`, `CayenneLpp`,
  `BufferUtils` and others. `NodeJSSerialConnection`/`TCPConnection` import `serialport`/`net`
  **dynamically**, so importing the package root is safe in Node and RN.
  `transport_key_util.js` uses `crypto.subtle` only when called.
- `Connection` is abstract: `sendToRadioFrame(bytes)` and `close()` must be implemented;
  `onFrameReceived(frame)` dispatches on byte 0 and `emit`s synchronously. `once` listeners are
  delivered through `setTimeout(0)`, so tests with fake timers must advance timers.
- Request methods (`login`, `getStatus`, `getTelemetry`) arm a timer only after `RESP_CODE_SENT`,
  use `estTimeout + 1000` without a cap, reject with the bare string `"timeout"` or with
  `undefined`, and cannot be cancelled. This matches tech-stack's reason for our own `MeshClient`.
- Correlation: login, status and telemetry pushes are matched by the **6-byte public key prefix**
  only. There is no per-request tag on these pushes.
- Misreads against firmware 1.17 (checked against `MeshCore/examples/companion_radio/MyMesh.cpp`
  and `src/Packet.h` on `main`):
  - `DeviceInfo`: meshcore.js reads `firmwareVer`, 6 "reserved" bytes, the build date and then
    "the rest of the frame" as `manufacturerModel`. The firmware sends `max_contacts/2`,
    `max_channels`, **`ble_pin` (uint32, bytes 4–7)**, the build date (12), the manufacturer (40),
    `FIRMWARE_VERSION` (20), and on newer versions `repeat` and `path_hash_mode`. **Raw
    device-info frames contain the BLE pairing PIN** and must be redacted before they are written.
  - `SelfInfo` carries the companion's `lat`/`lon` (int32 × 1e6, bytes 36–43): the operator's
    location.
  - Contact `out_path_len` is one raw byte: bits 6–7 = hash size − 1, bits 0–5 = hop count
    (`Packet.h`: `getPathHashSize() = (path_len >> 6) + 1`, `getPathHashCount() = path_len & 63`).
    meshcore.js reads it as `int8`, which explains the observed -1 (0xFF), -123 (0x85: hash size 3,
    5 hops) and -128 (0x80: hash size 3, 0 hops). 0xFF is taken to mean "no known path / flood".
    This reading is `UNVERIFIED` until the capture confirms it.
  - `PUSH_CODE_LOGIN_FAIL` (0x86) is not handled ("not usable yet"). It is logged as an
    unhandled frame, and `login()` then waits for its timeout. `LOGIN_SUCCESS` in the new format
    has more fields after the prefix (permissions, tag, ACL, firmware level).
  - The status push payload is the repeater stats struct. meshcore.js parses it only inside the
    `getStatus` closure. Room servers append extra fields after the repeater struct (`UNVERIFIED`).
  - `RESP_CODE_SENT` = `[6, flood flag, expected ack/tag u32, est_timeout u32 ms]`.
- BLE: Nordic UART service `6E400001-…`, RX (write) `6E400002-…`, TX (notify) `6E400003-…`
  (`Constants.Ble`). The companion uses one frame per write or notification (to be confirmed by
  the capture: framing/fragmentation row of AC2).

**node-ble 1.13.0** (MIT, one dependency `dbus-next`, pure JS, no types)
- `createBluetooth()` → `{ bluetooth, destroy }`; `adapter.waitDevice(mac)`, `device.connect()`,
  `device.gatt()`, `gatt.getPrimaryService(uuid)`, `service.getCharacteristic(uuid)` (lower-case
  UUIDs), `characteristic.writeValue(buf, { type: "request" | "command" })`,
  `startNotifications()` + `"valuechanged"` event (Buffer), and the `device` `"disconnect"`
  event. There is no MTU API; BlueZ negotiates the MTU. The bond is reused from `bluetoothctl`.

## Decisions
| ID | Question | Chosen | Alternatives (and what they would buy) | Why | Reversal | Decided by |
|----|----------|--------|----------------------------------------|-----|----------|------------|
| D-1 | How does the adapter decode frames, given meshcore.js misreads several firmware 1.17 frames? | `decodeFrame(bytes)` runs the frame through meshcore.js's own per-code parsers (a parse-only `Connection` whose `emit` is captured), then maps each event to our typed record and **corrects** the known misreads: device info and status payload are re-read from the raw bytes, `out_path_len` is read as unsigned with hash size and hop count, and 0x86 login-fail is decoded by us | B: our own byte parser for all ~12 codes. Independent of library quirks and fully typed, but it re-implements the codec the tech stack chose to reuse. C: use library events as they are. Least code, but it ships the PIN-as-reserved, signed path length and missing firmware version bugs | Tech-stack says meshcore.js is the codec; corrections are explicit and tested per field. Strongest case against: half the codes need corrections, so the library buys less than hoped. If that grows, B replaces one module (`src/decode/`) | cheap | agent |
| D-2 | Contract of `MeshTransport` (used by S-02's BLE and fake transports) | `write(frame: Uint8Array): Promise<void>`, `onFrame(cb) → unsubscribe`, `onDisconnect(cb) → unsubscribe`, `close(): Promise<void>`. One call to `write` sends one complete companion frame; one `onFrame` call delivers one complete frame. Connecting is done by each implementation's factory, not by the interface | B: also `connect()` and `state` on the interface. Uniform lifecycle, but scanning and connecting differ per platform (BlueZ address vs ble-plx scan). C: stream of byte chunks with framing in the adapter. Needed only if the companion fragments frames | The capture will verify one-frame-per-notification. If it shows fragmentation, a reassembly layer goes inside each transport and the interface stays the same. Internal interface, no implementation outside this change yet | cheap | agent |
| D-3 | Fixture file format (S-02's `FakeTransport` and every fixture test read it) | One JSON file per capture run: `formatVersion: 1`, `header` (firmware version string, build date, version code, companion model, capture date, tool and library versions, scenario, target key prefix, list of redactions), `frames[]` (`seq`, `dir` `tx`/`rx`, `tMs` monotonic since start, `hex`, optional `decoded` for rx frames, optional `decodeError`) and `summary` (counts and the outcome of each remote request). The type and a `readFixture` parser live in `packages/meshcore-adapter/src/fixtures/format.ts` | B: one file per step (handshake, contacts, login, status, telemetry). Smaller replays, but the timeline across steps is lost. C: JSON lines (one frame per line). Diff-friendly, but the header and summary need a separate convention | Matches the user's "every frame with direction, monotonic timestamp and hex payload". Storing `decoded` next to each frame makes AC3 a per-frame comparison. Strongest case against: the contacts file is large (~350 frames, ~250 KB) | costly (fixtures can only be regenerated with hardware and radio TX; shape is in one file, versioned) | agent |
| D-4 | What is redacted from fixtures, beyond the guest password the roadmap fixes? | The `SendLogin` tx frame keeps code + public key, and the password bytes are dropped. The device-info `ble_pin` (bytes 4–7) is zeroed. Self-info `lat`/`lon` are zeroed. Chat (type 1) contacts get name → `chat-<n>` and `lat`/`lon` → 0. Repeater and room contacts stay verbatim. Redaction is applied to the bytes **before** decoding and writing, and listed in `header.redactions` | B: password only (as written in the roadmap). Simplest, but it commits the pairing PIN and the operator's home location. C: also redact repeater names and positions. Most private, but infrastructure adverts are public and S-03 tests need realistic names | The PIN is a secret (CLAUDE.md: no secrets in commits); location and people's names are personal data (privacy rule). Infrastructure adverts are public broadcasts. The repo is private, which lowers but does not remove the risk | costly (touches secrets/privacy; logic in one file `tools/capture/src/redact.ts`) | agent |
| D-5 | How does `pnpm capture` run TypeScript that imports the source-only adapter (extensionless imports)? | `tsx` 4.x as an exact-pinned devDependency of `tools/capture` only. Root script `capture` → `pnpm --filter @guardian/capture capture`. The tool loads `.env` from the repo root with `process.loadEnvFile` | B: a Vite/esbuild bundle step for the tool. No new dependency (vite is present), but a build script and output dir for a dev tool. C: add `.ts` extensions repo-wide and use Node type stripping. No dependency, but it rewrites every import and conflicts with Metro conventions | Smallest change; dev-only, never bundled into the app | cheap (dev-only dependency, one script line) | agent |
| D-6 | When is the gate `PASSED` vs `FAILED`, and what if `HW_REPEATER` simply does not answer? | `PASSED` iff a capture against `HW_REPEATER` has a decoded device info, a complete contact list (start → end) and ≥ 1 decoded status **or** telemetry response, and all fixture tests are green. Otherwise `FAILED`, with the evidence that is missing. The agent runs at most **two** `remote` captures, only against `HW_REPEATER`, ≥ 60 s apart, and never picks another node | B: a third verdict `INCONCLUSIVE` for "node silent". More honest about the cause, but the roadmap fixes PASSED/FAILED. C: let the agent try other repeaters from the contact list. More likely to pass, but it sends radio traffic to nodes the user did not choose | Roadmap verdict values are the user's. The user chose the target node, and radio TX to others is outward-facing. A silent node is reported as `NO_RESPONSE — cause unknown` in the evidence, and the person can rerun with another `HW_REPEATER` | cheap | agent |
| D-7 | Capture timeouts (the app's 30 s cap, D-06, belongs to `MeshClient` in S-04) | Each remote request waits for the pushed reply up to `estTimeout + 5 s`, hard-capped at 45 s, so we learn the real latency. Waiting for `RESP_CODE_SENT` or `ERR` is capped at 5 s. Requests are sequential (never two in flight) | B: reuse 30 s now. Consistent with D-06, but it may cut off a late flood reply we want to observe. C: library timers (`estTimeout + 1 s`, no cap). Unbounded | Evidence-gathering tool; bounded either way; values in one constants block | cheap | agent |
| D-8 | Capture scenarios and output names | `--scenario handshake` (device query, app start, contacts: no LoRa TX) and `--scenario remote` (handshake + guest login + status + telemetry to `HW_REPEATER`, each ≥ 60 s after the previous request to that node; a second attempt of a kind only if the first got no reply). Output `packages/meshcore-adapter/fixtures/<firmware-version>/<scenario>.json`; rerunning overwrites (git shows the diff) | B: one fixed full run. Simpler CLI, but every run transmits. C: one flag per request kind. Finer control, more ways to exceed the budget | `handshake` lets the tool be checked without airtime. The budget (1 handshake, 1 sync, ≤ 2 each of login/status/telemetry) is enforced in code per run | cheap | agent |
| D-9 | Do decoders produce Zod-validated domain types now? | No. Decoders return adapter-level plain types (hex strings, numbers) with explicit length checks, throwing `MalformedFrameError`. Zod and domain entities come with the slices that consume them | B: add Zod and domain entities now. Earlier boundary validation, but it designs S-02/S-03/S-06 types without their ACs | Keeps S-01 to its ACs; the decoder output is the input those slices will validate | cheap | agent |
| D-10 | Under which event name does `MeshCoreConnection` emit the login-fail push? | The numeric `Constants.PushCodes.LoginFail` (0x86), payload `{ pubKeyPrefix }`, and the frame is also emitted as `rx` like every other frame | B: the string `"LoginFail"`, as the Phase 1 contract could be read. Easier to grep, but it is the only event not keyed by its code, so callers would need two conventions | Every meshcore.js event, including `LoginSuccess`, is keyed by its numeric code; S-04 listens to both pushes the same way | cheap | agent |

## Design
**Adapter (`packages/meshcore-adapter/src`)**
- `transport/mesh-transport.ts`: `MeshTransport` (D-2), `Unsubscribe = () => void`.
- `connection/mesh-core-connection.ts`: `class MeshCoreConnection extends Connection`.
  - `constructor(transport)` subscribes: `onFrame` → `this.onFrameReceived`, `onDisconnect` →
    `this.onDisconnected()`.
  - `sendToRadioFrame(bytes)` → `transport.write`; `close()` → unsubscribe + `transport.close()`.
  - Overrides `onFrameReceived` so 0x86 emits a `LoginFail` event with the key prefix and is not
    logged as unhandled; everything else goes to `super`.
- `types/meshcore-js.d.ts`: an ambient `declare module "@liamcottle/meshcore.js"` covering only
  what we use: `Connection` methods and events, `Constants`, `CayenneLpp.parse`.
- `decode/` (mutation target):
  - `decode-frame.ts`: `decodeFrame(bytes: Uint8Array): DecodedFrame`.
  - `DecodedFrame` is a union on `kind`: `deviceInfo` {firmwareVerCode, maxContacts,
    maxChannels, buildDate, manufacturer, firmwareVersion, repeatEnabled?, pathHashMode?; **no
    PIN field**}, `selfInfo` {publicKey, name, txPower, radio params, lat, lon}, `contactsStart`
    {count}, `contact` {publicKey, type, flags, path, name, lastAdvert, lat, lon, lastMod},
    `endOfContacts`, `sent` {flood, tag, estTimeoutMs}, `ok`, `err` {code?}, `loginSuccess`
    {keyPrefix, permissions, tag?, aclPermissions?, firmwareLevel?}, `loginFail` {keyPrefix},
    `statusResponse` {keyPrefix, stats, extraHex}, `telemetryResponse` {keyPrefix, values:
    {channel, type, value}[]}, `other` {code, length}.
  - `path.ts`: `decodePathLen(raw: number): { raw; kind: "unknown" } | { raw; kind: "known";
    hashSize; hops }`.
  - `status.ts`: the repeater stats struct.
  - `device-info.ts`: the firmware 1.17 layout.
  - `bytes.ts`: a little-endian reader over `Uint8Array` and hex helpers. No `Buffer`, because the
    adapter must run under Hermes later.
  - Short frames throw `MalformedFrameError(code, length, needed)`.
- `fixtures/format.ts`: `Fixture`, `FixtureFrame`, `readFixture(json: unknown): Fixture`, which
  checks `formatVersion === 1` and the field types. `index.ts` re-exports the public pieces.

**Capture tool (`tools/capture/src`)**, package `@guardian/capture`, private, Node only
- `config.ts`: `readCaptureConfig(env)` → `{ companion, repeaterPrefix, guestPassword }`. It
  throws a clear error if `HW_COMPANION` or `HW_REPEATER` is empty (TR-23). The prefix is
  validated as hex.
- `budget.ts`: `RequestBudget(clock)`. `take(kind, nodeKey)` enforces the per-run limits and
  returns the wait needed for the 60 s spacing to the same node. `Clock = { now(): number;
  sleep(ms): Promise<void> }`; tests use a fake clock.
- `redact.ts`: `redactFrame(dir, bytes, state) → { bytes, redactions }` (D-4). Pure function.
- `recorder.ts`: `RecordingTransport implements MeshTransport` wraps any transport, records
  tx/rx frames with `performance.now()` offsets, applies `redactFrame`, decodes rx with
  `decodeFrame` (catching `MalformedFrameError` into `decodeError`), and builds the `Fixture`.
- `node-ble-transport.ts`: `connectNodeBle(address, deps) → MeshTransport`. It uses the NUS UUIDs,
  writes with `{ type: "request" }`, maps `"valuechanged"` to `onFrame` and device `"disconnect"`
  to `onDisconnect`. The node-ble surface sits behind a tiny `BleDeps` type so it can be tested
  with fakes. `types/node-ble.d.ts` holds the minimal ambient types.
- `capture.ts`: `runCapture(scenario, { connection, budget, clock, target })` drives the steps
  through `MeshCoreConnection` `sendCommand*` methods and waits for events with the D-7 caps.
- `main.ts`: the CLI. It parses `--scenario`, loads `.env`, connects, runs, writes the file and
  prints a summary (counts, est timeouts, latencies, outcomes). It never prints the password.

**Data flow (capture):** node-ble char → `RecordingTransport` (record + redact + decode) →
`MeshCoreConnection.onFrameReceived` (live events drive the run) → fixture JSON.

**Error model (capture):** connection failure → exit 2 with a message, no file. No reply within
cap → request outcome `no_response` (wording: "No response — cause unknown"). `ERR` → `error`.
Login fail → `rejected`. A decode error is recorded on the frame and still written. Disconnect
mid-run → write what was recorded, with `summary.aborted = "transport_disconnected"`.

## Phases
### Phase 1: Adapter transport and connection
- Files:
  - `packages/meshcore-adapter/package.json`: add `"@liamcottle/meshcore.js": "1.15.0"` (exact). Contract: pinned codec dependency.
  - `pnpm-workspace.yaml`: `allowBuilds` entry `false` for serialport's native binding package (named exactly as pnpm reports), with a comment that the serial connection is never used. Contract: no native build script runs on install.
  - `packages/meshcore-adapter/src/types/meshcore-js.d.ts`: ambient types for the used subset.
  - `packages/meshcore-adapter/src/transport/mesh-transport.ts`: `MeshTransport` (D-2).
  - `packages/meshcore-adapter/src/connection/mesh-core-connection.ts`: subclass as in *Design*. Contract: `new MeshCoreConnection(transport)`; event `LoginFail` with `{ pubKeyPrefix }`.
  - `packages/meshcore-adapter/test/support/memory-transport.ts`: an in-memory `MeshTransport` for tests (records writes, `push(frame)`, `drop()`).
  - `packages/meshcore-adapter/test/mesh-core-connection.int.test.ts`: `deviceQuery` round trip over the memory transport; `sendToRadioFrame` bytes reach `write`; a transport disconnect emits `disconnected`; a 0x86 frame emits `LoginFail` and logs nothing; `close()` unsubscribes.
  - `packages/meshcore-adapter/src/index.ts`: export the transport type and connection; drop the placeholder test in `src/index.test.ts` if it is superseded, otherwise keep it.
- Proves: groundwork for FR-00 AC1 (integration, memory transport).
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`.
- Human checks: none.

### Phase 2: Frame decoders
- Files:
  - `packages/meshcore-adapter/src/decode/bytes.ts`, `path.ts`, `device-info.ts`, `status.ts`, `decode-frame.ts`, `errors.ts`: as in *Design* (D-1, D-9). Contract: `decodeFrame(bytes): DecodedFrame`, `MalformedFrameError`.
  - `packages/meshcore-adapter/src/decode/*.test.ts`: table-driven unit tests with frames built byte by byte from the firmware layouts in *Findings*. One case per `kind`. Path bytes 0x00, 0x05, 0x45, 0x80, 0x85, 0xBF, 0xFF. The device-info output has no PIN field, and PIN bytes do not change it. A status payload with extra room-server bytes ends up in `extraHex`. Telemetry goes through `CayenneLpp`. Every kind has a truncated-frame → `MalformedFrameError` case. Unknown code → `other`.
  - `packages/meshcore-adapter/src/index.ts`: export `decodeFrame`, `DecodedFrame`, `MalformedFrameError`.
- Proves: decoding correctness ahead of FR-00 AC3 (unit). Mutation target `src/decode/*.ts`.
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`.
- Human checks: none.

### Phase 3: Fixture format, redaction, budget and recorder
- Files:
  - `packages/meshcore-adapter/src/fixtures/format.ts` (+ `format.test.ts`): D-3. Contract: `Fixture` type, `readFixture(json)`, `formatVersion: 1`.
  - `pnpm-workspace.yaml`: add `tools/*`.
  - `tools/capture/package.json` (`@guardian/capture`, private, deps `@guardian/meshcore-adapter` workspace, `node-ble` `1.13.0` exact, devDep `tsx` exact; scripts `typecheck`, `capture`), `tools/capture/tsconfig.json`.
  - `tools/capture/src/config.ts`, `budget.ts`, `redact.ts`, `recorder.ts` with tests `config.test.ts` (TR-23: refuses without either variable), `budget.test.ts` (TR-23: a 3rd login is refused; status 30 s after login waits 30 s on the fake clock; a different node does not wait), `redact.test.ts` (D-4 per frame type), `recorder.test.ts` (TR-09: a login with `pw-LEAK-CANARY` through the recorder gives fixture JSON with no canary as text or as hex; rx frames carry `decoded`; a malformed rx frame carries `decodeError`).
  - `vitest.config.mts`: project `capture` (root `tools/capture`).
  - `eslint.config.mjs`: `layer(["tools/**"], [forbid.storage, forbid.deepImport, forbid.react, forbid.expo, forbid.meshcoreJs, forbid.nodeSqlite])`. Contract: tools reach meshcore.js only through the adapter.
  - `tooling/lint/layer-rules.test.ts`: cases for `tools/capture` (meshcore.js and storage are forbidden; the adapter is allowed).
  - `context/test-plan.md`: add `tools/capture/src/**/*.test.ts` to the unit level paths if needed.
- Proves: TR-09 (capture part), TR-23 (unit).
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`.
- Human checks: none.

### Phase 4: node-ble transport and capture CLI
- Files:
  - `tools/capture/src/types/node-ble.d.ts`: minimal ambient types.
  - `tools/capture/src/node-ble-transport.ts` (+ `node-ble-transport.test.ts` with fake device, service and characteristics: a write uses `type: "request"`, `valuechanged` → `onFrame` as `Uint8Array`, `disconnect` → `onDisconnect`, `close` stops notifications and disconnects).
  - `tools/capture/src/capture.ts` (+ `capture.test.ts` over the adapter's memory transport, with a scripted companion and a fake clock: the `handshake` scenario sends no login, status or telemetry; `remote` spaces requests ≥ 60 s; no reply → `no_response` after the D-7 cap; a disconnect mid-run → `aborted`; at most one request in flight).
  - `tools/capture/src/main.ts`: the CLI (D-5, D-8).
  - `package.json` (root): `"capture": "pnpm --filter @guardian/capture capture"`.
  - `CLAUDE.md` *Commands*: add `pnpm capture --scenario handshake|remote` (S-01 only, needs `.env`).
  - `context/test-plan.md` cookbook *Run a hardware capture*: scenario names and output path.
- Proves: FR-00 AC1 orchestration (integration with fakes); TR-23.
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`.
- Human checks: none.

### Phase 5: Hardware capture, fixture tests and compatibility record
- Steps:
  1. `pnpm capture --scenario handshake` (no LoRa TX).
  2. `pnpm capture --scenario remote`. At most two remote runs in total (D-6). Save the console summaries under `evidence/`.
- Files:
  - `packages/meshcore-adapter/fixtures/<firmware>/handshake.json`, `remote.json`: produced by the tool, not edited by hand.
  - `packages/meshcore-adapter/test/fixtures.int.test.ts`: loads every `fixtures/**/*.json` with `readFixture`. It requires ≥ 1 file. Each rx frame with `decoded` must give the same value from `decodeFrame(hex)`. Header firmware equals the decoded device info. No file contains the `pw-LEAK-CANARY` text. Each `decodeError` is reproduced. (TR-06, FR-00 AC3)
  - `docs/compatibility.md`: verdict line at top per D-6, with evidence links. Then a table: item, observed value, `verified`/`not verified`, source fixture. The items are: companion model, firmware version and build, protocol version code, BLE service/RX/TX UUIDs, framing/fragmentation (max frame length seen, one frame per notification?), contact roles seen, path-length encoding, `estTimeout` present for login/status/telemetry (values), correlation (key prefix, no tag on pushes), login behaviour (success/fail push format), status fields, telemetry channels/types, observed latencies. Then the laptop toolchain (BlueZ/node-ble versions). Also: the Android phone row is left for S-02.
  - `context/test-plan.md`: TR-06, TR-09 (S-01 part), TR-23 → `covered`.
  - `context/changes/protocol-feasibility-gate/evidence/capture-*.txt`: console summaries.
- Proves: FR-00 AC1 (hardware, evidence), AC2 (document), AC3 (integration fixture test).
- Agent checks: `pnpm capture --scenario handshake`, `pnpm capture --scenario remote` (hardware, not a gate), `pnpm typecheck`, `pnpm lint`, `pnpm test`.
- Human checks:
  - Compare `docs/compatibility.md` with the companion: the firmware version and model match the Heltec screen or the official MeshCore app. The contact counts are roughly what the app shows.
  - Secret scan: with the BLE PIN as `P`, run `python3 -c "import struct,sys;print(struct.pack('<I',int(sys.argv[1])).hex())" P`. Then run `grep -ril <that hex> packages/meshcore-adapter/fixtures` and confirm there is no match. If `HW_GUEST_PASSWORD` was used, also `grep -ri <password>`.
  - Accept or reject the gate verdict (go/no-go for S-02).

## Risks and unknowns
- **Hardware availability:** phase 5 needs the companion powered, in range of the laptop and
  bonded. If node-ble cannot connect after two honest attempts, the roadmap fallback (USB
  firmware) needs a person to reflash. That is a `[STUCK]` and not something the agent does. The
  fixture test then has no file, so the phase cannot finish green without hardware.
- **Silent target:** Room K's `lastAdvert` is 2024-05-22, so it may be stale or out of range.
  D-6 then yields `FAILED` with "No response — cause unknown", and the person can rerun with
  another `HW_REPEATER`.
- **Guest permissions:** status and telemetry may need a successful login (ACL). Telemetry for
  guests depends on node settings. One of the two is enough for AC1.
- **Room-server status layout:** extra fields after the repeater struct are kept as `extraHex`
  until verified.
- **Path-length encoding** and **device-info layout** are taken from firmware `main` source, not
  from a 1.17.1 tag. The capture confirms or refutes them, and phase 5 updates the decoders and
  tests if needed (a `[minor]` deviation).
- **meshcore.js `once` uses `setTimeout(0)`:** capture and connection tests must advance timers.
- **Installing meshcore.js pulls `serialport`** (native). Blocking its build is expected to be
  harmless because it is only dynamically imported. If install or Metro complains, that is
  recorded as a deviation.
- **Fixture size** (~250 KB for contacts) is acceptable for a private repo. S-02 may trim the
  contact count for e2e by a documented edit.

## Progress
<!-- One line per phase. /implement ticks it in the phase's own commit. -->
- [x] Phase 1: Adapter transport and connection
- [ ] Phase 2: Frame decoders
- [ ] Phase 3: Fixture format, redaction, budget and recorder
- [ ] Phase 4: node-ble transport and capture CLI
- [ ] Phase 5: Hardware capture, fixture tests and compatibility record

## Human checks
<!-- Filled by /implement: one open checkbox per human check, with how to run it and evidence. -->

## Deviations
<!-- [minor] / [REVIEW] / [FOLLOW-UP] / [STUCK] entries, see autonomy.md section 3 -->
- [minor] (Phase 1) Plan: ambient `meshcore-js.d.ts` reached through a triple-slash reference (plan-review #7). Code: typescript-eslint `recommended` forbids `/// <reference path>` (`triple-slash-reference`). Consequence: the reference in `mesh-core-connection.ts` carries a one-line `eslint-disable-next-line` with the reason; later files that import meshcore.js do the same.
- [minor] (Phase 1) Plan: tests for the connection. Code: the adapter tsconfig has `lib: es2023` and no Node types, so `console`, `setTimeout` and `TextEncoder` do not type-check there. Consequence: tests use no Node globals (char codes instead of `TextEncoder`, `globalThis` cast for the console spy, an ordered probe event instead of a `setTimeout` flush); Node types stay out of the package so `Buffer` cannot creep into `src`.
- [minor] (Phase 1) Plan: drop `src/index.test.ts` if superseded. Code: it still checks that `@guardian/domain` resolves through its entry point, which nothing else in the package covers. Consequence: kept.
- [minor] (Phase 1) Plan-review #5: `emit` defers every listener through `setTimeout(0)`. The ambient type documents it, and the connection tests await events instead of expecting synchronous delivery.

## Review response
<!-- revise mode only: one line per plan-review finding and what changed -->
