# Roadmap

Sources: `context/prd.md`, `context/tech-stack.md`. Order follows risk: the protocol gate first
(D-09), then the connection, contacts, and the diagnostic run that every later screen reads.

## Overview
| ID | Issue | change-id | Type | Covers | Depends on | Size | Status |
|----|-------|-----------|------|--------|------------|------|--------|
| F-01 | #1 | repo-skeleton | foundation | C-02, C-03, C-09 | - | M | done |
| S-01 | #2 | protocol-feasibility-gate | slice | FR-00 | F-01 | M | done |
| S-02 | #3 | connect-companion | slice | FR-01, FR-02, FR-03 | S-01 (gate passed) | L | done |
| S-03 | #4 | sync-contacts | slice | FR-04 | S-02 | M | done |
| S-04 | #5 | run-diagnostic | slice | FR-05, FR-06, FR-09, FR-10, FR-11 | S-03 | L | review |
| S-05 | #6 | guest-password | slice | FR-14, FR-05 AC2 | S-04 | S | todo |
| S-06 | #7 | node-details-telemetry | slice | FR-07, FR-08 | S-04 | M | todo |
| S-07 | #8 | battery-history | slice | FR-12 | S-06 | M | todo |
| S-08 | #9 | export-report | slice | FR-13 | S-06 | M | todo |
| S-09 | #10 | settings | slice | FR-15 | S-04 | M | todo |
| S-10 | #11 | pilot-release | slice | FR-20, NFR-05, NFR-06 | S-05 … S-09 | M | todo |

## Items

### F-01 Repository skeleton (`repo-skeleton`)
- Goal: a pnpm workspace that builds, lints, type-checks and tests, so every gate in `CLAUDE.md` exists and passes on an empty app.
- Covers: C-02, C-03, C-09; tech-stack *Local development*.
- Depends on: -
- Acceptance:
  - Packages `apps/mobile`, `packages/domain`, `packages/meshcore-adapter`, `packages/storage`; TypeScript 6.0.3 strict; `node-linker=hoisted`.
  - Root scripts `typecheck`, `lint`, `test`, `e2e`, `mutation` exist and pass (one trivial test per package; one Maestro smoke flow that launches the app; Stryker config runs on one domain file).
  - ESLint `no-restricted-imports` enforces the layer rules from tech-stack; a test file shows a forbidden import fails lint.
  - Expo SDK 57 app with expo-router, five empty routes, i18next catalog `en.json`; dev build config with the ble-plx config plugin and Android `minSdkVersion` 31.
  - `EXPO_PUBLIC_TRANSPORT` switch exists (value `fake` selects a stub transport).
  - Test tooling as configured in `context/test-plan.md`: Vitest projects, `openTestDb` helper on `node:sqlite`, Stryker config (*Mutation targets → Tool setup*), `pnpm e2e` that boots AVD `guardian` headless when no device is attached and defaults `JAVA_HOME`/`ANDROID_HOME`.
  - `.github/workflows/ci.yml`: typecheck, lint, test on every PR; `mutation-report` job (report only).
  - `.env.example` with `HW_COMPANION`, `HW_REPEATER`, `HW_GUEST_PASSWORD` (empty); `.env` gitignored.
- Unknowns: Maestro on the local emulator — if no emulator is available, `pnpm e2e` is documented and recorded as a human check.
- Decided up front: -
- Size: M

### S-01 Protocol feasibility gate (`protocol-feasibility-gate`)
- Goal: prove on real hardware that the MeshCore companion protocol works through our transport abstraction, and turn real traffic into fixtures. **Go/no-go gate (D-09).**
- Covers: FR-00 (AC1–AC3).
- Depends on: F-01
- Acceptance: PRD FR-00 AC1–AC3; `docs/compatibility.md` filled from observed behaviour; fixtures committed under `packages/meshcore-adapter/fixtures/`.
- Observed 2026-10-11 (interactive, read-only, no LoRa TX): `node-ble` 1.13 + meshcore.js 1.15 `Connection` subclass over the Nordic UART service reached the companion `AC:A7:04:07:CE:C1` (bond made with `bluetoothctl`): `deviceQuery` → Heltec V3, firmware `v1.17.1-d929643`, build 14-Aug-2026, `firmwareVer` 13; `getContacts` → 306 repeaters, 14 rooms, 30 chat. Target node `HW_REPEATER` is the room server "Room K" (`7c73a8cd01d92e24`). meshcore.js decodes `outPathLen` as signed (-1, -123, -128): firmware 1.17 path-length encoding likely differs — verify and handle in the adapter. Room K's `lastAdvert` is 2024-05-22 (unset clock or stale advert).
- Unknowns: whether the guest login/status/telemetry round trip works to Room K; whether `estTimeout` is returned for status/telemetry; correlation of responses; telemetry availability on the repeater firmware.
- Decided up front:
  - Hardware path → the companion (Heltec V3, BLE firmware) is reached from the **laptop over BLE**: a dev-only workspace `tools/capture` with `node-ble` (1.13.x, MIT; BlueZ over D-Bus) implementing the same `MeshTransport` interface the app will use. The companion is paired and trusted once with `bluetoothctl` (PIN) by the person; `node-ble` reuses that bond. (noble was dropped: its pairing works on Windows only, and the companion requires a PIN bond.) If `node-ble` cannot connect, fall back to `companion_radio_usb` firmware with meshcore.js `NodeJSSerialConnection` and record it as a `[REVIEW]` deviation. (user)
  - `packages/meshcore-adapter` gets `MeshTransport` and `MeshCoreConnection` (subclass of meshcore.js `Connection` over any `MeshTransport`); the capture tool and later the app both use it. (user, tech-stack)
  - The agent may send live radio requests **only in this item**, via `pnpm capture`, which runs only when `HW_COMPANION` (BLE address `AA:BB:CC:DD:EE:FF`; node-ble cannot look devices up by name) and `HW_REPEATER` (public key prefix) are set in `.env`. Limits per run: one handshake, one contact sync, ≤ 2 logins, ≤ 2 status, ≤ 2 telemetry requests, ≥ 60 s between requests to the same node. Gates (`test`, `e2e`) never touch the radio. (user)
  - Each capture writes a JSON file: device info, firmware version, and every frame with direction, monotonic timestamp and hex payload. Secrets (guest password) are never written. Fixture tests decode these files with the adapter and compare against the values the capture logged. (user)
  - Gate verdict is written at the top of `docs/compatibility.md` (`PASSED` / `FAILED` + evidence). If it fails, the PR says so and later items are not started.
  - Android-specific BLE behaviour (MTU, bonding dialog, Hermes compatibility of meshcore.js) is **not** part of this item; it is a human check in S-02.
- Size: M

### S-02 Connect to the companion (`connect-companion`)
- Goal: from the app, grant permissions, scan, connect to the companion, see capabilities, survive disconnects.
- Covers: FR-01, FR-02, FR-03.
- Depends on: S-01 with gate `PASSED`.
- Acceptance: PRD FR-01 AC1–AC5, FR-02 AC1–AC3, FR-03 AC1–AC3. E2E flows on `FakeTransport` for permission denied, Bluetooth off, connect success, connect failure, link drop + reconnect, unsupported capability. Human check on a real phone: connect to the Heltec, capabilities shown, meshcore.js runs under Hermes.
- Unknowns: Android bonding/PIN dialog behaviour with ble-plx; MTU negotiation size.
- Decided up front:
  - `FakeTransport` replays S-01 fixture files and supports scripted faults (timeout, drop, malformed frame); it is the only transport in e2e. (tech-stack)
  - One connected companion at a time (A-04); the last companion is remembered for quick reconnect, but connecting is always user-initiated (no auto-reconnect in background, NFR-07).
- Size: L

### S-03 Sync contacts (`sync-contacts`)
- Goal: load companion contacts into local storage and show known nodes on the dashboard with role and label.
- Covers: FR-04.
- Depends on: S-02
- Acceptance: PRD FR-04 AC1–AC4; storage tests on `node:sqlite`; e2e: sync, label edit, restart keeps labels.
- Unknowns: whether role is exposed for every firmware (Q-03).
- Decided up front:
  - Storage foundation lands here: `SqlDriver`, migration runner, `0001_init.sql` with `devices`. (tech-stack)
  - **Node identity is global by public key** (full 32-byte hex, unique); the companion is not part of a node's key. Every later run stores the companion identity. (user)
  - Contacts with role repeater, room server or unknown are added to the dashboard automatically on each sync; chat contacts appear only in an "All contacts" list and can be added manually. A node no longer in the companion's contacts keeps its history and shows "Not in companion contacts"; diagnostics are disabled for it. (user)
  - User-set role and label always override protocol-reported values; the protocol value is kept for display ("reported as …").
- Size: M

### S-04 Run a diagnostic (`run-diagnostic`)
- Goal: the core promise — a user-initiated, bounded, cancellable check with an honest, explained, stored result.
- Covers: FR-05, FR-06, FR-09, FR-10, FR-11.
- Depends on: S-03
- Acceptance: PRD FR-05 AC1, AC3, AC4; FR-06 AC1–AC6; FR-09 AC1–AC3; FR-10 AC1–AC6; FR-11 AC1–AC2. Unit tests cover every result × reason pair in the rule table and every timeout-policy branch; e2e on fixtures for responded, no response, transport drop, unsupported, malformed, cancel. A test asserts the words "offline", "down", "dead" never appear in the catalog.
- Unknowns: interplay of `estTimeout` and the 30 s cap on flood routes (fixtures from S-01).
- Decided up front:
  - **A run is an ordered list of checks**: `login` (empty guest password until S-05) → `status` → `telemetry` (if the capability exists). Each check stores its own outcome, reason, attempts, timeout source and duration in a `diagnostic_checks` table (`run_id`, `seq`, `kind`, …). (user)
  - **Overall result = best evidence**: `RESPONDED` if the node replied to any check (including only login), with each failed check listed under limitations; `NO_RESPONSE` only when no check got a reply; `TRANSPORT_UNAVAILABLE` / `UNSUPPORTED` as in FR-06. A run whose login is rejected is `RESPONDED` with reason `LOGIN_REJECTED` (the node answered). (user)
  - Timeout, retry, cooldown and single-flight live in `MeshClient` in `packages/meshcore-adapter`, with policy values from `packages/domain` (D-06, D-07). Defaults are used until S-09 adds the Settings UI.
  - Rule table (result × reason → explanation, next steps, limitations) is a typed constant in `packages/domain`; texts are i18n keys.
- Size: L

### S-05 Guest password (`guest-password`)
- Goal: per-node optional guest password, stored only in secure storage and used by the login check.
- Covers: FR-14, FR-05 AC2.
- Depends on: S-04
- Acceptance: PRD FR-14 AC1–AC3, FR-05 AC2; a test scans the SQLite file and export output for a known test password.
- Unknowns: -
- Decided up front: `SecretStore` keyed by node public key; deleting a node or clearing data deletes its secret (D-02).
- Size: S

### S-06 Node details and telemetry (`node-details-telemetry`)
- Goal: node details screen with latest telemetry (units, provenance), recent runs, and persistence across restarts.
- Covers: FR-07, FR-08.
- Depends on: S-04
- Acceptance: PRD FR-07 AC1–AC3, FR-08 AC1–AC3; migration test from schema v1 to current with data preserved.
- Unknowns: which telemetry fields the repeater firmware returns (from S-01 fixtures).
- Decided up front: telemetry is stored as one row per sample with typed nullable columns from PRD data model plus an `extra_json` for values with units not in the fixed columns; RSSI/SNR carry a `scope` (`last_hop` | `unknown`).
- Size: M

### S-07 Battery history (`battery-history`)
- Goal: voltage chart and honest trend text.
- Covers: FR-12.
- Depends on: S-06
- Acceptance: PRD FR-12 AC1–AC4; the chart has an accessible list alternative.
- Unknowns: -
- Decided up front: trend threshold ≥ 5 samples over ≥ 24 h (A-01); no prediction of any kind.
- Size: M

### S-08 Export report (`export-report`)
- Goal: JSON/CSV export for a node and date range with preview and redaction.
- Covers: FR-13.
- Depends on: S-06
- Acceptance: PRD FR-13 AC1–AC5; export schema validated with Zod; golden-file tests for JSON and CSV with redaction on and off.
- Unknowns: -
- Decided up front: public keys redacted to a 4-byte hex prefix by default (D-08); export format carries a `schema_version`.
- Size: M

### S-09 Settings (`settings`)
- Goal: timeout/attempt overrides, redaction default, firmware info, delete node history and clear all data.
- Covers: FR-15.
- Depends on: S-04
- Acceptance: PRD FR-15 AC1–AC3.
- Unknowns: -
- Decided up front: deletion is hard delete with confirmation, including secrets (D-12, FR-14 AC3).
- Size: M

### S-10 Pilot release (`pilot-release`)
- Goal: a signed AAB on the Play internal testing track and the non-functional checks for the pilot.
- Covers: FR-20, NFR-05, NFR-06 (verification), Success criteria (definition of done).
- Depends on: S-05, S-06, S-07, S-08, S-09
- Acceptance: PRD FR-20 AC1–AC2; accessibility audit (contrast, labels, 200 % font) recorded; profiler trace with 200 nodes / 1,000 runs; licenses screen including meshcore.js MIT notice; privacy policy text in `docs/privacy-policy.md`.
- Unknowns: Play Console account readiness (R-05).
- Decided up front: EAS Build `production` profile → AAB; upload to Play is a human step (credentials never in the repo).
- Size: M

## Later
- FR-16 Battery profile warning (P1, Could).
- FR-17 Multi-attempt test and success ratio (P1, Could).
- FR-18 Route trace (P1, Could).
- FR-19 Local reminders (P1, Could).

## Open roadmap questions
- If S-01 fails, re-plan before S-02 (D-09); the alternatives (USB transport, reduced scope) are not pre-planned.
- Q-05 (device matrix) is settled in `/test-plan`.
