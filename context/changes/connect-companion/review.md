# Review: connect-companion

Verdict: CHANGES REQUESTED
Gates: typecheck ok, lint ok, unit tests ok (466/466), e2e ok (7/7 flows), mutation not re-run (see `mutation.md`) · Round: 1

## Plan vs diff
| File | Status | Note |
|------|--------|------|
| `packages/domain/src/companion/companion.ts` | done | `CompanionInfo` as planned |
| `packages/domain/src/companion/capabilities.ts` + test | done | D-5 table, `deriveCapabilities`, `actionAvailability` |
| `packages/domain/src/companion/firmware.ts` + test | done | D-6 |
| `packages/domain/src/companion/connection-state.ts` + test | done | D-10 |
| `packages/domain/src/index.ts` | done | exports |
| `packages/meshcore-adapter/src/transport/fake-transport.ts` + test | done | D-1/D-2 |
| `packages/meshcore-adapter/src/transport/handshake-script.ts` | done | D-3 |
| `packages/meshcore-adapter/src/client/errors.ts`, `mesh-client.ts` | done | D-4; send-only library view logged as [minor] deviation |
| `packages/meshcore-adapter/src/types/timers.d.ts` | unplanned | logged [minor] deviation (Phase 2) |
| `packages/meshcore-adapter/test/handshake-script.int.test.ts`, `mesh-client.int.test.ts` | done | |
| `packages/meshcore-adapter/src/index.ts` | done | |
| `apps/mobile/package.json`, `pnpm-lock.yaml` | done | adapter, zustand 5.0.15, expo-sqlite; zod logged as [minor] |
| `apps/mobile/app.json` | unplanned | `expo-sqlite` config plugin; implied by D-7 |
| `apps/mobile/metro.config.js` | done | D-13 |
| `apps/mobile/src/application/connection/ports.ts` | done | |
| `apps/mobile/src/application/connection/advertisement.ts` + test | done | D-8 |
| `apps/mobile/src/application/connection/companion-session.ts` | done | `initialize`, `reset`, `connect(id, name?)` logged as [minor]; see R1 |
| `apps/mobile/src/application/connection/companion-session.int.test.ts` | done | |
| `apps/mobile/src/platform/fake/fake-ble-platform.ts`, `fake/in-memory.ts` | done | `"silent"` attempt logged |
| `apps/mobile/src/debug/scenarios.ts` | done | |
| `apps/mobile/src/platform/ble/{uuids,permissions,base64,ble-transport,ble-platform}.ts` + tests | done | `ble-transport.test.ts` logged; see R2 |
| `apps/mobile/src/platform/last-companion-store.ts` | done | D-7 |
| `apps/mobile/src/platform/last-companion.ts` + test | unplanned | logged [minor] (Phase 4) |
| `apps/mobile/src/platform/app-state.ts` | done | |
| `apps/mobile/src/composition/platform.ts`, `index.ts`; `transport.ts` removed | done | |
| `apps/mobile/src/app/settings.tsx` | done | reads `container.mode` |
| `apps/mobile/src/app/connect.tsx` | done | see R1 |
| `apps/mobile/src/app/index.tsx` | done | |
| `apps/mobile/src/app/debug/scenario/[name].tsx`, `_layout.tsx` | done | D-14 |
| `apps/mobile/src/components/connection-status.tsx` | done | glyph + text + label |
| `apps/mobile/src/i18n/en.json`, `catalog.test.ts` | done | |
| `apps/mobile/e2e/*.yaml` (6 flows) | done | |
| `docs/compatibility.md` | done | |
| `stryker.targets` | diverged | Phase 1 entries for `capabilities.ts`/`firmware.ts` missing (R4) |
| `context/test-plan.md` | diverged | TR-14 marked `covered` without its e2e part (R4) |
| `context/roadmap.md` | done | status set by the workflow |
| `context/changes/connect-companion/{plan,plan-review,mutation}.md`, `evidence/*` | done | |

## Areas
| Area | Result | One-line reason |
|------|--------|-----------------|
| Correctness | fail | Retry does nothing (or targets another companion) after the Connect screen remounts (R1) |
| Design | ok | Layers respected: session is pure TS, domain imports nothing, meshcore.js stays in the adapter |
| Safety | concern | BLE scan errors are swallowed and turn into "No companions found" (R2) |
| Tests | concern | `mesh-client.ts` below its 80 % target with two implausible `accept`s (R3) |
| Simplicity | ok | Small, cohesive modules; no dead code found |
| Plan fidelity | concern | `stryker.targets` and TR-14 status out of sync with the plan (R4) |
| Agent decisions | ok | D-7 (costly) sits in one file behind `LastCompanionStore`; swap to D-7 B is a one-line composition change |

## Findings
### R1: Retry is a no-op, or targets the wrong companion, after the Connect screen remounts
- Severity: blocker
- Where: `apps/mobile/src/application/connection/companion-session.ts:101`, `apps/mobile/src/app/connect.tsx:20`
- Problem: `ConnectScreen` calls `session.initialize()` on every mount, and `initialize()` overwrites `lastTarget` with the stored companion. Repro (verified with a scratch test on the `connect-fail` scenario): fresh install, `connect(id)` fails with `CONNECT_ERROR`, `initialize()` again (user goes to the Dashboard and back), `retry()`. The state stays `failed` and `platform.connect` is called once in total, so the Retry button the screen still shows does nothing (FR-01 AC5). If a different companion was remembered, Retry connects to that one instead of the one that failed.
- Fix: do not touch `lastTarget` in `initialize()` when it is already set (only seed it from the store when it is `null`), or run `initialize()` once at composition or app start, not per screen mount. Add an integration test: fail, `initialize()`, `retry()` → connects to the same id.
- Effort: small
- Lesson candidate: Screen effects that may run many times must not reset use-case state; make `initialize`-style calls idempotent.
- Decision: open

### R2: BLE scan errors are swallowed and shown as "No companions found"
- Severity: major
- Where: `apps/mobile/src/platform/ble/ble-platform.ts:57-68`, `apps/mobile/src/application/connection/ports.ts` (`scan`)
- Problem: when ble-plx reports a scan error through the listener (Bluetooth switched off mid-scan, `ScanStartFailed`, unauthorized), the platform only calls `stopDeviceScan()`. The session is not told, keeps `scan.status: "scanning"` until the 10 s timer, and then sets `done` with an empty list. `bluetooth` is still `"on"` from the pre-scan check, so `connect.tsx:97` shows "No companions found". This is the exact misreport TR-13 / FR-01 AC3 guard against, and it breaks the "external failures mapped to clear errors, nothing swallowed" rule. Also, `void manager.startDeviceScan(...)` and `manager.stopDeviceScan()` return promises that can reject, and those rejections are unhandled.
- Fix: give `BlePlatform.scan` an error path (an `onError` callback, or a returned promise). In the session, end the scan with a distinct state (`scan.status: "failed"` plus a reason) and re-read the adapter state so Bluetooth off shows "Bluetooth is off". Catch both promise rejections. Cover it with a fake-platform scan error in the integration test.
- Effort: medium
- Lesson candidate: Every port that starts native work must surface its failure to the use case; a callback-only API needs an error callback.
- Decision: open

### R3: `mesh-client.ts` is below its mutation target, and two `accept`s do not hold
- Severity: major
- Where: `context/changes/connect-companion/mutation.md` (mesh-client rows 132-133, 175/180/184); `packages/meshcore-adapter/src/client/mesh-client.ts:130-136,173-188`
- Problem: the test plan's target for `mesh-client.ts` is 80 % (TR-04, TR-05, TR-08). The score is 75.8 %. Two of the survivor decisions are not plausible:
  - (a) 132-133 is accepted because "no transport double throws [a non-transport error]". The production `BleTransport.write` throws a plain `Error` (`ble-transport.ts:77`), and ble-plx write failures are `BleError`s, so this is the real BLE path.
  - (b) 175/180/184 (ignore frames of the wrong kind, malformed frames) is accepted because `FakeTransport` cannot inject frames, and it is "covered by decode tests". The decode tests do not exercise `MeshClient`'s kind filter, and `MeshTransport` has four methods, so a ten-line test double can push any frame. This filter is the TR-08 rule that S-04 builds on.
- Fix: add `mesh-client.int.test.ts` cases with a minimal hand-written `MeshTransport`: a write that rejects with a plain `Error` → `TransportUnavailableError` at once (not a 30 s timeout); an unsolicited `other`/`ok` frame during `deviceQuery` is ignored and the real reply still resolves; a malformed frame during a step → `MalformedFrameError`. Re-run mutation on the file and update `mutation.md`.
- Effort: small
- Lesson candidate: Do not accept a mutant because the shared fake cannot reach it; write a minimal port double in the test.
- Decision: open

### R4: Mutation targets and the TR-14 status are out of sync with the plan
- Severity: minor
- Where: `stryker.targets:14`, `context/test-plan.md:34`
- Problem: Phase 1 says to add `packages/domain/src/companion/capabilities.ts` and `firmware.ts` to both `stryker.targets` and the test-plan table. Only the test plan has them. The file header says to keep both in sync, so the CI `mutation-report` job skips them. TR-14 is marked `covered (S-02)`, but its test column says "e2e asserts disabled button and reason text", and there are no action buttons until S-04.
- Fix: add the two domain files to `stryker.targets`. Set TR-14 to `covered (S-02: mapping + reason text); S-04 adds the disabled-button e2e`.
- Effort: small
- Lesson candidate: no
- Decision: open
