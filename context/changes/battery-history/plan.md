# Plan: battery-history (S-07)

GitHub issue: #8.

## Goal and end state
- The node details screen has a **Battery voltage (V)** card directly under *Latest telemetry*.
  With voltage on record, it shows a line chart with one point per run, placed along a real time
  axis, plus a "Show values" list that gives every point's local time and value in V
  (FR-12 AC1; the roadmap asks for the accessible list).
- Under the chart, a trend line. With fewer than 5 points, or with points spanning under 24 h
  (A-01), it reads exactly "Not enough data to determine trend" (FR-12 AC2). Above the
  threshold it reads "Falling", "Rising" or "Stable", with the fitted change in V, the span and
  the sample count. No battery-life, time-to-empty or other prediction appears in any state, and
  no API returns one (FR-12 AC3).
- When the node has answered with samples but none of them carries a voltage, the card reads
  "Voltage not available from this node" (FR-12 AC4).
- This completes the voltage chart that FR-08 AC2 lists for node details. S-06 deferred it here
  (node-details-telemetry D-8).

## Scope
- In:
  - domain: voltage readings → one chart point per run, and the trend rule with the A-01 gate;
  - storage: one read query for a node's voltage readings (no migration);
  - app: `NodeHistoryController` also loads voltage, a pure voltage presenter (texts, chart
    geometry, list rows), the voltage card on the node screen with `react-native-gifted-charts`,
    i18n strings, catalog tests;
  - e2e: extend `diag-responded` (one point, not enough data); a fake-only seed route and a new
    flow `battery-history` (many points, a trend, the list);
  - test-plan: TR-17 status, mutation targets.
- Out:
  - battery profiles and low-voltage warnings (FR-16, P1);
  - any prediction or extrapolation (FR-12 AC3, NG-05);
  - zoom, pan or date-range pickers on the chart; paging past the newest 50 points (D-2);
  - an e2e flow for AC4: it would need a doctored fixture with no voltage. AC4 is proved at the
    presenter and integration levels (D-10);
  - export of voltage history (S-08).

## Findings
- Samples already exist (S-06): table `telemetry_samples` with `voltage_v REAL` nullable,
  `source` `status|telemetry`, `measured_at`, `run_id`, and an index on `(device_id, measured_at)`
  (`packages/storage/migrations/0004_telemetry.sql`). The read needs no schema change.
- Voltage mapping (`packages/domain/src/telemetry/samples.ts`, S-06 D-5): status `battMilliVolts / 1000`
  with 0 mV → null; telemetry takes the first channel-1 LPP type-116 value. So a run that
  answered both requests holds two voltage readings of the same battery a few seconds apart
  (Room K recording: status 3.353 V, telemetry 3.35 V).
- `TelemetryRepository` has one method, `latestForNode` (`packages/domain/src/telemetry/ports.ts:3`).
  Its only implementation is `SqliteTelemetryRepository`
  (`packages/storage/src/telemetry/telemetry-repository.ts:6`), and the tests use it on
  `node:sqlite` (`apps/mobile/src/application/nodes/node-history.int.test.ts:41`). There are no
  fakes to extend.
- `NodeHistoryController` reads runs, the last response and the latest samples in one
  `Promise.all` and keeps the previous data while it reloads. `loaded` marks real data
  (`apps/mobile/src/application/nodes/node-history.ts:12-70`). The node screen derives its cards
  only from `loaded` history (`apps/mobile/src/app/node/[id].tsx:129-135`), following the lesson
  on empty-data messages. `latestForNode` returns `[]` only when the node has no sample at all, so
  "has any sample" is `samples.length > 0`.
- Times are shown with `formatTime` = `toLocaleString()` (`apps/mobile/src/components/node-row.tsx:14`).
- Mockup (`docs/design/mockup/Node.dc.html:60-80`): a card titled "Battery voltage (V)" right
  after *Latest telemetry*, an SVG line with dots, y labels in volts, a time label per point, and
  "Not enough data to determine trend" under it. The SVG carries an `aria-label` that lists every
  sample.
- The tech stack chose `react-native-gifted-charts` 1.4.81 with `react-native-svg`, with an
  accessible list for every chart (`context/tech-stack.md:22,109-115`). `react-native-svg`
  15.15.4 is already a dependency. gifted-charts is not installed yet.
- gifted-charts 1.4.81 (npm metadata, package tarball, context7
  `/abhinandan-kushwaha/react-native-gifted-charts`):
  - The peer deps include `expo-linear-gradient` or `react-native-linear-gradient`. The loader
    `dist/Components/common/LinearGradient.js` throws at module load when neither is present.
  - Only bar-chart modules use that loader. Following the local requires from
    `dist/LineChart/index.js` reaches 9 modules, none of them a gradient or BarChart module. The
    package has no `exports` map, so the deep import `react-native-gifted-charts/dist/LineChart`
    resolves and ships its own `.d.ts`.
  - `lineDataItem` has a per-item `spacing` (distance to the next point), `label` and `value`;
    LineChart has `yAxisOffset`, `maxValue`, `noOfSections`, `stepValue`, `isAnimated`,
    `disableScroll`, `adjustToWidth`, `xAxisLabelTexts`. The dependency `gifted-charts-core`
    0.1.83 is pure JS.
- The e2e suite has 20 flows. `diag-responded.yaml` makes one responded run on Room K and
  checks the node screen before and after a restart. Flows that reach cards below *Latest
  telemetry*: `guest-password`, `guest-password-admin` (`scrollUntilVisible "Guest password"`),
  `diag-responded` and `lib/look-screens.yaml` (`"Recent runs"`). The lesson on added height
  applies.
- Fake-only debug routes exist: `apps/mobile/src/app/debug/scenario/[name].tsx` guards on
  `container.platform.fake !== null` and redirects otherwise, so it is inert in the BLE (CI APK)
  build.

## Decisions
| ID | Question | Chosen | Alternatives (and what they would buy) | Why | Reversal | Decided by |
|----|----------|--------|----------------------------------------|-----|----------|------------|
| D-1 | What is one chart point? | One point per run that has a voltage reading: the **status** voltage when present, else the telemetry voltage. Its time is that sample's `measuredAt` | B: every voltage sample, both sources: literal "each sample", but every run draws two near-identical dots seconds apart, and each run counts twice towards the 5-sample threshold. C: telemetry only: one source, but a node that answers status and not telemetry would show nothing | One observation of the battery per run. Status has mV resolution, LPP 0.01 V. Each run counts once towards A-01 | cheap (read side only) | agent |
| D-2 | How much history? | The newest **50** runs with a voltage reading (`VOLTAGE_RUNS = 50`), shown oldest → newest. The trend uses the same points | B: last 30 days (like the export default A-06): a fixed window, but a node tested rarely would drop to "Not enough data". C: all history: complete, but an unbounded read and chart | Bounded read and chart, same bound as recent runs (S-06 D-9). The trend text names the span it covers, so the window is visible | cheap | agent |
| D-3 | Trend rule above the A-01 gate | Least-squares line through (time, V). Fitted change = slope × span. Under **0.05 V** in absolute value → `stable`, otherwise `falling` / `rising`. Result `{ kind, changeV, spanMs, count }`, and nothing else | B: last minus first: simpler, but one noisy reading flips the word. C: no word, only the change: most neutral, but operators asked "is it trending down" (PRD §1) | Robust to a single outlier and still explainable as "fitted change". The band is one constant, cheap to tune like A-01 | cheap | agent |
| D-4 | Trend wording | Insufficient: "Not enough data to determine trend" (AC2, verbatim) + muted "Needs at least 5 samples over 24 h; this node has {{count}} over {{span}}." Others: "Trend: falling, about −0.06 V over 3 d 4 h ({{count}} samples)" / "rising, about +0.04 V …" / "Trend: stable, less than 0.05 V change over …" | B: only the AC2 sentence, with no counts: shorter, but the user cannot tell how close the threshold is. C: words like "draining", "healthy": judgemental, and close to a prediction | Says what was measured and over what span. "About" marks a fitted value. Nothing about the future | cheap | agent |
| D-5 | Card states | Not loaded → no card body (lesson: never derive empty text from defaults). Read error → the screen's existing neutral load-failed alert, no card text. Loaded with no sample at all → "No voltage recorded yet." Loaded with samples but no voltage reading → "Voltage not available from this node" (AC4). Otherwise the chart | B: show AC4 also when there are no samples: fewer states, but it would claim something about the firmware before the node ever answered. C: AC4 only when a **status** reply lacked voltage: stricter, but a node that answers only telemetry without voltage would show "No voltage recorded yet", which is also not quite true | AC4 is about replies without voltage. "No samples" means the node never answered, and the app does not know about its voltage | cheap | agent |
| D-6 | Chart dependency | Add `react-native-gifted-charts` **1.4.81** (exact pin, as in the tech stack), imported only by `components/voltage-chart.tsx` through `react-native-gifted-charts/dist/LineChart`, so no gradient package is needed | B: also add `expo-linear-gradient` and use the package root: the documented install, but a second native module and a rebuild for a gradient we never draw. C: hand-written chart on `react-native-svg` (~100 lines, no new dependency, geometry fully unit-testable): it departs from the tech-stack choice | The tech stack chose gifted-charts. The deep import avoids an unused native dependency. One file imports it, so B or C changes only that file | costly (new runtime dependency) | research |
| D-7 | x axis | Points are placed in proportion to time: per-item `spacing` = gap / span × plot width, at least 6 px. The presenter computes it. x labels are the first and last point times only | B: equal spacing (library default): simpler, but four quick runs and one three days later would look evenly spread, which misleads. C: a label under every point (mockup): fine for 4 points, overlapping for 50 | Honest shape for irregular, manual runs. The exact times are in the list (D-8) | cheap | agent |
| D-8 | AC1 "each sample with its timestamp and unit" and NFR-05 | The card title "Battery voltage (V)" and the y labels carry the unit. The chart view has an `accessibilityLabel` summary (count, first and last time, min and max V). A "Show values" button (role button, `expanded` state) opens a list, newest first, with a row per point: local time, "3.35 V" and the source. Collapsed by default | B: list always open: no tap, but 50 rows make the screen long. C: tap a point to see its value (library focus API): looks nice, but a screen reader cannot reach it | Every sample's time and V is one tap away, readable by TalkBack, and the screen stays short | cheap | agent |
| D-9 | Where on the screen | Directly after *Latest telemetry*, before the label, role, dashboard and guest-password cards (mockup order) | B: after the edit cards, before *Recent runs*: the edit cards keep their position (S-06 D-10), but voltage is separated from the telemetry it belongs to | Related readings stay together, as in the mockup. Cost: flows that scroll to the edit cards are checked (lesson) | cheap | agent |
| D-10 | e2e coverage | Extend `diag-responded`: one point → the card, "Not enough data to determine trend", and "Show values" with a "3.35 V" row. A new flow `battery-history.yaml` uses the fake-only route `guardian://debug/seed/voltage-history`, which stores 6 synthetic responded runs for Room K over 3 days with falling voltage through the normal run repository. The flow asserts "Trend: falling", list rows and the restart. AC4 has no e2e (scope Out) | B: no seed route: no new app code, but the multi-point chart and trend text would only be seen in unit tests, and a person would need 24 h of runs to judge them. C: also a doctored no-voltage fixture for AC4 e2e: complete, but it edits recorded frames for a text already proved below | Gives evidence for the main UI of this item at the cost of one fake-only route, guarded like `debug/scenario` | cheap (fake-only code) | agent |
| D-11 | AC3 guard | The trend result type has no prediction fields, and a unit test pins its keys. A catalog test fails if any `en.json` string matches `/battery life\|time[- ]to[- ]empty\|until empty\|runtime left/i` or if a `battery.*` string matches `/remaining\|left\|estimat\|predict/i` | B: rely on review: no test, and AC3 is easy to regress with one string | AC3 is a "no X anywhere" rule. The cheapest automated proof is the data shape plus the catalog | cheap | agent |
| D-12 | Mutation targets | `packages/domain/src/telemetry/voltage.ts` replaces the test-plan path `packages/domain/src/trend.ts` (TR-17, 80 %). Add `apps/mobile/src/application/nodes/voltage-presenter.ts` (AC2/AC4 texts, geometry, 80 %) | B: domain only: less work, but the AC4 and empty-state choices live in the presenter | Both files decide what TR-17 and FR-12 protect | cheap | agent |

## Design

### Domain (`packages/domain/src/telemetry/voltage.ts`)
- `interface VoltageReading { runId: number; source: TelemetrySource; measuredAt: number; voltageV: number }`.
- `interface VoltagePoint { runId: number; source: TelemetrySource; at: number; voltageV: number }`.
- `voltagePoints(readings: readonly VoltageReading[]): VoltagePoint[]` (D-1): groups by run,
  takes the status reading when present, else telemetry, and sorts by `at` ascending, then by
  `runId`. Non-finite or non-positive values are dropped (total function, like `samplesFromChecks`).
- `TREND_MIN_SAMPLES = 5`, `TREND_MIN_SPAN_MS = 24 * 3_600_000` (A-01), `TREND_STABLE_BAND_V = 0.05`.
- `type VoltageTrend = { kind: "insufficient"; count: number; spanMs: number } | { kind: "falling" | "rising" | "stable"; changeV: number; spanMs: number; count: number }`.
- `voltageTrend(points: readonly VoltagePoint[]): VoltageTrend` (D-3). Span = last `at` − first
  `at`. Insufficient iff `count < 5 || spanMs < 24 h`. Otherwise the least-squares slope in V/ms
  × span. The fit uses times relative to the first point, which avoids precision loss with epoch ms.
- Exported from `packages/domain/src/index.ts`. No I/O, no imports outside domain.

### Port and storage
- `TelemetryRepository.voltageForNode(publicKey: string, runs: number): Promise<VoltageReading[]>`:
  every non-null voltage reading of the node's newest `runs` runs that have one, ordered by
  `measured_at`, `run_id`, `check_seq`. Newest = by `MAX(measured_at)` of the run's voltage
  readings, ties by `run_id` DESC.
- `SqliteTelemetryRepository.voltageForNode`: one query, joins `devices` by `public_key`, with a
  subquery that picks the run ids (`GROUP BY run_id ORDER BY MAX(measured_at) DESC, run_id DESC LIMIT ?`).
  Rows are validated with a small Zod schema (like `toSample`); a bad row throws.
- Error model: a read error rejects. The controller turns it into `status: "error"` (existing
  path).

### App
- `node-history.ts`: `NodeHistory` gains `voltage: VoltagePoint[]` (`[]` in `LOADING`). `read`
  also calls `telemetry.voltageForNode(publicKey, VOLTAGE_RUNS)` in the same `Promise.all` and
  stores `voltagePoints(readings)`. `VOLTAGE_RUNS = 50`.
- `voltage-presenter.ts` (pure, no RN imports, returns `Text`):
  - `voltageCard(input: { samples: readonly TelemetrySample[]; voltage: readonly VoltagePoint[] }, formatTime, plotWidth): VoltageCardModel`.
    The caller passes only loaded history (D-5).
  - `type VoltageCardModel = { kind: "none"; text: Text } | { kind: "unavailable"; text: Text } | { kind: "chart"; title: Text; summary: Text; chart: ChartModel; trend: Text; trendDetail: Text | null; rows: { time: Text; value: Text; source: Text }[] }`.
  - `ChartModel = { points: { value: number; spacing: number; label: string | null }[]; yMin: number; yMax: number; step: number; yLabels: string[] }`.
    y range: min/max rounded out to 0.05 V, at least 0.2 V tall, 4 sections, labels to 2 decimals.
    Spacing per D-7. A single point gets spacing 0 and is centred by `initialSpacing`.
  - `trendText(trend): { trend: Text; detail: Text | null }` (D-4). `spanText(ms)` as "3 d 4 h",
    "5 h 12 min" or "0 min".
- `components/voltage-chart.tsx` (the only file that imports gifted-charts): renders
  `ChartModel` with theme colours, `isAnimated={false}`, `disableScroll`, and the width from
  `onLayout`. It is wrapped in a `View` with `accessible` and `accessibilityLabel={summary}`.
- `components/voltage-card.tsx`: a `Card` with `SectionHeading` "Battery voltage (V)", the chart,
  the trend text and detail, the "Show values" / "Hide values" toggle, and the rows. It renders
  the `none` and `unavailable` texts in the same card (AC4: "the chart area shows").
- `app/node/[id].tsx`: renders `<VoltageCard>` after the telemetry card when `shown !== null`
  (D-9). The width comes from the card's `onLayout`, with `0` until measured (no chart until then).
- `en.json`: `battery.title`, `battery.none`, `battery.unavailable`, `battery.notEnough`,
  `battery.notEnoughDetail`, `battery.trend.falling|rising|stable`, `battery.summary`,
  `battery.showValues`, `battery.hideValues`, `battery.row`, `battery.source.status|telemetry`,
  `battery.span.*`. The catalog test has no "offline/down/dead".
- Debug seed (Phase 5): `apps/mobile/src/debug/voltage-seed.ts` builds 6 `DiagnosticRun`s for
  Room K (`RESPONDED`, one status check each with `battMilliVolts` 4080 → 3980, `finishedAt` from
  now − 72 h to now − 2 h). `apps/mobile/src/app/debug/seed/[name].tsx` saves them through the
  container's run repository and then redirects to the node. It is inert unless
  `container.platform.fake !== null`, as in the scenario route.

## Phases

### Phase 1: Voltage points and trend rule in the domain
- Files:
  - `packages/domain/src/telemetry/voltage.ts` (new): types, `voltagePoints`, `voltageTrend` and
    the constants. Contract: as in *Design*. `VoltageTrend` has no prediction field (D-11).
  - `packages/domain/src/telemetry/voltage.test.ts` (new), table-driven:
    - points: status over telemetry in one run; telemetry-only runs; sorting by time and ties by
      run id; non-finite and ≤ 0 dropped.
    - trend boundaries (TR-17): 4 points / 48 h → insufficient; 5 / 23 h 59 min → insufficient;
      5 / exactly 24 h → a trend; 0 and 1 points.
    - trend kinds: falling and rising beyond the band, stable inside it, the band edge
      (|change| = 0.05 → not stable), one outlier in a steady series stays stable (D-3),
      epoch-ms times keep their precision.
    - the result's keys are exactly `kind, changeV, spanMs, count` (AC3).
  - `packages/domain/src/index.ts`: exports.
  - `context/test-plan.md`: TR-17 test names, and the mutation-target row renamed to
    `packages/domain/src/telemetry/voltage.ts` (D-12).
- Proves: FR-12 AC2 (threshold, unit), FR-12 AC3 (no prediction in the domain shape, unit), TR-17.
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`.
- Human checks: none.

### Phase 2: Voltage readings from storage
- Files:
  - `packages/domain/src/telemetry/ports.ts`: `voltageForNode(publicKey, runs)`. Contract:
    ordering and limit as in *Design*.
  - `packages/storage/src/telemetry/telemetry-repository.ts`: `SqliteTelemetryRepository.voltageForNode`.
  - `packages/storage/src/telemetry/sample-rows.ts`: the reading row schema, if it fits there
    (otherwise inline in the repository, `[minor]`).
  - `packages/storage/test/telemetry-repository.int.test.ts`: runs saved through
    `SqliteDiagnosticRunRepository` (samples derived as in production):
    - both readings of one run are returned;
    - null voltage is excluded;
    - a run whose only sample has no voltage does not count towards the limit;
    - the limit keeps the newest runs, ordered ascending;
    - another node's readings are excluded;
    - an unknown key returns `[]`;
    - a file-backed DB returns the same readings after reopening;
    - a row with a corrupt `source` throws.
- Proves: FR-12 AC1 data (every stored voltage reading with its time, integration), FR-12 AC4
  data (no readings when samples lack voltage, integration).
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`.
- Human checks: none.

### Phase 3: Voltage in node history and the voltage presenter
- Files:
  - `apps/mobile/src/application/nodes/node-history.ts`: `voltage` in `NodeHistory`;
    `VOLTAGE_RUNS`. Contract: `voltage` holds real data only when `loaded` is true.
  - `apps/mobile/src/application/nodes/voltage-presenter.ts` (new): `voltageCard`, `trendText`,
    `spanText`, chart geometry (D-4, D-5, D-7, D-8).
  - `apps/mobile/src/application/nodes/voltage-presenter.test.ts` (new):
    - card states: no samples → `none`; samples without voltage → `unavailable` with
      `battery.unavailable` (AC4); one point → chart plus `battery.notEnough` (AC2);
    - D-4 texts with sign and 2 decimals;
    - rows newest first, with time, "V" and source (AC1);
    - geometry: spacing proportional to the time gaps, with the minimum gap; total spacing ≤ plot
      width; y range covers every point; single point; first and last labels only;
    - the summary carries the count, the first and last time, and min and max.
  - `apps/mobile/src/application/nodes/node-history.int.test.ts`: real storage + `RunController`.
    A responded `diag-ok`-like run → `voltage` has one status point. A run with 0 mV status and
    no telemetry voltage → samples exist and `voltage` is `[]`. A storage failure on
    `voltageForNode` → `status: "error"` with the previous data kept.
  - `apps/mobile/src/i18n/en.json`: `battery.*` keys.
  - `apps/mobile/src/i18n/catalog.test.ts`: every `Text` that `voltageCard` and `trendText` can
    return resolves. Prediction words are forbidden (D-11).
  - `context/test-plan.md`: mutation-target row for `voltage-presenter.ts` (D-12).
- Proves: FR-12 AC1 (rows carry the time and V, unit), AC2 (text, unit), AC3 (catalog, unit),
  AC4 (unit + integration).
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`.
- Human checks: none.

### Phase 4: Voltage card on the node screen
- Files:
  - `apps/mobile/package.json`, `pnpm-lock.yaml`: `react-native-gifted-charts` `1.4.81` exact
    (D-6). Run `pnpm install` and commit the lockfile.
  - `apps/mobile/src/components/voltage-chart.tsx` (new): the only gifted-charts import, through
    `react-native-gifted-charts/dist/LineChart`. If that path does not type-check or bundle, fall
    back to D-6 alternative C (hand-written `react-native-svg`) in this same file, and log it as
    `[REVIEW]`.
  - `apps/mobile/src/components/voltage-card.tsx` (new): card, trend, toggle, rows, the `none`
    and `unavailable` texts. `testID="voltage-card"`.
  - `apps/mobile/src/app/node/[id].tsx`: the card after the telemetry card (D-9).
  - `apps/mobile/e2e/diag-responded.yaml`: after "Latest telemetry", `scrollUntilVisible
    "Battery voltage \(V\)"`, then assert "Not enough data to determine trend", tap "Show values",
    assert a row matching `.*3\.35 V.*` and take the screenshot `battery-one-sample`. Repeat the
    card assertion after the restart.
  - All other flows: grep for elements below the telemetry card (`Guest password`,
    `Recent runs`, label and role cards in `lib/look-screens.yaml`) and fix their scrolls if
    needed. Run the **full** suite (lesson).
  - `context/changes/battery-history/evidence/`: `battery-one-sample.png` (< 300 KB), e2e summary.
- Proves: FR-12 AC1 and AC2 at e2e level (one point), FR-08 AC2 (chart on node details) together
  with S-06.
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm e2e` (full suite).
- Human checks:
  - Real phone, CI APK (`android-apk`), companion + Room K: run two diagnostics on Room K at least
    60 s apart, then open the node. The voltage card shows 2 points and "Not enough data to
    determine trend". "Show values" lists both runs with their local time, V and source, and the
    values match the run screens.
  - Look: the voltage card in light and dark (system setting) and at 200 % font size. The chart is
    not clipped, the axis labels are readable, and the list rows wrap without overlap.
  - TalkBack on the voltage card: the chart reads the summary (count, time range, min/max V), and
    "Show values" announces as a button with its expanded state.

### Phase 5: Seeded history and the trend flow
- Files:
  - `apps/mobile/src/debug/voltage-seed.ts` (new): `voltageSeedRuns(now, nodePublicKey, companion): DiagnosticRun[]`
    (6 runs, 72 h, falling).
  - `apps/mobile/src/debug/voltage-seed.test.ts` (new): the seed passes A-01 and gives
    `voltageTrend` kind `falling` (a fixed seed that drifts would break the flow).
  - `apps/mobile/src/app/debug/seed/[name].tsx` (new): name `voltage-history`. It works only in the
    fake build, saves through `container`'s run repository, then redirects to `/node/<Room K key>`.
    Unknown name or BLE build → redirect `/`.
  - `apps/mobile/e2e/battery-history.yaml` (new):
    1. `connect-diag` with `diag-ok` (Room K synced), then `openLink guardian://debug/seed/voltage-history`;
    2. scroll to "Battery voltage (V)"; assert "Trend: falling.*" and ".*6 samples.*";
    3. tap "Show values" and assert the newest row; take the screenshot `battery-trend`;
    4. `stopApp` / `launchApp`, reopen Room K, assert the same trend (restart).
  - `context/test-plan.md`: TR-17 status `covered (S-07)`; the Cookbook note for the 21st flow.
  - `context/changes/battery-history/evidence/battery-trend.png`, e2e summary.
- Proves: FR-12 AC1 (many points, list) and the trend text at e2e level, plus persistence of the
  history across a restart.
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm e2e` (full suite).
- Human checks:
  - Wording (D-4), on `evidence/battery-trend.png` or the fake build: "Trend: falling, about −0.10 V
    over 2 d 22 h (6 samples)" reads as a measurement, not a forecast. Nothing on the card
    suggests remaining battery life (AC3).
  - Chart shape (D-7): the seeded points are spread by time, not evenly.

## Risks and unknowns
- gifted-charts 1.4.81 has not run under RN 0.86 / React 19.2 / New Architecture in this app.
  The deep import path is not a documented entry point. Mitigation: the exact pin, a single
  importing file, and the fallback named in Phase 4.
- Per-item `spacing` with `adjustToWidth` and `disableScroll` may not combine as the types
  suggest. The presenter keeps the total within the plot width, so only `spacing` is needed.
  Without it the chart falls back to the library's even spacing, which would be a `[REVIEW]`
  deviation (D-7).
- Status mV and telemetry 0.01 V readings from different runs differ slightly (3.353 vs 3.35).
  Mixing them across runs adds steps well inside the 0.05 V band.
- The meaning of 0 mV is inferred (S-06 D-5), so a node that reports 0 mV shows as "Voltage not
  available from this node" (AC4). This is `UNVERIFIED` until seen on a repeater.
- Voltage under load (during TX) can dip. A few seconds between status and telemetry can
  differ; D-1 always picks status, so the series stays consistent.

## Progress
<!-- One line per phase. /implement ticks it in the phase's own commit. -->
- [x] Phase 1: Voltage points and trend rule in the domain
- [x] Phase 2: Voltage readings from storage
- [x] Phase 3: Voltage in node history and the voltage presenter
- [x] Phase 4: Voltage card on the node screen
- [x] Phase 5: Seeded history and the trend flow

## Human checks
<!-- Filled by /implement: one open checkbox per human check, with how to run it and evidence. -->
- [ ] (Phase 4) Two diagnostics on Room K at least 60 s apart, then open the node: the voltage card shows 2 points, "Not enough data to determine trend", and "Show values" lists both runs with local time, V and source matching the run screens — run: CI APK (`android-apk`) on a real phone with companion + Room K — evidence: none
- [ ] (Phase 4) Look of the voltage card in light and dark and at 200 % font size: chart not clipped, axis labels readable, rows wrap without overlap; the first/last x label is truncated at its current width ("16/2026, 2:2…") — run: CI APK, system theme and font settings — evidence: `context/changes/battery-history/evidence/battery-one-sample.png` (emulator, light, one point)
- [ ] (Phase 4) TalkBack on the voltage card: the chart reads its summary (count, time range, min/max V); "Show values" announces as a button with expanded state — run: CI APK on a real phone, TalkBack on — evidence: none
- [ ] (Phase 5) Wording (D-4): "Trend: falling, about −0.10 V over 2 d 22 h (6 samples)" reads as a measurement, not a forecast, and nothing on the card suggests remaining battery life (AC3) — run: fake build `EXPO_PUBLIC_TRANSPORT=fake pnpm --filter mobile android`, connect, open `guardian://debug/seed/voltage-history` — evidence: `context/changes/battery-history/evidence/battery-trend.png`
- [ ] (Phase 5) Chart shape (D-7): the six seeded points are spread by time, not evenly — run: same as above — evidence: `context/changes/battery-history/evidence/battery-trend.png`

## Deviations
<!-- [minor] / [REVIEW] / [FOLLOW-UP] / [STUCK] entries, see autonomy.md section 3 -->
- [minor] Phase 4: the added card height broke three flows the plan did not name. `contacts-sync` could not see "Add to dashboard" (now scrolls to it); `guest-password` and `guest-password-admin` lost "Responded" off screen after a run (now wait for "View details", then scroll up to "Responded"; they scroll up to "Not tested" before the run); `guest-password` also scrolls to "Remove password" after the restart. Full suite 20/20 passed.
- [minor] Phase 4: gifted-charts ignored `yAxisLabelTexts` together with `yAxisOffset` (labels showed offset-relative values), so the chart uses `showFractionalValues` and `roundToDigits={2}` instead; `ChartModel.yLabels` is now only used by the presenter tests and the summary, not by the chart. The deep import `react-native-gifted-charts/dist/LineChart` type-checks and bundles, so no D-6 fallback.
- [minor] Phase 4: the first and last x labels are cut off ("16/2026, 2:2…") because the label width is 90 px and `toLocaleString()` is long; the exact times are in the list. Shorter x labels are a follow-up.
- [FOLLOW-UP] Phase 4: shorter x axis labels (time only or date only) so they are not truncated. Done in review fix R1.
- [minor] Phase 5: the seed route needs the run repository, which the container did not expose; added `container.runRepository` (debug seed routes only). The flow's first two asserts scroll to the trend text because it sits below the chart, off screen after scrolling to the card title. Full suite: 20/20 other flows passed in the full run; `battery-history` failed once on the off-screen trend, then passed alone after the scroll fix.

## Review response
<!-- revise mode only: one line per plan-review finding and what changed -->

- [minor] Review fix R1/R2 changed layout and e2e selectors; evidence screenshots `battery-trend`, `battery-one-sample` must be re-taken by a green `pnpm e2e` (run started at fix time; unit gates, typecheck and lint pass).
