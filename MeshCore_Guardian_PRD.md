# MeshCore Guardian — Product Requirements Document

**Version:** 1.0 (MVP draft)  
**Date:** 2026-10-10  
**Status:** Ready for technical discovery; protocol integration unverified  
**Platform:** Android  
**Owner:** Product / solo developer

## 1. Product summary
MeshCore Guardian is an offline-first Android application for operators of MeshCore repeaters and room servers. It connects over Bluetooth Low Energy (BLE) to a local MeshCore companion device and provides a clear, evidence-based view of remote node reachability, available telemetry, diagnostic results, and historical trends. The application does not require an account or cloud service for MVP.

**Core promise:** “Check whether my repeater responds, see what data is available, and understand what to test next.”

**Critical caveat:** A missing reply does not prove a repeater is offline. The product must distinguish device failure from unknown reachability due to routing, radio congestion, or companion/BLE failure.

## 2. Problem and target user
Operators often install repeaters on rooftops, in remote locations, or on solar power. They need to answer whether a node responds, whether battery voltage is trending down, and whether a route to the node works, without repeatedly using technical consoles or manually recording results.

**Primary persona:** MeshCore hobbyist operating 1–5 repeaters with an Android phone and BLE companion.  
**Secondary persona:** Community mesh operator managing several remote nodes.  
**Not targeted in MVP:** Enterprise fleet administration, unattended 24/7 monitoring, emergency-grade reliability, and generic Meshtastic support.

## 3. Goals and success metrics
### Product goals
1. Connect reliably to a supported companion via BLE.
2. Discover supported contacts/repeaters and select one for diagnostics.
3. Run an explicit user-initiated remote check and show outcome with uncertainty.
4. Save measurements and show historical trends where telemetry is supported.
5. Export a redacted diagnostic report for troubleshooting.

### Pilot success criteria (targets, not forecasts)
- At least 8 of 10 pilot users can connect a supported companion without developer assistance.
- At least 8 of 10 can complete a diagnostic run against a reachable supported repeater.
- Zero cases in acceptance tests where a single timeout is presented as definitive proof that a repeater is powered off.
- Diagnostic results remain readable without an internet connection.
- No account, backend, or subscription required for pilot.

## 4. MVP scope
### P0 — Required
- Android BLE permission flow, scanning, pairing/connecting where required, reconnect and disconnect state.
- Companion compatibility detection; unsupported firmware/capabilities are explained.
- Import/list MeshCore contacts; identify known repeater or room-server roles when protocol exposes them; allow manual label.
- Manual remote telemetry/status request through companion when supported.
- Reachability result: Responded / No response / Unsupported / Transport error / Not tested.
- Record request duration, timestamp, companion identity, and available response metadata.
- Local SQLite persistence and device detail/history screens.
- Rule-based diagnostic explanation and next-step recommendations.
- Explicit timeouts, retry limits and rate limiting to avoid radio spam.
- JSON/CSV export with secrets and sensitive identifiers excluded by default.

### P1 — Nice to have after P0
- Optional route/trace request when firmware supports it.
- Configurable battery-voltage warning per battery chemistry/profile.
- Multi-attempt manual test and historical success ratio with sample-size disclosure.
- Local reminders to run a manual check (not remote outage notifications).

### Out of scope
- Background 24/7 monitoring, cloud push notifications, payment integration, remote configuration writes, remote firmware flashing, AI diagnosis, map/wardriving, iOS, and guaranteed delivery.

## 5. User journeys
### UJ-01 First connection
1. Open app; read short explanation of local BLE access.
2. Grant required Android permissions.
3. Scan and select a companion; connect.
4. App validates handshake and displays supported capabilities.
5. On failure, show actionable message and retry option.

### UJ-02 Diagnose a repeater
1. Choose a contact identified as repeater (or manually select a contact).
2. Tap “Run diagnostic.”
3. App checks companion connection, sends supported request, waits within configured timeout, and records result.
4. Display: result, timestamp, duration, data source, uncertainty, and recommended next step.
5. Save result locally.

### UJ-03 Review battery history
1. Open node details.
2. View voltage samples and timestamps if the remote firmware exposes voltage.
3. Display “Insufficient data” rather than predicting battery life from voltage alone.

### UJ-04 Export troubleshooting report
1. Select a node and date range.
2. Preview included fields and redactions.
3. Share JSON or CSV via Android share sheet.

## 6. Functional requirements and acceptance criteria
| ID | Requirement | Acceptance criterion |
|---|---|---|
| FR-01 | BLE discovery and connect | Supported companion can be found and connection state is visible. |
| FR-02 | BLE resilience | Disconnection is shown; user can reconnect without restarting app. |
| FR-03 | Capability detection | Unsupported requests are disabled or clearly labelled. |
| FR-04 | Contacts | Available contacts are listed; manual labels persist. |
| FR-05 | Manual diagnostics | A single tap initiates a bounded request with visible progress/cancel. |
| FR-06 | Honest status | Timeout yields “No response / cause unknown,” never “Device offline.” |
| FR-07 | Telemetry | Supported values retain units, timestamps, and source; missing values show N/A. |
| FR-08 | History | Measurements and outcomes survive app restart. |
| FR-09 | Reports | Export excludes secrets and offers public-key redaction. |
| FR-10 | Radio hygiene | Concurrency and retries are bounded; no background polling in MVP. |

## 7. UX and screens
1. **Onboarding/Connect:** permissions, device scan, connection state, compatibility.
2. **Dashboard:** known nodes, last tested time, last result (not real-time online/offline), “Run check.”
3. **Node details:** name, role, last response, telemetry with units, voltage chart, recent runs.
4. **Diagnostic result:** checks performed, outcome, evidence, limitations, suggested next actions.
5. **Settings:** timeout, limited retry policy, data retention, export/privacy, app/firmware info.

**Status language:** “Responded 2 min ago,” “No reply in last test,” “Not tested,” “Unsupported telemetry.” Never display a persistent green “Online” indicator based solely on an old successful response.

## 8. Technical architecture
**Mobile:** React Native + TypeScript, Expo development build (not Expo Go for native BLE), react-native-ble-plx, SQLite, Zustand, Zod, Vitest.  
**Layers:** UI → application/use-cases → domain diagnostics → MeshCore client abstraction → BLE transport; persistence via repository interfaces.

**Packages:** `apps/mobile`, `packages/domain`, `packages/meshcore-adapter`, `packages/storage`.

**Interfaces (conceptual, not guaranteed library APIs):**
```ts
interface MeshTransport {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  write(data: Uint8Array): Promise<void>;
  onData(cb: (chunk: Uint8Array) => void): () => void;
}
interface MeshClient {
  getContacts(): Promise<MeshContact[]>;
  getCapabilities(): Promise<MeshCapabilities>;
  requestTelemetry(key: string, signal?: AbortSignal): Promise<TelemetryResponse>;
}
```

**Protocol discovery gate:** Validate current `meshcore.js` source, firmware protocol, BLE service/characteristic UUIDs, framing, fragmentation, response correlation, supported remote telemetry, and Android BLE behavior on real Heltec hardware. Do not assume browser Web Bluetooth transport works unchanged in React Native. Implement a native BLE transport adapter and reuse only protocol components compatible with React Native.

## 9. Data model
- `devices`: id, public_key, label, role, created_at, last_tested_at.
- `diagnostic_runs`: id, device_id, started_at, finished_at, result_code, reason_code, raw_summary_json.
- `telemetry_samples`: id, device_id, measured_at, voltage_v nullable, uptime_s nullable, rssi_dbm nullable, snr_db nullable, source, diagnostic_run_id.
- `app_settings`: key, value.

All measurements must include units and provenance. RSSI/SNR is tied to a specific packet/hop if known and must not be misrepresented as end-to-end quality.

## 10. Diagnostic engine
**Deterministic rules, not AI:**
- BLE disconnected → `TRANSPORT_UNAVAILABLE`; advise reconnecting companion.
- Companion connected, remote command unsupported → `UNSUPPORTED`; explain firmware/capability limitation.
- Remote response received → `RESPONDED`; show available evidence.
- Timeout after bounded attempts → `NO_RESPONSE`; possible route/radio/device causes, no definitive outage claim.
- Voltage sample available → show numeric value; warning only with user-configured thresholds and explicit battery profile.
- Too few samples → “Not enough data to determine trend.”

Each result stores confidence/limitations, timestamps, and machine-readable reason codes.

## 11. Non-functional requirements
- **Offline-first:** no internet required for core workflows.
- **Privacy:** no account; local data only; no secrets in analytics or exports.
- **Security:** any credentials required by future remote admin stored via Android Keystore-backed secure storage, never plain SQLite.
- **Resilience:** bounded timeouts and retries; clean disconnect handling; no duplicate in-flight remote requests per companion.
- **Accessibility:** readable contrast, labels, no color-only status.
- **Performance:** usable on mid-range Android; list/history virtualization; avoid BLE polling while app is backgrounded in MVP.
- **Radio fairness:** no automated frequent checks; explicit warning that tests consume shared LoRa airtime.

## 12. Dependencies and risks
| Risk | Impact | Mitigation |
|---|---|---|
| React Native BLE transport incompatible with existing JS library | High | Week-1 proof of concept; isolate transport. |
| Remote telemetry varies by firmware | High | Capability detection and partial results. |
| Timeout misdiagnosed as device failure | High | Uncertainty-first language and error taxonomy. |
| MeshCore firmware/API changes | Medium | Adapter, fixtures, compatibility matrix. |
| Insufficient battery samples | Medium | No unsupported battery-life predictions. |
| Small niche / weak willingness to pay | High | Pilot and pricing interviews before monetization. |

## 13. Delivery milestones and gates
**Week 1 — Technical feasibility:** BLE connect, protocol handshake, contacts and one successful remote telemetry response on real hardware. **Go/no-go gate.**

**Week 2 — Adapter:** protocol integration, error classification, bounded commands, fixture tests.

**Week 3 — Domain and storage:** models, SQLite migrations, diagnostic rules, history.

**Week 4 — UI:** connect, dashboard, node details, diagnostic results, charts.

**Week 5 — Reliability:** reconnect, timeouts, permission denial, compatibility matrix, exports, test coverage.

**Week 6 — Closed pilot:** Android AAB, privacy documentation, user testing, prioritized fixes.

Estimate is indicative, contingent on Week-1 hardware feasibility.

## 14. Definition of done
- Core flows tested on at least one Android phone, one companion, and one remote repeater.
- Successful real remote response is decoded and displayed correctly.
- Timeout, disconnection, unsupported command, and malformed response are handled distinctly.
- History persists after restart and exports with privacy defaults.
- No cloud dependency or payment requirement.
- Pilot testers can finish the primary journey without developer intervention.

## 15. Business validation
**Hypothesis:** Operators will pay for understandable diagnostics and historical visibility, not merely raw metrics.  
**Initial model to test:** free single-node basic checks; one-time Pro upgrade for multiple nodes, history, exports, advanced diagnosis. No billing in technical MVP.  
**Validation:** interview 15 operators; recruit 5–10 pilot testers; measure repeated use and ask for concrete purchase intent at proposed price. Avoid claiming willingness to pay before validation.

## 16. Open questions
1. Which MeshCore firmware versions and boards are supported initially?
2. Which remote telemetry commands work through companion LoRa in practice?
3. What exact response correlation/timeout behavior is supported?
4. Are room-server and repeater capabilities distinguishable consistently?
5. What is the minimum Android version and target device matrix?
6. Which protocol license obligations apply when reusing `meshcore.js` code?

## 17. References for implementation discovery
- MeshCore JS repository: https://github.com/meshcore-dev/meshcore.js
- MeshCore firmware repository: https://github.com/meshcore-dev/MeshCore
- React Native BLE PLX: https://github.com/dotintent/react-native-ble-plx

**Note:** This PRD describes a product target. Hardware and API compatibility claims are deliberately marked as discovery tasks until verified on actual devices.
