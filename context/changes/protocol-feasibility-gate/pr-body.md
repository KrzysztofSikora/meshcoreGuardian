# feat(protocol-feasibility-gate): protocol feasibility gate passed on real hardware (S-01)

Roadmap item S-01 (FR-00). The adapter now has the `MeshTransport` interface, a meshcore.js `Connection` subclass and `decodeFrame`, which turns every companion frame this product needs into a typed record and corrects the places where meshcore.js 1.15.0 misreads firmware 1.17. `tools/capture` (dev only) connects to a real companion over BLE with `node-ble`, runs a bounded and budgeted capture and writes a redacted fixture. A capture from the laptop completed the handshake, read all 350 contacts and decoded a status and a telemetry response from `HW_REPEATER`. `docs/compatibility.md` records the verdict `PASSED`. `pnpm test` decodes every committed fixture. Covers PRD FR-00 AC1, AC2 and AC3, and test-plan risks TR-06, TR-09 (capture part) and TR-23.
Closes #2

> **Status:** Ready for review

## ⚠ Needs your decision
- **Gate verdict `PASSED` (go/no-go for S-02).** Limits: the target was a room server (Room K, role 3), not a repeater, so repeater-only status behaviour is `not verified`. One companion, one firmware (`v1.17.1-d929643`), laptop BlueZ only. See [`docs/compatibility.md`](../../../docs/compatibility.md). If you reject it, S-02 must be re-planned (D-09).
- **D-4 / D-13 / D-20 (costly, privacy):** what reaches committed fixtures. → chose **redact**: BLE PIN, self position, self name (`companion`), chat-contact names (`chat-<n>`) and positions, guest password, and the raw packet inside every `0x88` RX-log push. Repeater and room data stay verbatim. Alternatives: password only (simplest, commits PIN and home location); also redact repeater names and positions (most private, less realistic fixtures); keep `0x88` verbatim (real RF data, but chat adverts and decryptable public-channel text bypass the redaction); drop `0x88` frames (timeline loses them). Switching costs: `tools/capture/src/redact.ts`, then fixtures can only be regenerated with hardware and radio TX. Chat contacts' public keys stay verbatim.
- **D-3 / D-14 (costly):** fixture format `formatVersion: 1` (one JSON file per run; `header.firmware` is `{ version, buildDate, verCode, model }` or `null`; `summary` with request outcomes `responded / rejected / error / no_response`). S-02's `FakeTransport` reads it. Alternatives: one file per step; JSON lines; flat header with empty strings. Switching costs: `packages/meshcore-adapter/src/fixtures/format.ts`, the fixtures and their tests.
- **[REVIEW] (Phase 5) D-20 appeared during the first capture:** `0x88` pushes carry raw over-the-air packets. The plan's D-4 did not cover them. Alternative: keep them verbatim (D-20 B).
- **Narrowing of `HW_COMPANION`:** the roadmap says "address or name". node-ble finds devices by address only, so the tool refuses anything but `AA:BB:CC:DD:EE:FF`. Docs were fixed (R2, [bcc370f](../../..)); the roadmap wording is left to you.
- **Plan review / review leftovers:** None. Plan review was READY WITH NOTES (11 findings, all handled as logged decisions D-12 to D-19 and deviations); review APPROVE with R1 and R2 fixed.

Reply in a review comment, e.g. `D-3: take B`, `R4: fix it`, `drop the lessons commit`,
then run `.claude/workflow/address-pr <PR number>`.

## Human checks
- [ ] (Phase 5) Firmware version and model in `docs/compatibility.md` (`Heltec V3`, `v1.17.1-d929643`, 14-Aug-2026) match the Heltec screen or the official MeshCore app, and the contact counts (306 repeaters, 14 rooms, 30 chat; 350 total, table full) are roughly what the app shows. Run: open `docs/compatibility.md` next to the app's device and contact screens. Evidence: [`capture-handshake.txt`](evidence/capture-handshake.txt), [`capture-remote.txt`](evidence/capture-remote.txt)
- [ ] (Phase 5) Secret scan of the committed fixtures: no BLE PIN, no guest password. Run: `P=<BLE PIN>; H=$(python3 -c "import struct,sys;print(struct.pack('<I',int(sys.argv[1])).hex())" $P); grep -ril "$H" packages/meshcore-adapter/fixtures context/changes/protocol-feasibility-gate/evidence` (expect no output). The remote run used the empty guest password from `.env`, so there is no password to grep; `fixtures.int.test.ts` already checks that the PIN bytes are zero and that no `pw-LEAK-CANARY` text or hex exists. Evidence: none
- [ ] (Phase 5) Accept or reject the gate verdict `PASSED` (go/no-go for S-02), with the limits above. Run: read the verdict block and tables in `docs/compatibility.md`. Evidence: [`remote.json`](../../../packages/meshcore-adapter/fixtures/v1.17.1-d929643/remote.json), [`capture-remote.txt`](evidence/capture-remote.txt)

## Other decisions made by the agent (cheap to change)
Full rows with reasons: [plan.md#decisions](plan.md#decisions).

| ID | Question | Chosen | Alternatives |
|----|----------|--------|--------------|
| D-1 | How to decode given meshcore.js misreads | meshcore.js parsers via a parse-only `Connection`, plus explicit corrections (device info, status, path length, login-fail) | own parser for all codes; library events as they are |
| D-2 | `MeshTransport` contract | `write`, `onFrame`, `onDisconnect`, `close`; one call = one frame; connecting in each factory | `connect()`/`state` on the interface; byte-chunk stream |
| D-5 | Running TS with source-only imports | `tsx` pinned in `tools/capture` only | bundle step; `.ts` extensions repo-wide |
| D-6 | PASSED/FAILED rule | PASSED iff device info + full contact list + ≥ 1 status or telemetry from `HW_REPEATER` + green fixture tests; max two `remote` captures, ≥ 60 s apart, only that node | `INCONCLUSIVE` verdict; try other repeaters |
| D-7 | Capture reply timeout | `estTimeout + 5 s`, hard cap 45 s; SENT/ERR 5 s; sequential | 30 s; library timers (unbounded) |
| D-8 | Scenarios and output names | `handshake` (no LoRa TX) and `remote`; `fixtures/<firmware>/<scenario>.json` | one fixed full run; a flag per request kind |
| D-9 | Zod now? | No; plain typed records, `MalformedFrameError` | Zod and domain entities now |
| D-10 | Login-fail event name | numeric `0x86`, payload `{ pubKeyPrefix }` | string `"LoginFail"` |
| D-11 | Units of decoded values | hex strings, degrees, radio and SNR raw (`UNVERIFIED`), `lppHex` kept | all raw integers; scale now |
| D-12 | Test transport in `tools/capture` | own `FakeTransport` | export adapter `MemoryTransport`; relative import |
| D-15 | `remote` after a failed request | each request once, retry only on no reply; status and telemetry sent whatever the login outcome | stop after failed login; retry every failure |
| D-16 | Bounds for the remaining waits | 5 s for device query, app start, first contacts frame, SENT/ERR and contact-sync idle; BLE 20 s per connect step; abort reason written to the fixture | one overall timeout |
| D-17 | Remote rerun file names | `remote.json`, else `remote-2.json`; CLI refuses a third | overwrite; timestamp in names |
| D-18 | Fixture after a decoder fix | `pnpm capture --redecode <file>` (no BLE) | hand edit; recapture |
| D-19 | Reply matching | decode on the recording link with `decodeFrame`, match `kind` and key prefix | meshcore.js events |

Minor deviations (Phases 1–5) are listed in [plan.md#deviations](plan.md#deviations): the `triple-slash-reference` lint exception, no ambient node-ble types, `cli.ts`/`hex.ts` split from `main.ts`, exit codes 0/1/2/3, `allowBuilds` for `usocket` and `esbuild`, and others. One remote capture was recorded; two earlier attempts failed to connect without radio TX ([evidence](evidence/capture-remote-connect-failures.txt)).

## Quality
- Gates: typecheck ok, lint ok, unit tests ok (21 files, 341 tests), e2e ok (smoke flow on AVD `guardian`); mutation not rerun in review ([review.md](review.md)).
- Review: APPROVE, round 1: fixed 2 (R1 chat-contact redaction check in the committed-fixture test, R2 `HW_COMPANION` docs), deferred 0, rejected 0.
- Mutation: 92.7% → 97.1% on 11 target files ([mutation.md](mutation.md)); `bug` mutants: none (survivors were strengthened, equivalent or accepted). One privacy leak found by a surviving mutant and fixed: a shorter chat name left the tail of the real name in the contact name field.
- Proposed lessons: one candidate in `mutation.md` ("check every field width and bound with input that fills the field exactly"); not committed to `context/lessons.md`, so there is no commit to drop.

## Follow-ups
- Ctrl-C during a capture exits without writing a fixture; writing what was recorded on SIGINT would keep that evidence.
- The companion sends `0x90` (contacts full) when its 350-entry table is full. The adapter decodes it as `other` and meshcore.js logs `unhandled frame: code=144`. S-03 should decode it and decide what the operator sees.
- After a capture disconnected, the companion stopped advertising for about 5 minutes (seen once). S-02's reconnect UX should not assume it is visible again at once.
- Test plan gaps ([mutation.md](mutation.md)): no *Mutation targets* rows for `fixtures/format.ts` and `tools/capture/src/{redact,budget,capture}.ts` (`redact.ts` proposed at 80%); use `--force` for the final mutation run; `i32le` in `decode/bytes.ts` is unused by production code.
- Telemetry truncation: a cut GPS value is not detected (the library reads missing bytes as 0); S-06 owns telemetry validation.

## Commits
```
c75351a docs(protocol-feasibility-gate): triage review round 1
bcc370f fix(protocol-feasibility-gate): companion is a BLE address only in docs (R2)
32d9f80 fix(protocol-feasibility-gate): check chat-contact redaction in committed fixtures (R1)
ba9aee3 docs(protocol-feasibility-gate): review
d75a4cf docs(protocol-feasibility-gate): pr-body
647da1c docs(protocol-feasibility-gate): mutation
4f9c2e9 test(protocol-feasibility-gate): strengthen assertions from mutation check
502de25 feat(protocol-feasibility-gate): hardware fixtures, fixture tests and compatibility record
a462733 feat(protocol-feasibility-gate): node-ble transport and capture CLI
2c258c7 feat(protocol-feasibility-gate): fixture format, redaction, request budget and recorder
75c662e feat(protocol-feasibility-gate): frame decoders for firmware 1.17 companion frames
13d40bb feat(protocol-feasibility-gate): adapter transport interface and meshcore.js connection
c7446bf docs(protocol-feasibility-gate): plan-review
5bdae88 docs(protocol-feasibility-gate): plan
```

<details><summary>Run</summary>

Branch `change/protocol-feasibility-gate`, base `main`. Failed step: none. Draft reason: none. Plan review: READY WITH NOTES. Review: APPROVE (0 open findings after fix-review). Phases ticked: 5/5.

| Step | Attempts | Cost |
|------|----------|------|
| plan | 1 | $1.78 |
| plan-review | 1 | $0.83 |
| implement (5 phases) | 1 each | $1.03 + $2.23 + $2.06 + $3.27 + $2.05 |
| mutation | 1 | $2.01 |
| review | 3 (first two exited non-zero without writing `review.md`; third, model opus, succeeded) | $1.13 + $0.00 + $1.56 |
| fix-review | 1 | $0.17 |

Total about $18.12, excluding pr-body.
</details>
