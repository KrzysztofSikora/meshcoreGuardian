# PRD: MeshCore Guardian

Sources: brief `MeshCore_Guardian_PRD.md` (v1.0, 2026-10-10), `context/shape-notes.md`.
Brief references `B-nn` are defined in the traceability table at the end.

## Problem and goal
Operators of MeshCore repeaters and room servers (rooftops, remote sites, solar power) cannot
easily tell whether a node responds, whether its battery voltage is trending down, or whether a
route to it works, without technical consoles and manual notes.

Goal: an offline Android app that connects to the operator's local MeshCore companion over BLE,
runs an explicit, bounded remote check against a chosen node, and shows an honest result — what
responded, what is unknown, what to test next — with history kept on the phone.

Core promise (brief §1): "Check whether my repeater responds, see what data is available, and
understand what to test next." A missing reply never proves a node is offline.

## Users
- **Primary:** MeshCore hobbyist operating 1–5 repeaters with an Android phone and a BLE companion.
- **Secondary:** community mesh operator managing several remote nodes.
- Not targeted: enterprise fleet admins, unattended 24/7 monitoring, emergency-grade use, Meshtastic users.

## Constraints
- **C-01** Android only, minimum Android 12 (API 31) (D-03).
- **C-02** React Native + TypeScript, Expo development build (not Expo Go), react-native-ble-plx,
  SQLite, Zustand, Zod, Vitest (brief §8, D-01).
- **C-03** Monorepo packages `apps/mobile`, `packages/domain`, `packages/meshcore-adapter`,
  `packages/storage`. Layers: UI → application/use-cases → domain diagnostics → MeshCore client
  abstraction → BLE transport; persistence through repository interfaces (brief §8).
- **C-04** Credentials only in Android Keystore-backed secure storage, never in SQLite (brief §11, D-02).
- **C-05** No account, backend, subscription, payment or internet dependency (brief §3, §11).
- **C-06** Reference hardware: Heltec V3 as companion and as remote repeater (D-04).
- **C-07** Delivery for the pilot: signed AAB on the Google Play internal testing track (D-10).
- **C-08** Protocol discovery gate (brief §8, §13): all protocol behaviour is `UNVERIFIED` until
  confirmed on real hardware; if the gate fails, work stops and is re-planned (D-09).
- **C-09** English UI with all user-visible strings in a message catalog (D-05).

## User stories
- **US-01** As an operator, I grant Bluetooth access and connect to my companion so the app can talk to the mesh. (B-01, UJ-01)
- **US-02** As an operator, I see which capabilities my companion supports and why something is unavailable. (B-02)
- **US-03** As an operator, I see my contacts with their role and can label them. (B-03)
- **US-04** As an operator, I tap "Run diagnostic" on a node and get a bounded, cancellable check. (B-04, UJ-02)
- **US-05** As an operator, I see an honest outcome with evidence, limitations and a recommended next step. (B-05, B-08, B-12)
- **US-06** As an operator, I can open a node and see its telemetry, recent runs and voltage history after restarting the app. (B-07, B-11, B-14, UJ-03)
- **US-07** As an operator, I export a redacted report for a node and date range and share it. (B-10, UJ-04)
- **US-08** As an operator, I trust the app not to spam the shared LoRa channel. (B-09, B-19)
- **US-09** As an operator, I enter an optional guest password for a node and the app logs in before requesting status. (D-02)
- **US-10** As an operator, I set timeouts, retry count, and delete history. (B-13, D-06, D-07, D-12)
- **US-11** As an operator, I get a voltage warning only for nodes where I chose a battery profile. (B-23, D-11) — P1
- **US-12** As an operator, I can run a multi-attempt test and see a success ratio with its sample size. (B-24) — P1
- **US-13** As an operator, I can request a route trace when the firmware supports it. (B-22) — P1
- **US-14** As an operator, I can set a local reminder to run a manual check. (B-25) — P1
- **US-15** As an operator, I open the app and immediately see which repeater is nearest, and can test it without searching the contact list. (B-31)

## Functional requirements

### FR-00 Protocol feasibility gate  (Must, covers B-20, C-08)
- AC1: Given a Heltec V3 companion and a Heltec V3 repeater in range, When the feasibility build connects over BLE, Then it completes the protocol handshake, reads the contact list, and decodes at least one remote status or telemetry response.
- AC2: Given the gate run, When it finishes, Then a compatibility record lists firmware versions, BLE service/characteristic identifiers, framing/fragmentation rules, response correlation, login behaviour and whether a timeout estimate is returned; each item is marked verified or not.
- AC3: Given recorded raw frames from the gate, When the adapter's fixture tests run, Then each recorded response decodes to the same values as on device.

### FR-01 BLE permission, discovery and connection  (Must, covers US-01, B-01)
- AC1: Given Bluetooth permissions are not granted, When the user opens Connect, Then the app explains local BLE access and requests `BLUETOOTH_SCAN` and `BLUETOOTH_CONNECT` only (no location).
- AC2: Given permissions are denied, When the user returns to Connect, Then the screen shows a "Permission required" state with a button to open system settings, and scanning is not started.
- AC3: Given Bluetooth is off, When the user starts a scan, Then the app shows "Bluetooth is off" and does not report "no devices found".
- AC4: Given a supported companion advertises nearby, When the user scans, Then it appears in the list within 10 s and the user can connect to it.
- AC5: Given any connection attempt, When its state changes, Then the UI shows exactly one of: Disconnected, Connecting, Connected, Connection failed (with reason), and offers Retry on failure.

### FR-02 BLE resilience  (Must, covers B-01, B-27)
- AC1: Given a connected companion, When the link drops, Then the state becomes Disconnected within 5 s of the transport reporting it, and any in-flight request ends as `TRANSPORT_UNAVAILABLE`.
- AC2: Given a dropped link, When the user taps Reconnect, Then the app reconnects without restarting.
- AC3: Given the app goes to background, When it is backgrounded, Then no BLE polling or remote request is started.

### FR-03 Capability detection  (Must, covers US-02, B-02)
- AC1: Given a connected companion, When the handshake completes, Then the app shows firmware version and the capabilities it supports (contacts, login, status request, telemetry request, trace).
- AC2: Given a capability is unsupported, When the user views an action that needs it, Then the action is disabled and labelled with the reason ("Not supported by companion firmware x.y").
- AC3: Given the firmware version is outside the compatibility record (FR-00 AC2), When connected, Then the app shows "Untested firmware" and still allows read-only actions.

### FR-04 Contacts  (Must, covers US-03, B-03)
- AC1: Given a connected companion, When contacts are loaded, Then each contact is listed with name, role (repeater, room server, companion/chat, unknown) and last-heard time if the protocol provides it.
- AC2: Given a contact whose role the protocol does not expose, When listed, Then the role is "Unknown" and the user can set it manually.
- AC3: Given the user sets a label or role on a contact, When the app restarts, Then the label and role persist.
- AC4: Given a contact list larger than one screen, When scrolling, Then the list is virtualised.

### FR-05 Manual diagnostic run  (Must, covers US-04, B-04, B-06)
- AC1: Given a selected node and a connected companion, When the user taps "Run diagnostic", Then a run starts, shows progress (current step and attempt n of m) and a Cancel button.
- AC2: Given a node has a stored guest password or none, When the run starts and login is supported, Then the app sends a guest login first; a rejected login ends the run with reason `LOGIN_REJECTED`.
- AC3: Given a run in progress, When the user taps Cancel, Then the request is aborted, no further attempt is sent, and the run is stored with result `NOT_TESTED` and reason `CANCELLED`.
- AC4: Given any finished run, When it is stored, Then it records start and end timestamps, duration in ms, companion identity, node, attempts used, result code, reason code and available response metadata.

### FR-06 Honest result classification  (Must, covers US-05, B-05, B-28)
- AC1: Given no response after the bounded attempts, When the run ends, Then the result is `NO_RESPONSE` and the text reads "No response — cause unknown"; the words "offline", "down" or "dead" never appear.
- AC2: Given the companion is disconnected before or during the run, When it ends, Then the result is `TRANSPORT_UNAVAILABLE` ("Transport error") with advice to reconnect the companion.
- AC3: Given the companion does not support the needed command, When the run is requested, Then the result is `UNSUPPORTED` with the firmware/capability limitation.
- AC4: Given a response that cannot be decoded, When received, Then the result is `UNSUPPORTED` with reason `MALFORMED_RESPONSE` and the raw summary is stored (A-05).
- AC5: Given a decoded response, When received, Then the result is `RESPONDED` with the evidence shown.
- AC6: Given a node never tested, When displayed, Then its status is "Not tested" (`NOT_TESTED`).

### FR-07 Telemetry  (Must, covers B-11)
- AC1: Given a response with telemetry values, When displayed or stored, Then each value carries its unit, measured timestamp and source (which command, which run).
- AC2: Given a value the response does not contain, When displayed, Then it shows "N/A", not 0.
- AC3: Given RSSI or SNR, When displayed, Then it is labelled with the packet/hop it belongs to (e.g. "last hop") and is never presented as end-to-end link quality.

### FR-08 History and persistence  (Must, covers US-06, B-07)
- AC1: Given stored runs and samples, When the app is force-stopped and reopened, Then node details show the same runs and samples.
- AC2: Given a node, When the user opens its details, Then it shows name, role, last response, latest telemetry with units, recent runs (newest first, virtualised) and the voltage chart.
- AC3: Given a schema change in a new app version, When the app starts, Then stored data migrates without loss.

### FR-09 Diagnostic explanation and next steps  (Must, covers US-05, B-08)
- AC1: Given each result and reason code, When a result is shown, Then the explanation and next-step text come from a fixed rule table (one entry per result × reason), never generated.
- AC2: Given a result, When shown, Then it lists checks performed, outcome, evidence, limitations and suggested next actions.
- AC3: Given `NO_RESPONSE`, When shown, Then the possible causes listed include route, radio congestion and device, and none is presented as confirmed.

### FR-10 Radio hygiene  (Must, covers US-08, B-09, B-19)
- AC1: Given a remote request in flight on a companion, When another run is started, Then it is refused with "A check is already running".
- AC2: Given a run against a node finished less than 60 s ago, When the user starts another, Then the button is disabled with a visible cooldown.
- AC3: Given the timeout policy (D-06), When an attempt is sent, Then its timeout is the companion estimate × margin capped at 30 s, or 15 s without an estimate, or the user's Settings override within 5–60 s.
- AC4: Given the retry policy (D-07), When attempts time out, Then at most the configured number (default 2, range 1–3) is sent.
- AC5: Given the first diagnostic of a session, When the user taps Run, Then the app shows that checks use shared LoRa airtime (dismissible, remembered).
- AC6: Given any app state, When idle, Then no remote request is sent without a user tap.

### FR-11 Status language  (Must, covers B-12)
- AC1: Given a node's last run, When shown on the dashboard, Then status is relative and historical ("Responded 2 min ago", "No reply in last test", "Not tested", "Unsupported telemetry").
- AC2: Given any screen, When status is shown, Then there is no persistent "Online" indicator and every status has a text label and icon besides colour.

### FR-12 Battery history  (Must, covers US-06, B-14)
- AC1: Given voltage samples for a node, When details open, Then the chart shows each sample with its timestamp and unit (V).
- AC2: Given fewer than 5 samples or a span under 24 h (A-01), When the trend is requested, Then the app shows "Not enough data to determine trend".
- AC3: Given any amount of data, When shown, Then no battery-life or time-to-empty prediction appears.
- AC4: Given the firmware exposes no voltage, When details open, Then the chart area shows "Voltage not available from this node".

### FR-13 Export  (Must, covers US-07, B-10)
- AC1: Given a node, When the user opens Export, Then they can choose a date range (default last 30 days, A-06) and format JSON or CSV.
- AC2: Given the preview, When shown, Then it lists included fields and redactions before sharing.
- AC3: Given default settings, When exported, Then public keys are reduced to a 4-byte hex prefix; with redaction off, full keys are included.
- AC4: Given any export, When generated, Then no password, credential or secure-storage value is present (verified by searching the output for stored secrets).
- AC5: Given the export file, When the user taps Share, Then the system share sheet opens with the file.

### FR-14 Guest login credentials  (Must, covers US-09, D-02)
- AC1: Given a node, When the user enters a guest password, Then it is stored only in secure storage, keyed by node public key.
- AC2: Given the app database file, When inspected, Then it contains no password.
- AC3: Given the user deletes a node or clears all data, When done, Then its stored password is deleted too.

### FR-15 Settings  (Must, covers US-10, B-13)
- AC1: Given Settings, When opened, Then the user can set timeout override (5–60 s or Auto), attempts (1–3), export redaction default, and see app and companion firmware info.
- AC2: Given Settings, When the user deletes a node's history or clears all data (with confirmation), Then runs, samples and labels are removed (D-12).
- AC3: Given an out-of-range value, When saved, Then it is rejected with the allowed range.

### FR-16 Battery profile warning  (Could, P1, covers US-11, B-23)
- AC1: Given a node with no profile, When voltage is low, Then no warning is shown.
- AC2: Given profile Li-ion 1S, LiFePO4 1S or custom thresholds, When the latest voltage is below the profile's warning level, Then a warning with the threshold and profile name is shown.

### FR-17 Multi-attempt test and success ratio  (Could, P1, covers US-12, B-24)
- AC1: Given a multi-attempt test of N attempts (N ≤ 5, spaced by the cooldown), When finished, Then the ratio is shown as "k of N responded" with N always visible.
- AC2: Given history, When a success ratio is shown, Then it states the sample size and date span.

### FR-18 Route trace  (Could, P1, covers US-13, B-22)
- AC1: Given trace is supported, When the user requests it, Then hops and per-hop SNR are shown; Given unsupported, Then the action is disabled with the reason.

### FR-19 Local reminders  (Could, P1, covers US-14, B-25)
- AC1: Given a reminder set for a node, When due, Then a local notification asks the user to run a check; no check runs automatically.

### FR-21 Nearest node  (Must, covers US-15, B-31)
- AC1: Given synced contacts, When the Dashboard opens, Then a "Nearest node" card above the list names one repeater or room server chosen by the app, with its hop distance, its distance and compass direction from the companion's position, and its role (Repeater or Room server), its last-heard time, and offers Run diagnostic on the card.
- AC2: Given several repeaters and room servers, When the app picks the nearest, Then it ranks by known hop count (direct first, unknown path last), then by distance from the companion (unknown last), then by most recent last-heard; the card links to the next few candidates ("Other nearby").
- AC3: Given a repeater or the companion without an advertised position, When shown, Then the distance reads "Position not advertised" (or "Companion position not set") instead of a number; Given an unknown path, Then the hop line reads "Path unknown".
- AC4: Given the card, When shown, Then the hop count and position are labelled as the companion's last known path and the node's advertised position, never as "in range now" or "online".
- AC5: Given no repeater or room server in the companion's contacts, When the Dashboard opens, Then the card says so and points to Sync contacts.
- AC6: Given the feature, When used, Then it needs no phone location permission and sends no radio request; it uses only data from contact sync and the companion's self info.

### FR-20 Pilot release  (Must, covers B-26)
- AC1: Given a release build, When produced, Then it is a signed AAB uploadable to the Play internal testing track.
- AC2: Given the release, When published, Then a privacy policy describing local-only data is available at a public URL.

## Data model (conceptual)
- **Node** (`devices`): id; public key (hex, unique); label (user text, optional, ≤ 64 chars); role (repeater | room_server | chat | unknown; source: protocol or user); last known path (hop count, or unknown) and advertised position (lat/lon, nullable), both as of the last contact sync; battery profile (none | li_ion_1s | lifepo4_1s | custom + thresholds, P1); created at; last tested at.
- **Diagnostic run**: id; node id; companion identity (public key / name / firmware version); started at; finished at; duration ms; attempts used / allowed; timeout per attempt ms and its source (estimate | default | override); result code (`RESPONDED` | `NO_RESPONSE` | `UNSUPPORTED` | `TRANSPORT_UNAVAILABLE` | `NOT_TESTED`); reason code; limitations (list of codes); raw summary (structured, no secrets).
- **Telemetry sample**: id; node id; run id; measured at; voltage V (nullable); uptime s (nullable); RSSI dBm (nullable) and SNR dB (nullable) with the packet/hop they belong to; other values with unit; source command.
- **Settings**: key → value (timeout override, attempts, redaction default, airtime notice seen).
- **Secret** (secure storage only): node public key → guest password.
- All timestamps are UTC instants; displayed in local time. All measurements carry unit and provenance.

## External integrations

### MeshCore companion over BLE  (`UNVERIFIED` — everything here is confirmed by FR-00)
- **Transport:** BLE GATT serial-style service with one write and one notify characteristic. UUIDs, MTU negotiation, framing and fragmentation: `UNVERIFIED`.
- **Requests used:** app start / device query (identity, firmware version, capabilities); get contacts; guest login to a remote node; remote status request; remote telemetry request; optional trace (P1).
- **Response fields used:** companion identity and firmware version; contact public key, name, type/role, last heard; send acknowledgement with suggested timeout (if any); login success/failure; status fields (battery voltage, uptime, radio stats); telemetry values with units.
- **Correlation:** how responses are matched to requests (tag, public-key prefix, or ordering): `UNVERIFIED`. The client allows one in-flight remote request per companion regardless (FR-10 AC1).
- **Errors:** link loss → `TRANSPORT_UNAVAILABLE`; error code or unknown command → `UNSUPPORTED`; no reply within timeout → `NO_RESPONSE`; undecodable frame → `MALFORMED_RESPONSE`.
- **Limits:** shared LoRa airtime; per-node cooldown 60 s; ≤ 3 attempts per run.
- **Reuse:** protocol code from `meshcore.js` only if license-compatible (Q-04) and runnable in React Native; the BLE transport is native.

### Android platform
- Bluetooth runtime permissions (API 31+), Keystore-backed secure storage, system share sheet, local notifications (P1).

### Google Play Console
- Internal testing track; requires developer account and privacy policy URL (D-10).

## Non-functional requirements
- **NFR-01 Offline:** every core flow (connect, diagnose, history, export) works with airplane mode on and Bluetooth on.
- **NFR-02 Privacy:** the app makes no network requests (verified by a test with networking disabled and by a dependency audit); no analytics or crash SDK (A-07); exports follow FR-13.
- **NFR-03 Security:** credentials only in secure storage (FR-14).
- **NFR-04 Resilience:** every remote request has a timeout; disconnects end in-flight work cleanly; no duplicate in-flight request per companion.
- **NFR-05 Accessibility:** text contrast ≥ 4.5:1; all controls have accessibility labels; no colour-only status; layouts hold at 200 % font scale.
- **NFR-06 Performance:** on a mid-range reference phone, dashboard with 200 nodes and history with 1,000 runs scroll at ≥ 55 fps in a profiler trace (list virtualisation); cold start to dashboard ≤ 3 s.
- **NFR-07 Background:** no BLE activity started while the app is backgrounded.
- **NFR-08 Testability:** domain rules and protocol decoding run in unit tests without a device, using recorded fixtures.

## Non-goals
NG-01 … NG-08 from shape notes: background/24/7 monitoring and outage push; cloud, accounts, sync,
analytics; payments and Pro tier; remote configuration writes, admin login, firmware flashing; AI
diagnosis and battery-life prediction; maps, wardriving, iOS, Meshtastic, USB/serial transport;
several companions at once; guaranteed delivery or "online" claims.

## Success criteria
- All Must FRs pass their acceptance criteria; FR-00 passed on real hardware before any later item.
- Definition of done (brief §14): core flows tested on ≥ 1 Android phone, 1 companion, 1 remote repeater; a real remote response decoded and displayed correctly; timeout, disconnect, unsupported command and malformed response handled distinctly; history survives restart; exports use privacy defaults; no cloud or payment dependency.
- Acceptance tests contain zero cases where a single timeout is shown as proof a node is off (brief §3).
- Pilot: ≥ 8 of 10 testers connect without help and ≥ 8 of 10 complete a diagnostic run against a reachable supported repeater (brief §3).

## Traceability
| Brief | Story | FR | Notes |
|-------|-------|----|-------|
| B-01 §4 P0 BLE permission/scan/connect/reconnect; FR-01, FR-02; UJ-01 | US-01 | FR-01, FR-02 | D-03 |
| B-02 §4 P0 compatibility detection; FR-03 | US-02 | FR-03 | |
| B-03 §4 P0 contacts, roles, manual label; FR-04 | US-03 | FR-04 | Q-03 |
| B-04 §4 P0 manual remote request; FR-05; UJ-02 | US-04 | FR-05 | D-02 login |
| B-05 §4 P0 result taxonomy; FR-06; §10 | US-05 | FR-06 | D-13 |
| B-06 §4 P0 record duration, timestamp, companion, metadata | US-04 | FR-05 AC4 | |
| B-07 §4 P0 SQLite persistence, detail/history; FR-08; §9 | US-06 | FR-08 | |
| B-08 §4 P0 rule-based explanation; §10 | US-05 | FR-09 | |
| B-09 §4 P0 timeouts, retries, rate limiting; FR-10; §11 resilience | US-08 | FR-10 | D-06, D-07 |
| B-10 §4 P0 export; FR-09; UJ-04 | US-07 | FR-13 | D-08 |
| B-11 FR-07 telemetry units/timestamps/source; §9 provenance | US-06 | FR-07 | |
| B-12 §7 status language | US-05 | FR-11 | |
| B-13 §7 screens incl. settings | US-10 | FR-01, FR-08, FR-09, FR-15 | |
| B-14 UJ-03 battery history; §10 too few samples | US-06 | FR-12 | A-01 |
| B-15 §11 offline-first; §3 | – | NFR-01 | |
| B-16 §11 privacy, security | US-09 | FR-13, FR-14, NFR-02, NFR-03 | |
| B-17 §11 accessibility | – | FR-11 AC2, NFR-05 | |
| B-18 §11 performance, no background polling | – | FR-02 AC3, NFR-06, NFR-07 | |
| B-19 §11 radio fairness warning | US-08 | FR-10 AC5, AC6 | |
| B-20 §8 protocol discovery gate; §13 week 1 | – | FR-00 | D-09 |
| B-21 §8 architecture, packages | – | C-02, C-03 | |
| B-22 §4 P1 route/trace | US-13 | FR-18 | |
| B-23 §4 P1 battery warning per profile; §10 | US-11 | FR-16 | D-11 |
| B-24 §4 P1 multi-attempt, success ratio | US-12 | FR-17 | |
| B-25 §4 P1 local reminders | US-14 | FR-19 | |
| B-26 §13 week 6 AAB, privacy docs, pilot | – | FR-20 | D-10 |
| B-27 §14 definition of done | – | Success criteria | |
| B-28 §14 malformed response distinct | US-05 | FR-06 AC4 | A-05 |
| B-29 §3 pilot success criteria | – | Success criteria | measured in pilot, not in CI |
| B-30 §15 business validation | – | – | outside the app (NG-03) |
| B-31 user request 2026-10-12: see the nearest repeater without searching | US-15 | FR-21 | not a map (NG maps) |

## Open questions
- Q-01 Firmware versions and protocol revision to support — pinned by FR-00.
- Q-02 Which remote commands work through companion LoRa; whether a timeout estimate is returned — FR-00; D-06 has a fallback.
- Q-03 Whether repeater and room-server roles are consistently exposed — FR-04 AC2 covers the gap.
- Q-04 `meshcore.js` license obligations — checked in `/tech-stack`.
- Q-05 Test device matrix beyond the reference phone — `/test-plan`.
