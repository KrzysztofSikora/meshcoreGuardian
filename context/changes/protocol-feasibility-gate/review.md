# Review: protocol-feasibility-gate

Verdict: APPROVE
Gates: typecheck ok, lint ok, unit tests ok (21 files, 341 tests), e2e ok (smoke flow on AVD `guardian`), mutation not rerun (per-module results in `mutation.md`: 97.1 % on the 11 targets) · Round: 1

## Plan vs diff
| File | Status | Note |
|------|--------|------|
| `packages/meshcore-adapter/package.json` | done | meshcore.js pinned `1.15.0` exactly |
| `pnpm-workspace.yaml` | done | `tools/*`; `allowBuilds` blocks serialport, usocket, esbuild (deviation logged) |
| `packages/meshcore-adapter/src/types/meshcore-js.d.ts` | done | used subset; triple-slash reference (deviation logged) |
| `packages/meshcore-adapter/src/transport/mesh-transport.ts` | done | D-2 contract |
| `packages/meshcore-adapter/src/connection/mesh-core-connection.ts` | done | `LoginFail` keyed by code (D-10); exports `COMPANION_PROTOCOL_VERSION` (deviation logged) |
| `packages/meshcore-adapter/test/support/memory-transport.ts` | done | |
| `packages/meshcore-adapter/test/mesh-core-connection.int.test.ts` | done | all five planned cases |
| `packages/meshcore-adapter/src/index.ts` | done | |
| `packages/meshcore-adapter/src/decode/{bytes,path,device-info,status,decode-frame,errors}.ts` | done | D-1 corrections; contact name read raw (deviation logged) |
| `packages/meshcore-adapter/src/decode/*.test.ts` | done | one case per kind, truncation per kind, path bytes table |
| `packages/meshcore-adapter/test/support/frames.ts` | unplanned | frame builders kept outside the mutation glob (deviation logged) |
| `packages/meshcore-adapter/src/fixtures/format.ts` (+ test) | done | D-3, D-14 |
| `tools/capture/package.json`, `tsconfig.json` | done | node-ble `1.13.0`, tsx `4.23.15` exact |
| `tools/capture/src/{config,budget,redact,recorder}.ts` (+ tests) | done | D-4, D-13, D-20 in `redact.ts` only |
| `vitest.config.mts` | done | project `capture` |
| `eslint.config.mjs`, `tooling/lint/layer-rules.test.ts` | done | `tools/**` layer with tests |
| `tools/capture/src/types/node-ble.d.ts` | absent | node-ble ships types; logged deviation (Phase 4) |
| `tools/capture/src/node-ble-transport.ts` (+ test) | done | every connect step bounded, close best-effort |
| `tools/capture/src/capture.ts` (+ test) | done | D-7, D-15, D-16, D-19 |
| `tools/capture/src/main.ts` | done | exit codes 0/1/2/3 (deviation logged) |
| `tools/capture/src/cli.ts`, `hex.ts` (+ `cli.test.ts`) | unplanned | split out of `main.ts` for tests; logged deviation (Phase 4) |
| `tools/capture/test/support/{fake-clock,fake-transport,frames}.ts` | unplanned | D-12 |
| `package.json` (root) | done | `capture` script |
| `CLAUDE.md` | done | capture and redecode commands |
| `context/test-plan.md` | done | unit path, cookbook, TR-06/09/23 statuses, decode row without Zod |
| `packages/meshcore-adapter/fixtures/v1.17.1-d929643/{handshake,remote}.json` | done | produced by the tool, one remote run |
| `packages/meshcore-adapter/test/fixtures.int.test.ts` | done | see R1 for one redaction rule it does not check |
| `docs/compatibility.md` | done | verdict on top, every AC2 item marked |
| `context/changes/protocol-feasibility-gate/evidence/capture-*.txt` | done | |
| `context/roadmap.md` | unplanned | status column only |
| `pnpm-lock.yaml` | unplanned | follows the new dependencies |
| `context/changes/protocol-feasibility-gate/{plan-review,mutation,pr-body}.md` | unplanned | workflow artifacts |

## Areas
| Area | Result (ok / concern / fail) | One-line reason |
|------|------------------------------|-----------------|
| Correctness | ok | Decoders match the recorded firmware 1.17 frames (730 rx, 0 decode errors); reply matching, retries and abort paths are tested; every wait is bounded |
| Design | ok | Adapter owns the transport, connection, codec corrections and fixture format; tools reach meshcore.js only through the adapter (lint-enforced) |
| Safety | ok | Redaction applies only to the recorded copy; PIN, password, self position/name, chat names/positions and raw RX-log packets are absent from the committed fixtures (checked by script) |
| Tests | concern | Thorough and deterministic; the committed-fixture test leaves the chat-contact rule of D-4 to the unit tests only (R1) |
| Simplicity | ok | Small modules, constants in one block each; minor duplication (`fromHex`) is deliberate (D-12) |
| Plan fidelity | ok | All divergences are logged under *Deviations*; one doc string and the cookbook were not updated after a logged deviation (R2) |
| Agent decisions | ok | Costly D-3/D-13/D-14/D-20 each live in one file (`format.ts`, `redact.ts`); D-20 has a `[REVIEW]` deviation and a Decisions row |

## Findings
### R1: Committed-fixture test does not check the chat-contact redaction
- Severity: minor
- Where: `packages/meshcore-adapter/test/fixtures.int.test.ts:112-132`
- Problem: The raw-byte redaction checks cite D-4 and D-13, but they only cover the device-info PIN, the self-info position and name, and the 0x88 packet. Nothing in the fixture test asserts that type-1 contact and new-advert frames (`03`/`8a`, byte 33 = `01`) carry the name `chat-<n>` and zero lat/lon (bytes 136–143). The 60 chat contacts in today's fixtures are correctly redacted (checked with a script), and `redact.ts` has 100 % mutation score, but a fixture written by a future redactor regression, or edited by hand, would pass `pnpm test`. The plan-review #2 intent was to check the committed bytes, not just the redactor.
- Fix: Add a case to the per-fixture `describe.each`: for every rx frame with code `03` or `8a`, 148 bytes and type byte `01`, expect the name field to match `^chat-\d+$` with zero padding and bytes 136–143 to be zero.
- Effort: small
- Lesson candidate: no
- Decision: open

### R2: Docs still say `HW_COMPANION` may be a device name
- Severity: minor
- Where: `tools/capture/src/config.ts:2`, `context/test-plan.md:150`
- Problem: The Phase 4 deviation records that node-ble finds devices by address only and `connectNodeBle` refuses anything that is not `AA:BB:CC:DD:EE:FF` (`node-ble-transport.ts:65-69`). The `CaptureConfig.companion` doc comment still reads "BLE address or advertised name" and the cookbook step 2 still says `HW_COMPANION=<MAC or name>`, so an operator following the cookbook gets a usage error. The roadmap's user decision also says "address or name"; the narrowing is visible only in the deviation log.
- Fix: Change both texts to "BLE address (AA:BB:CC:DD:EE:FF)". Leave the roadmap wording to the person, and mention the narrowing in the PR body next to the deviation.
- Effort: small
- Lesson candidate: no
- Decision: open
