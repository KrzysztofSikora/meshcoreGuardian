# Shape notes: MeshCore Guardian

Brief: `MeshCore_Guardian_PRD.md` (v1.0, 2026-10-10).

## Brief summary
An offline-first Android app for hobbyist and community operators of MeshCore repeaters and room
servers. It connects over BLE to a local MeshCore companion, lists contacts, and on an explicit tap
runs a bounded remote check against one node. The result says honestly what is known (responded,
no response with cause unknown, unsupported, transport error), keeps telemetry with units and
provenance, and stores history locally for trends. Reports export as JSON/CSV with privacy
defaults. No account, no backend, no background monitoring; protocol behaviour is unverified until
a week-1 hardware gate passes.

## Decisions
| ID | Topic | Decision | Reason | Source (brief / user / default) |
|----|-------|----------|--------|---------------------------------|
| D-01 | Platform and stack | Android only; React Native + TypeScript, Expo dev build, react-native-ble-plx, SQLite, Zustand, Zod, Vitest; packages `apps/mobile`, `packages/domain`, `packages/meshcore-adapter`, `packages/storage` | Mandated by brief §8 | brief |
| D-02 | Remote access to repeaters | MVP supports **guest login** to a repeater/room server before a status/telemetry request. Optional per-node password stored only in Keystore-backed secure storage, never SQLite, never exported. Admin login and any remote writes stay out of scope. | Status/telemetry in MeshCore usually requires a login; without it most nodes would only ever show "Unsupported" | user |
| D-03 | Minimum Android | Android 12+ (API 31). One permission path: `BLUETOOTH_SCAN` (neverForLocation) + `BLUETOOTH_CONNECT`; no location permission. | Single permission flow, smaller test matrix | user |
| D-04 | Reference hardware | Heltec V3 running current MeshCore companion (BLE) firmware as the companion; Heltec V3 repeater as the remote. Exact firmware versions are fixed at the week-1 gate and recorded in a compatibility matrix. | Matches brief §8; versions can only be pinned on hardware | user (versions: deferred Q-01) |
| D-05 | UI language | English; all strings in a message catalog from day one (i18n-ready, Polish later). | International community; adding a locale later stays cheap | user |
| D-06 | Timeout | Per-attempt timeout = companion-provided estimate × safety margin when the protocol returns one, capped at 30 s; 15 s default when no estimate. Settings may override within 5–60 s. | Flood vs direct routes have very different RTT; fixed timeouts inflate NO_RESPONSE | user |
| D-07 | Retry and rate limits | Max 2 attempts per diagnostic run (Settings: 1–3); at most one in-flight remote request per companion; at least 60 s between runs against the same node (UI shows a cooldown). No automatic or background runs. | Brief FR-10, radio fairness | user |
| D-08 | Export privacy | Passwords and any credentials never exported. Public keys redacted to a 4-byte hex prefix by default; user can disable redaction in the export preview. Labels included. | Brief FR-09 "excluded by default" | user |
| D-09 | Week-1 gate outcome | If the gate fails, stop and re-plan. Later roadmap items depend on the gate item and are not started until it passes. No fallback transport in scope. | Avoids building on an unproven protocol path | user |
| D-10 | Pilot distribution | Signed AAB via Google Play internal testing track; requires a Play Console account and a published privacy policy. | Brief week 6 "Android AAB"; auto-updates for testers | user |
| D-11 | Battery profiles (P1) | Built-in profiles Li-ion 1S and LiFePO4 1S, plus "custom" with user thresholds. No voltage warning until the user picks a profile for the node. | Brief §10: warning only with explicit profile | user |
| D-12 | Data retention | Keep history indefinitely; user can delete a node's history or clear all data in Settings. No automatic cleanup. | Manual checks only, so data volume is small | user |
| D-13 | Result taxonomy | Result codes exactly `RESPONDED`, `NO_RESPONSE`, `UNSUPPORTED`, `TRANSPORT_UNAVAILABLE` (shown as "Transport error"), `NOT_TESTED`, each with machine-readable reason codes and limitations. | Brief §4, §10 | brief |

## Assumptions
- A-01 Trend threshold: a voltage trend is shown only with ≥ 5 samples spanning ≥ 24 h; otherwise "Not enough data to determine trend". Cheap to tune.
- A-02 Room servers get the same diagnostic flow as repeaters (guest login, status request); capability differences are shown via capability detection, not separate screens.
- A-03 "Last tested" status text uses relative time ("Responded 2 min ago") from the stored run timestamp; no status is ever shown as live.
- A-04 The app supports one connected companion at a time; the companion identity (public key / name) is stored with each run.
- A-05 Malformed or undecodable responses are a distinct outcome: `NO_RESPONSE` is not used for them; they map to a reason code under `UNSUPPORTED` or a dedicated `MALFORMED_RESPONSE` reason (brief §14 requires distinct handling).
- A-06 Export date range defaults to the last 30 days for the selected node.
- A-07 No analytics or crash-reporting SDK in the MVP (offline-first, privacy); pilot feedback is collected manually.
- A-08 Dark and light themes follow the system setting; status never relies on colour alone.

## Non-goals
- NG-01 Background or 24/7 monitoring, scheduled checks, push notifications of outages.
- NG-02 Cloud backend, accounts, sync, analytics.
- NG-03 Payments, Pro upgrade, licensing (business validation runs outside the app).
- NG-04 Remote configuration writes, admin login, firmware flashing.
- NG-05 AI-based diagnosis; battery-life prediction from voltage.
- NG-06 Maps, wardriving, iOS, Meshtastic, USB/serial transport.
- NG-07 Multiple simultaneously connected companions.
- NG-08 Guaranteed delivery or "online" status claims.

## Deferred questions
- Q-01 Exact MeshCore firmware versions and protocol revision to support (brief Q1). Pinned at the week-1 gate; the PRD marks protocol details `UNVERIFIED`.
- Q-02 Which remote commands (status vs telemetry) work through companion LoRa in practice, and whether a timeout estimate is returned (brief Q2, Q3). Settled by the gate; D-06 has a fallback.
- Q-03 Whether repeater and room-server roles are consistently distinguishable (brief Q4). A manual role label covers the gap (FR-04).
- Q-04 License obligations when reusing `meshcore.js` code (brief Q6). Checked in `/tech-stack` before any code is copied; isolation in `packages/meshcore-adapter` keeps it replaceable.
- Q-05 Test device matrix beyond the reference phone (brief Q5 part 2). Decided in `/test-plan`.

## Risks spotted
- R-01 React Native BLE transport incompatible with `meshcore.js` assumptions (Web Bluetooth/Node) — high likelihood / high impact. Found out in week 1 PoC (D-09).
- R-02 Guest login semantics or password handling differ across firmware versions — medium / high. Covered by the gate and capability detection.
- R-03 BLE MTU and fragmentation on Android differ by phone vendor — medium / medium. Test on at least two phones in week 5.
- R-04 False "No response" from too-short timeouts on flood routes — medium / high (brief's main honesty risk). D-06 estimate-based timeout plus uncertainty wording.
- R-05 Play Console account and privacy policy not ready in week 6 — low / medium. Start the account in week 4.
- R-06 Week-1 gate needs two physical Heltec devices (companion + repeater) in range — availability risk. Confirm hardware before starting S-01.
