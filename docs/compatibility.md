# MeshCore compatibility record

**Gate verdict (S-01, FR-00): `PASSED`** (2026-10-11, pending the reviewer's acceptance at the PR)

The rule is plan D-6. A capture against `HW_REPEATER` had a decoded device info, a complete contact list (350 announced,
350 received) and a decoded status **and** telemetry response, and `pnpm test` decodes every committed fixture
(`packages/meshcore-adapter/test/fixtures.int.test.ts`).

Evidence:
- `packages/meshcore-adapter/fixtures/v1.17.1-d929643/remote.json`: handshake, contacts, guest login, status and
  telemetry to Room K.
- `packages/meshcore-adapter/fixtures/v1.17.1-d929643/handshake.json`: handshake and contacts, no LoRa TX.
- Console summaries: `context/changes/protocol-feasibility-gate/evidence/capture-*.txt`.

Limits of the verdict:
- The target was a **room server** (Room K, role 3), not a repeater (role 2). The status struct shared by both is
  verified. Repeater-only behaviour is not.
- The data comes from one companion, one firmware build and one remote node, with the laptop (BlueZ) as the BLE central.
  Android is S-02.

`verified` means the capture showed it. `not verified` means it comes from firmware or library source, or it was not
exercised.

## Companion and protocol

| Item | Observed | Status | Source |
|------|----------|--------|--------|
| Companion model | `Heltec V3` (device-info manufacturer string) | verified | both fixtures, frame 1 |
| Firmware version and build | `v1.17.1-d929643`, built `14-Aug-2026` | verified | both fixtures, frame 1 |
| Protocol version code | device info `firmwareVerCode` = 13; app sent `deviceQuery` with protocol 3 | verified | frame 0 (`1603`), frame 1 |
| Device-info layout (firmware 1.17) | max contacts 350 (byte 2 × 2), max channels 40, BLE PIN at bytes 4–7 (redacted), build date, manufacturer, firmware version, `repeat` = 0, `path_hash_mode` = 2. meshcore.js 1.15.0 reads this layout wrongly (D-1), so the adapter re-reads it | verified (layout decodes to the expected strings); the PIN position comes from firmware source and is zeroed before writing | frame 1 |
| Self info | type 1 (chat), TX power 22/22 dBm, radio 869618 / 62500 / SF 8 / CR 5 (raw, units `UNVERIFIED`), position and name redacted (D-4, D-13) | verified | frame 3 |

## BLE

| Item | Observed | Status | Source |
|------|----------|--------|--------|
| Service | Nordic UART `6e400001-b5a3-f393-e0a9-e50e24dcca9e` | verified | capture connected through it |
| RX (app → companion, write with response) | `6e400002-b5a3-f393-e0a9-e50e24dcca9e` | verified | every tx frame was answered |
| TX (companion → app, notify) | `6e400003-b5a3-f393-e0a9-e50e24dcca9e` | verified | all rx frames |
| Framing | One companion frame per write and per notification, no length prefix. 730 rx frames over both runs decoded with 0 errors, and each contact frame arrived whole at 148 bytes | verified (laptop, BlueZ MTU) | both fixtures |
| Fragmentation | None seen. The longest frame was 148 bytes (contact and new-advert push). Android MTU negotiation can differ: S-02 | verified for the laptop; not verified for Android | both fixtures |
| Bonding | The companion needs a PIN bond. It was made once with `bluetoothctl`, and node-ble reused it | verified | roadmap S-01, capture runs |
| Reconnect after a run | Right after the first run the companion stopped advertising for about 4–5 minutes. Two connect attempts timed out at 20 s, and a later attempt connected. Cause unknown | observed once; not verified as a pattern | `evidence/capture-remote-connect-failures.txt` |

## Contacts

| Item | Observed | Status | Source |
|------|----------|--------|--------|
| Contact sync | `contactsStart` count 350 → 350 contact frames → `endOfContacts`. It took 21.7–26.9 s over BLE, and adverts and RX-log pushes can arrive in between | verified | both fixtures |
| Roles seen | 306 repeaters (2), 14 room servers (3), 30 chat (1) | verified | both fixtures |
| Contact table full | max contacts is 350 and the table is full. A 1-byte push `0x90` arrived right after a new-advert push. Firmware source names `0x90` `CONTACTS_FULL`. meshcore.js does not handle it and logs `unhandled frame` | `0x90` seen: verified; its meaning: not verified | `remote.json` frames 213–214 |
| Path-length byte | Read unsigned: bits 6–7 = hash size − 1, bits 0–5 = hops. Seen: `0xff` ×347 (no known path, flood), `0x85` ×2 (hash size 3, 5 hops), `0x80` ×1 (Room K: hash size 3, 0 hops). Hash size 3 matches device info `path_hash_mode` = 2. Room K's 0-hop direct path matches the direct (`flood` = false) replies with `lastRssi` −34 | partially verified: `0x80` is consistent with direct delivery; the meaning of `0x85` and `0xff` comes from firmware source | both fixtures; `remote.json` frames 363, 371 |
| meshcore.js `outPathLen` | Read as int8 (−1, −123, −128). The adapter corrects it (D-1) | verified | decoder tests and fixtures |

## Remote requests (target Room K `7c73a8cd01d92e24`, room server, direct path)

| Item | Observed | Status | Source |
|------|----------|--------|--------|
| `RESP_CODE_SENT` | `[0x06, flood, tag u32, est_timeout u32]` after every request. `flood` = 0 for all three | verified | `remote.json` frames 363, 369, 376 |
| `estTimeout` returned | login 3678 ms, status 2694 ms, telemetry 2694 ms | verified | `remote.json` summary |
| Latency (request write → push) | login 2875 ms, status 1324 ms, telemetry 1088 ms. Every reply came within its `estTimeout` | verified (one sample each, direct path) | `remote.json` summary |
| Correlation | Pushes carry the 6-byte key prefix `7c73a8cd01d9`. The status and telemetry pushes have no tag, and the login-success tag does not equal the SENT tag. Correlation is by key prefix, with one request in flight per companion | verified | `remote.json` frames 363–378 |
| Guest login (empty password) | Accepted. `0x85` login success in the new format: prefix, permissions 1, tag, ACL permissions 3, firmware level 1. The login frame carried no password bytes | verified | `remote.json` frames 362, 365 |
| Login failure push (`0x86`) | Not seen. The decoder follows firmware source (prefix only) | not verified | decoder tests only |
| Status (`0x87`) | Repeater stats struct: battery 3353 mV, TX queue 0, noise floor −117, last RSSI −34, received/sent 458/159, air time 108 s, uptime 2837 s, flood/direct sent 157/2, flood/direct received 446/7, errors 0, `lastSnrX4` 53 (raw), direct/flood dups 0/283, then 12 extra bytes (all zero) from the room server, kept as `extraHex` | verified for a room server; repeater not verified; extra room fields' meaning not verified | `remote.json` frame 371 |
| Telemetry (`0x8b`) | CayenneLPP: channel 1 type 116 (voltage) 3.35, channel 1 type 103 (temperature) 30. Raw `lppHex` is kept (D-11) | verified | `remote.json` frame 378 |
| Status without login | Not exercised: the login succeeded, so the D-15 path where a guest has no session did not occur | not verified | — |

## Other companion pushes seen

| Code | Meaning (firmware source) | Handling |
|------|---------------------------|----------|
| `0x80` | advert (33 bytes: code + public key) | decoded as `other` |
| `0x88` | RX log: SNR, RSSI and the raw over-the-air packet. It came 2 times in the handshake run and 10 times in the remote run | decoded as `other`; fixtures keep only code, SNR and RSSI (D-20) |
| `0x8a` | new advert (contact layout; it was a repeater here) | decoded as `other`; chat adverts are redacted (D-4) |
| `0x90` | contacts full (see above) | decoded as `other` |

## Laptop toolchain used for the capture

| Item | Value |
|------|-------|
| OS / kernel | Linux 7.0.0-29-generic |
| BlueZ (`bluetoothctl`) | 5.72 |
| node-ble | 1.13.0 |
| @liamcottle/meshcore.js | 1.15.0 |
| Node | 24.21.0 |

## Android phone

Filled from the S-02 human checks (CI APK on a real phone). Everything here is `not verified` until then. The emulator
run (fake transport) proved meshcore.js encoding and adapter decoding under Hermes only, not BLE.

| Item | Observed | Status |
|------|----------|--------|
| Phone model / Android version | | not verified |
| Pairing/PIN dialog (at which step it appears) | | not verified |
| Negotiated MTU (Connect screen, Technical details) | | not verified |
| Scan finds the companion by service UUID or by name | | not verified |
| Handshake under Hermes on the phone | | not verified |

Capability minimums (plan D-5, firmware ver code): contacts 1, login 1, status 1, trace 1, telemetry 5. All
`not verified` except contacts, login, status and telemetry at ver code 13 (S-01). Trace was not exercised.
