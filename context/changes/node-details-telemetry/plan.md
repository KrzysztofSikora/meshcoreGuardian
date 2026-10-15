# Plan: node-details-telemetry (S-06)

GitHub issue: #7.

## Goal and end state
- Every responded status or telemetry check of a diagnostic run is stored as a **telemetry sample**
  (one row, typed nullable columns plus `extra_json`), in the same transaction as the run. Each
  stored and displayed value carries its unit, the time it was measured and its source: the
  command (status / telemetry request) and the run (FR-07 AC1).
- The node details screen shows name, role, **last response**, **latest telemetry** with units
  ("N/A" for a value the response did not contain, never 0: FR-07 AC2), RSSI and SNR labelled as
  the node's last hop and never as end-to-end link quality (FR-07 AC3), and the **recent runs**
  of the node, newest first, in a virtualised list whose rows open the run screen (FR-08 AC2,
  without the voltage chart: see D-8).
- After a force-stop and reopen, the node screen shows the same runs and samples (FR-08 AC1).
- Schema v4 adds the samples table; a database at any earlier version migrates without losing
  rows, and runs stored before v4 get their samples from their stored evidence (FR-08 AC3,
  roadmap acceptance "migration test from schema v1 to current").

## Scope
- In:
  - domain: telemetry sample types, the mapping from check evidence to samples, a CayenneLPP
    type → name/unit table, ports for reading samples and node history;
  - storage: migration `0004_telemetry.sql`, sample writes in `SqliteDiagnosticRunRepository.save`,
    `SqliteTelemetryRepository`, recent-runs and last-response queries, the backfill of samples
    for runs stored before v4;
  - app: `NodeHistoryController`, a pure telemetry/history presenter, the node screen rebuilt
    on a `FlatList`, i18n strings, the extended e2e flow, test-plan rows.
- Out:
  - the voltage chart and trend text (S-07, FR-12) → D-8, `[REVIEW]` deviation;
  - export (S-08), deleting history (S-09);
  - showing path or position on the node screen (nearest-repeater `[FOLLOW-UP]`, not this
    item's ACs) → stays a follow-up;
  - paging the recent-runs list beyond the newest 50 (D-9);
  - any new radio request: samples come only from the checks S-04 already sends.

## Findings
- Schema today is v3: `packages/storage/migrations/0001_init.sql` (devices),
  `0002_diagnostics.sql` (`diagnostic_runs`, `diagnostic_checks` with `evidence_json`),
  `0003_nearest.sql`. Migrations are numbered `.sql` files compiled into
  `src/migrations/generated.ts` by `scripts/gen-migrations.mjs` (checked by
  `test/migrations-generated.test.ts`); `migrateToLatest` runs each in its own transaction
  (`packages/storage/src/migrate.ts:15`).
- `openGuardianDb` turns on foreign keys and migrates (`apps/mobile/src/platform/sqlite/open-guardian-db.ts:9`);
  `openTestDb({ migrate: n })` stops at version n (`packages/storage/test/helpers/open-test-db.ts:22`).
  Existing migration tests: `packages/storage/test/migrate.int.test.ts` (v1→latest, v2→3).
- The run repository saves run + checks in one transaction and validates `evidence_json` with Zod
  on read (`packages/storage/src/diagnostics/run-repository.ts:20-64,161`). Only the SQLite
  implementation of `DiagnosticRunRepository` exists; tests use it on `node:sqlite`
  (`apps/mobile/src/application/diagnostics/run-controller.int.test.ts`), so new port methods need
  no fake.
- Evidence shapes (`packages/domain/src/diagnostics/check.ts:10-50`): status carries
  `battMilliVolts`, `totalUpTimeSecs`, `lastRssi`, `lastSnrX4`, `noiseFloor` and counters;
  telemetry carries CayenneLPP `values[]` (`channel`, `type`, `value` number or GPS object) and
  `lppHex`.
- A check's `startedAt` is taken before the first write and `durationMs` when the check
  resolves (`packages/meshcore-adapter/src/client/mesh-client.ts:251,271`), so
  `startedAt + durationMs` is the time the reply reached the app.
- Real traffic (`docs/compatibility.md`, Room K, fw 1.17.1): status battery 3353 mV, uptime
  2837 s, last RSSI −34, `lastSnrX4` 53; telemetry channel 1 type 116 (voltage) 3.35 and channel
  1 type 103 (temperature) 30. Room K's clock is unset (`lastAdvert` 2024-05-22), so node-side
  times cannot be trusted. The fake build replays these frames (scenario `diag-ok`).
- meshcore.js 1.15 `CayenneLpp.parse` (`node_modules/@liamcottle/meshcore.js/src/cayenne_lpp.js:5-31,49-170`)
  returns already-scaled values for types 100 (generic), 101 (lux), 102 (presence), 103 (°C),
  104 (% RH), 115 (hPa), 116 (V), 117 (A), 120 (%), 125 (ppm), 128 (W), 136 (GPS: degrees and
  m) and stops at any other type; the raw `lppHex` is kept in evidence (protocol-feasibility-gate D-11).
- In MeshCore firmware, LPP channel 1 is the node's own telemetry (battery voltage); sensors use
  other channels. Status `last_rssi`/`last_snr` are the radio's values for the last packet the
  node received, which is normally our request on its last hop, but this is `UNVERIFIED`.
- The node screen (`apps/mobile/src/app/node/[id].tsx:47-63`) is a `Screen scroll` (a
  `ScrollView`, `apps/mobile/src/components/ui/screen.tsx:47`) with identity lines, the
  diagnostic panel, label/role/pin cards and the guest-password card, followed by the
  placeholder "Node details will appear here." A `FlatList` inside that `ScrollView` would not
  virtualise.
- The run screen already renders status/telemetry evidence lines, including
  "Signal of last hop (RSSI)" (`apps/mobile/src/i18n/en.json:234`); `diag-responded.yaml`
  asserts "Battery: 3.35 V" there.
- e2e flows that interact with cards below the diagnostic panel use `scrollUntilVisible`
  (`contacts-label-restart`, `guest-password`, `guest-password-admin`, `contacts-sync`): the
  lesson on added height applies to them.
- Suite size: 20 flows (test-plan Cookbook, item 6), already above the ~15 guideline.

## Decisions
| ID | Question | Chosen | Alternatives (and what they would buy) | Why | Reversal | Decided by |
|----|----------|--------|----------------------------------------|-----|----------|------------|
| D-1 | What is one sample? | One row per **responded** status or telemetry check of a run; `source` = `status` \| `telemetry`; unique on `(run_id, check_seq)`. A responded telemetry check with no values is still a sample (all fields null) | B: one merged row per run (status + telemetry). Fewer rows, but the data model has one `source command` per sample and the two replies arrive at different times. C: one row per value (EAV). Flexible, but contradicts the roadmap's typed columns | Matches the data model ("source command"), keeps provenance exact, and S-07 can filter voltage by source | costly (persisted shape) | agent |
| D-2 | Where are samples written? | `SqliteDiagnosticRunRepository.save` inserts them in the run's transaction, from the domain function `samplesFromChecks(checks)` | B: `RunController` calls a separate telemetry repository after save. Separate concerns, but run and samples could diverge on a failed second write. C: derive samples at read time from `evidence_json`, no table. Zero migration, but contradicts *Decided up front* | Atomic, one mapping in domain, no change to the controller | cheap | agent |
| D-3 | Runs stored before v4 | `backfillTelemetrySamples(driver)` in `packages/storage`: idempotent, inserts the samples of every responded status/telemetry check that has none, using the same `samplesFromChecks`. `openGuardianDb` calls it after `migrateToLatest` | B: SQL backfill inside `0004` with `json_extract`/`json_each`. Runs once, but a second, SQL copy of the mapping that can drift. C: no backfill. Simplest, but existing runs on pilot phones would show no telemetry until the next run | One mapping; idempotent, so a crash mid-way is repaired at next start; cost is one `NOT EXISTS` query per app start | costly (writes derived data) | agent |
| D-4 | Measured-at time | `check.startedAt + check.durationMs` (reply reached the app), falling back to `run.finishedAt` when the check has no timing | B: `run.finishedAt` for all samples. Simpler, but loses the status/telemetry gap. C: node clock (LPP unixtime). Room K's clock is unset | Only the phone's clock is trustworthy; the reply time is when the value was observed | cheap | agent |
| D-5 | Column mapping | Status: `voltage_v` = `battMilliVolts / 1000`, **0 mV → null** (N/A); `uptime_s` = `totalUpTimeSecs`; `rssi_dbm` = `lastRssi`, `snr_db` = `lastSnrX4 / 4`, both scope `last_hop`; extra: noise floor (dBm). Telemetry: the first channel-1 type-116 value → `voltage_v`; every other LPP value → extra `{ name, value, unit, channel }` with units from a table of the 12 types meshcore.js parses; GPS split into latitude (°), longitude (°), altitude (m); a type without a table entry → unit `null` (shown "unit unknown"). Packet counters stay in run evidence only | B: keep 0 mV as 0 V. Literal, but a node that answers over radio is not at 0 V; 0 means "not measured" (UNVERIFIED) and AC2 forbids 0 for a missing value. C: put status counters in extra. More data, but counters are not telemetry and already show on the run screen | Typed columns for the data-model fields, extra for the rest, no guessed units | costly (persisted meaning) | agent |
| D-6 | RSSI/SNR scope and wording (FR-07 AC3) | Status values get scope `last_hop`; any other origin `unknown`. Shown as "RSSI, last hop into the node: −34 dBm" / "SNR, last hop into the node: 13.25 dB" with one note: "Measured by the node on the last packet it received. Not end-to-end link quality." `unknown` shows "packet unknown" | B: scope `unknown` for everything until verified on hardware. Safest, but the roadmap names `last_hop` as the expected scope and the firmware source supports it. C: reuse the run screen's "Signal of last hop". Shorter, but does not say whose hop | Names the packet as far as the firmware tells us, and says what it is not | costly (wording an AC fixes) | agent |
| D-7 | What is "latest telemetry"? | The samples of the newest run (by `finished_at`, then id) that has any sample, grouped by source, under "From the run of <time>"; each value shows its measured time; a field the source should carry but the response lacked shows "N/A". A newer run without samples does not clear it | B: newest value per field across all runs. Fuller, but mixes values from different runs on one card | One response per group answers AC2 literally; the run time keeps an older card honest | cheap | agent |
| D-8 | FR-08 AC2 lists "the voltage chart" | Not built here; S-07 (battery-history, FR-12) adds it to this screen. No placeholder | B: an empty "Voltage history" card now. Shows where it goes, but is dead UI. C: build the chart now. Pulls S-07 scope forward | The roadmap gives the chart to S-07; FR-08 AC2 is complete when S-07 lands. Logged as `[REVIEW]` | cheap | agent |
| D-9 | Recent runs list | The screen becomes a `FlatList` of the newest **50** runs of the node (newest first, checks not loaded); all cards are its header. Row: local time, the result word (`RunStatus`, text, not colour only) and duration; a tap opens `/run/[id]`. No paging | B: page with `onEndReached`. Unbounded history, more code and states. C: a `FlatList` nested in the `ScrollView`. Smallest diff, but does not virtualise and warns at runtime | Virtualised as AC2 asks, bounded radio-free reads; 50 is "recent" and paging can be added without a schema change | cheap | agent |
| D-10 | Order on the node screen | Identity (name, key prefix, role, reported as, last heard, **last response**) → diagnostic panel → **latest telemetry** → label, role, dashboard and guest-password cards → **recent runs** | B: recent runs right after telemetry, edit cards in the footer. Reads like the PRD list, but every saved run pushes the edit cards further down | Edit cards keep a fixed position; flows that reach them scroll the same way as today | cheap | agent |
| D-11 | "Last response" | `finished_at` of the node's newest `RESPONDED` run, from a repository query; "No response recorded" when none | B: the newest sample's time. No extra query, but a login-only reply (rejected login) has no sample and would not count. C: only the latest run status chip. Already shown, but a later `NO_RESPONSE` hides when it last answered | Answers "when did it last answer" even when the latest run did not | cheap | agent |
| D-12 | Loading and refresh | `NodeHistoryController.load(publicKey)` reads runs, last response and latest samples; concurrent calls for one node share one read. The screen calls it on mount and when `runs.store.last` changes for this node | B: `RunController` keeps history too. One store, but mixes run orchestration with reads. C: reload on a timer. Simple, but polling | Read-only and idempotent (lesson on screen-effect calls); no timers | cheap | agent |
| D-13 | e2e for FR-07/FR-08 | Extend `diag-responded.yaml`: after the run, assert the telemetry card (units, "last hop", provenance) and a run row; then `stopApp`/`launchApp` without `clearState`, reopen Room K and assert the same. No new flow | B: new flow `node-details-restart.yaml`. Isolated, but a 21st flow repeats the connect-and-run start | The suite is already above the guideline (D-13 of app-look); the restart part needs a stored run, which this flow makes | cheap | agent |
| D-14 | Display formats | Voltage 2 decimals "3.35 V"; uptime "0 d 0 h 47 min" from seconds; SNR 2 decimals; dBm and other values as received with their unit symbol; times via the existing `formatTime` | B: uptime in raw seconds. Exact, harder to read | Readable, unit always visible | cheap | agent |
| D-15 | Mutation targets | Add `packages/domain/src/telemetry/samples.ts` (TR-16, 80 %) and `apps/mobile/src/application/nodes/history-presenter.ts` (N/A and last-hop labels, 80 %) to the test-plan table | B: domain file only. Less work, but N/A vs 0 is decided in the presenter | Both files decide what TR-16 protects | cheap | agent |

## Design

### Domain (`packages/domain/src/telemetry/`)
- `samples.ts`
  - `TELEMETRY_SOURCES = ["status", "telemetry"] as const`, `SIGNAL_SCOPES = ["last_hop", "unknown"] as const`.
  - `interface TelemetryValue { name: string; value: number; unit: string | null; channel: number | null }`.
  - `interface Signal { value: number; scope: SignalScope }`.
  - `interface TelemetrySample { runId: number | null; checkSeq: number; source: TelemetrySource; measuredAt: number; voltageV: number | null; uptimeS: number | null; rssiDbm: Signal | null; snrDb: Signal | null; extra: TelemetryValue[] }`.
  - `samplesFromChecks(checks: readonly CheckOutcome[], fallbackAt: number): TelemetrySample[]` (D-1, D-4, D-5): `runId` null; the repository fills it.
- `lpp.ts`: `lppMeaning(type: number): { name: string; unit: string | null }` for the 12 parsed types; unknown → `{ name: "lpp_<type>", unit: null }`.
- `ports.ts`: `interface TelemetryRepository { latestForNode(publicKey: string): Promise<TelemetrySample[]> }` (D-7: samples of one run, ordered by `checkSeq`; `[]` when none).
- `DiagnosticRunRepository` (in `diagnostics/run.ts`) gains `recentForNode(publicKey: string, limit: number): Promise<DiagnosticRun[]>` (newest first, `checks` empty) and `lastRespondedAt(publicKey: string): Promise<number | null>`.
- Exported from `packages/domain/src/index.ts`.

### Storage
- `migrations/0004_telemetry.sql`:
  - `telemetry_samples (id INTEGER PRIMARY KEY, device_id → devices ON DELETE CASCADE, run_id INTEGER NOT NULL, check_seq INTEGER NOT NULL, source TEXT CHECK IN ('status','telemetry'), measured_at INTEGER NOT NULL, voltage_v REAL, uptime_s INTEGER CHECK (NULL OR >= 0), rssi_dbm REAL, rssi_scope TEXT CHECK (NULL OR IN ('last_hop','unknown')), snr_db REAL, snr_scope TEXT …, extra_json TEXT NOT NULL DEFAULT '[]', CHECK ((rssi_dbm IS NULL) = (rssi_scope IS NULL)), CHECK ((snr_db IS NULL) = (snr_scope IS NULL)), UNIQUE (run_id, check_seq), FOREIGN KEY (run_id, check_seq) REFERENCES diagnostic_checks (run_id, seq) ON DELETE CASCADE)`;
  - index `telemetry_samples_device_measured (device_id, measured_at)` (S-07 reads by node and time).
  - Additive only: no existing table changes.
- `src/telemetry/sample-rows.ts`: `insertSamples(tx, deviceId, runId, samples)` and the Zod row schema (`extra_json` parsed with Zod; a bad row throws like `StoredRunError`).
- `SqliteDiagnosticRunRepository.save`: after the checks, `insertSamples(tx, device, runId, samplesFromChecks(run.checks, run.finishedAt))`. New `recentForNode` and `lastRespondedAt`.
- `src/telemetry/telemetry-repository.ts`: `SqliteTelemetryRepository.latestForNode`.
- `src/telemetry/backfill.ts`: `backfillTelemetrySamples(driver): Promise<number>` (rows added): selects responded status/telemetry checks without a sample, parses their evidence with the run repository's evidence schema (moved to `src/diagnostics/evidence.ts` so both use it), inserts in one transaction. A check whose stored evidence fails to parse is skipped, not fatal (counted, never thrown), so a bad old row cannot block app start.
- Error model: write errors fail the whole save (run not stored, existing "not saved" path); read errors reject and the controller shows the neutral storage message.

### App
- `apps/mobile/src/application/nodes/node-history.ts`: `NodeHistoryController` with ports `{ runs: () => Promise<DiagnosticRunRepository>; telemetry: () => Promise<TelemetryRepository> }`; store `byNode: Record<string, { status: "loading" | "ok" | "error"; runs: DiagnosticRun[]; lastRespondedAt: number | null; samples: TelemetrySample[] }>`; `load(publicKey)` (D-12). `RECENT_RUNS = 50`.
- `apps/mobile/src/application/nodes/history-presenter.ts` (pure, returns `Text`):
  - `lastResponseText(at, formatTime)`;
  - `telemetryCard(samples, formatTime): { heading: Text; groups: { title: Text; measured: Text; rows: { label: Text; value: Text }[] }[]; note: Text | null } | { empty: Text }`. Status group rows: battery voltage, uptime, RSSI (last hop), SNR (last hop), extras. Telemetry group rows: voltage, extras, or "No values". Missing → `telemetry.na` ("N/A"). `note` = the last-hop sentence whenever an RSSI/SNR row is shown;
  - `recentRunRow(run, formatTime): { time: Text; status: RunStatus; duration: Text }`.
- `apps/mobile/src/composition/index.ts`: `history: new NodeHistoryController(...)` with the shared `db()`; `openGuardianDb` calls `backfillTelemetrySamples` after migration.
- `apps/mobile/src/app/node/[id].tsx`: the body becomes a `FlatList` (D-9, D-10); the placeholder text and `node.placeholder` key go. `Screen` gets a `list` variant or the screen renders its own `FlatList` with the same padding (implementer's choice; recorded as `[minor]`).
- `apps/mobile/src/i18n/en.json`: `node.lastResponse`, `node.lastResponseNone`, `telemetry.*` (heading, fromRun, source.status/telemetry, measured, fields, `na`, `unitUnknown`, `lastHopNote`, `noValues`, `empty`, `loadFailed`), `history.*` (heading, row, empty). The catalog test (no "offline/down/dead") keeps passing.

## Phases

### Phase 1: Telemetry samples in the domain
- Files:
  - `packages/domain/src/telemetry/samples.ts` (new): types and `samplesFromChecks`. Contract: `samplesFromChecks(checks, fallbackAt): TelemetrySample[]`, one sample per responded status/telemetry check, `checkSeq` = index in `checks` (D-1, D-4, D-5).
  - `packages/domain/src/telemetry/lpp.ts` (new): `lppMeaning(type)`. Contract: 12 types with name and unit; others unit `null`.
  - `packages/domain/src/telemetry/ports.ts` (new): `TelemetryRepository`.
  - `packages/domain/src/index.ts`: exports. (The two new `DiagnosticRunRepository` methods land in Phase 2 together with their SQL implementation, so typecheck stays green.)
  - `packages/domain/src/telemetry/samples.test.ts`, `lpp.test.ts` (new): table-driven.
  - `context/test-plan.md`: TR-16 test names; mutation targets rows (D-15).
- Proves: FR-07 AC1 (unit + source + measured time on every mapped value), FR-07 AC2 at the data level (missing → null, 0 mV → null), FR-07 AC3 at the data level (scope `last_hop`); unit tests, including the Room K fixture values (3353 mV → 3.353 V; ch1 116 3.35 → voltage; ch1 103 30 → temperature °C), a GPS value, an unknown LPP type, an empty telemetry, non-responded checks (no sample), a check without timing (fallback time).
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`.
- Human checks: none.

### Phase 2: Schema v4, sample storage and backfill
- Files:
  - `packages/storage/migrations/0004_telemetry.sql` (new) and the regenerated `src/migrations/generated.ts`. Contract: table `telemetry_samples` as in *Design*.
  - `packages/storage/src/diagnostics/evidence.ts` (new): the evidence Zod schema moved out of `run-repository.ts` (no behaviour change).
  - `packages/storage/src/telemetry/sample-rows.ts` (new): `insertSamples`, row schema.
  - `packages/storage/src/diagnostics/run-repository.ts`: save writes samples; `recentForNode(publicKey, limit)`, `lastRespondedAt(publicKey)`.
  - `packages/domain/src/diagnostics/run.ts`: the two new port methods.
  - `packages/storage/src/telemetry/telemetry-repository.ts` (new): `SqliteTelemetryRepository.latestForNode` (D-7).
  - `packages/storage/src/telemetry/backfill.ts` (new): `backfillTelemetrySamples(driver): Promise<number>` (D-3).
  - `packages/storage/src/index.ts`: exports.
  - `packages/storage/test/telemetry-repository.int.test.ts` (new): save → latestForNode round trip with units/scopes/extras; newest run with samples wins; a later run without samples does not hide it; ordering ties by id; samples cascade on device delete; reopen of the file-backed DB returns the same samples (FR-08 AC1 at storage level); CHECK constraints (scope without value, bad source, negative uptime).
  - `packages/storage/test/run-repository.int.test.ts`: `recentForNode` newest first, limit, other node excluded; `lastRespondedAt` with a later `NO_RESPONSE` run; a failing sample insert rolls back the run.
  - `packages/storage/test/migrate.int.test.ts`: v1 → latest keeps devices (roadmap acceptance, updated to the v4 table list); v3 → 4 keeps runs/checks and creates an empty samples table.
  - `packages/storage/test/backfill.int.test.ts` (new): a v3 database seeded with runs and checks by raw SQL (responded status, responded telemetry, `NO_RESPONSE` status, unparsable evidence) → migrate + backfill → exactly the expected samples; second call adds 0; a run saved after v4 is not duplicated.
- Proves: FR-08 AC3 (integration, migration from v1 and v3 with rows preserved and samples derived), FR-08 AC1 at storage level (file-backed reopen), FR-07 AC1 at storage level (source, run id, measured time persisted); TR-11.
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`.
- Human checks: none.

### Phase 3: Node history controller and presenter
- Files:
  - `apps/mobile/src/application/nodes/node-history.ts` (new): `NodeHistoryController` (D-12). Contract: `load(publicKey): Promise<void>`; store shape as in *Design*.
  - `apps/mobile/src/application/nodes/history-presenter.ts` (new): `lastResponseText`, `telemetryCard`, `recentRunRow` (D-6, D-7, D-11, D-14).
  - `apps/mobile/src/application/nodes/history-presenter.test.ts` (new): N/A for each missing field (never "0"), 0 mV → N/A, last-hop label and note present whenever RSSI/SNR is, `unknown` scope wording, unit-unknown extra, both groups with their measured times and the run time, empty state, formats (D-14).
  - `apps/mobile/src/application/nodes/node-history.int.test.ts` (new): real storage (`openTestDb`) + `RunController` saving a `diag-ok`-like run → `load` returns runs newest first, last response and samples; a storage failure → `status: "error"` with the neutral message (lesson on default branches); two concurrent loads → one read.
  - `apps/mobile/src/platform/sqlite/open-guardian-db.ts`: call `backfillTelemetrySamples` after `migrateToLatest`.
  - `apps/mobile/src/composition/index.ts`: `history` in the container.
  - `apps/mobile/src/i18n/en.json`: the keys the presenter returns (the catalog test has no unused-key rule); a catalog test case resolves every `Text` `telemetryCard` and `lastResponseText` can produce (the existing "offline/down/dead" test covers the new strings).
- Proves: FR-07 AC1–AC3 at presenter level (unit), FR-08 AC2 data (integration), TR-16.
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`.
- Human checks: none.

### Phase 4: Node details screen
- Files:
  - `apps/mobile/src/app/node/[id].tsx`: `FlatList` body (D-9, D-10): header = identity with last response, diagnostic panel, telemetry card, edit cards, "Recent runs" heading; items = run rows linking to `/run/[id]`; empty and error texts; reload on `runs.store.last` change for the node. Placeholder removed.
  - `apps/mobile/src/components/telemetry-card.tsx`, `apps/mobile/src/components/run-row.tsx` (new): render the presenter models; labels as text, status as `RunStatus` (text + icon, TR-19).
  - `apps/mobile/src/components/ui/screen.tsx`: if needed, a variant that lets the screen own the scroller (no change to other screens).
  - `apps/mobile/src/i18n/en.json`: remaining keys; remove `node.placeholder`.
  - `apps/mobile/e2e/diag-responded.yaml`: D-13 steps (`Latest telemetry`, `3.35 V`, `last hop into the node`, `Not end-to-end link quality`, a "Responded" run row, then `stopApp`/`launchApp`, Room K again, same assertions; screenshots `node-details-telemetry`, `node-details-after-restart`).
  - Any other flow whose `scrollUntilVisible`/`tapOn` targets move (lesson: grep all flows for node-screen elements and run the full suite).
  - `context/test-plan.md`: TR-11, TR-16 status `covered (S-06)`; Cookbook flow note for the extended `diag-responded`.
  - `context/changes/node-details-telemetry/evidence/`: the two screenshots (< 300 KB each), e2e output summary.
- Proves: FR-07 AC1–AC3 and FR-08 AC1–AC2 (without the chart, D-8) at e2e level.
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm e2e` (full suite, lesson on shared lists).
- Human checks:
  - Real hardware (CI APK `android-apk`, companion + Room K): run a diagnostic on Room K, open the node: battery voltage, uptime, RSSI/SNR and temperature match the run screen's evidence; each group shows "From the run of <time>" and a measured time.
  - Same phone: force-stop the app (Android App info → Force stop), reopen, open Room K: the same telemetry and the run in "Recent runs".
  - Wording (D-6): read the last-hop labels and the note; they must not read as end-to-end link quality.
  - Look: node screen in light and dark (system setting), at 200 % font size: telemetry rows and run rows readable, nothing clipped.
  - If the phone has runs from before this build (PR #22 testing): after the update, those nodes show telemetry from their earlier runs (D-3 backfill).

## Risks and unknowns
- `last_rssi`/`last_snr` may describe a packet other than our request (another node's packet arriving between request and reply). The wording names "the last packet the node received", which stays true; scope `last_hop` is `UNVERIFIED` (D-6).
- 0 mV meaning "not measured" is inferred, not observed (D-5); the raw value stays in run evidence.
- Repeater (not room server) telemetry has not been captured; other LPP channels and types are untested on hardware. Unknown types get unit `null`, and meshcore.js stops parsing at the first unsupported type: values after it are lost from `values` (still in `lppHex`).
- The `FlatList` rebuild moves the edit cards; e2e flows that reach them can break (mitigated by the lesson: grep and full suite in phase 4).

## Progress
<!-- One line per phase. /implement ticks it in the phase's own commit. -->
- [x] Phase 1: Telemetry samples in the domain
- [ ] Phase 2: Schema v4, sample storage and backfill
- [ ] Phase 3: Node history controller and presenter
- [ ] Phase 4: Node details screen

## Human checks
<!-- Filled by /implement: one open checkbox per human check, with how to run it and evidence. -->

## Deviations
<!-- [minor] / [REVIEW] / [FOLLOW-UP] / [STUCK] entries, see autonomy.md section 3 -->
- [REVIEW] (plan) PRD FR-08 AC2 lists "the voltage chart" on node details; the roadmap gives the chart to S-07 (FR-12). This change ships node details without the chart (D-8), so FR-08 AC2 is complete only when S-07 lands. Alternative: build the chart here, pulling S-07 scope forward.

- [minor] (Phase 1) Plan-review findings 2 and 5 applied: `samplesFromChecks` needs every check of the run in stored order (`checkSeq` = index), so the Phase 2 backfill must load all checks of an affected run and filter the output by missing `(run_id, seq)`; the function is total (non-finite or negative values become null).

## Review response
<!-- revise mode only: one line per plan-review finding and what changed -->
