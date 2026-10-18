# Plan: export-report (S-08)

GitHub issue: #9.

## Goal and end state
- The node details screen has an **Export** button. It opens an export screen for that node
  where the user picks a date range (preset, default **last 30 days**, A-06) and a format,
  **JSON** or **CSV** (FR-13 AC1).
- Before anything is shared, the screen shows a preview: how many runs and telemetry samples
  fall in the range, the exact fields the file will contain (the CSV column names, or the JSON
  field groups), the redactions that apply, and the line "Passwords and stored credentials are
  never exported" (FR-13 AC2).
- By default every public key in the file (node and companion) is its 4-byte hex prefix
  (8 hex characters, `keyPrefix`). A "Full public keys" switch on the screen turns redaction off
  for this export, and then the 64-character keys appear (FR-13 AC3, D-08).
- No export contains a guest password or any secure-storage value. A test stores a canary
  password, runs a diagnostic that sends it, exports JSON and CSV with redaction on and off, and
  searches the output for it (FR-13 AC4, TR-09).
- **Share** writes the file to the app cache and opens the Android share sheet with it
  (FR-13 AC5).
- Both formats carry `schema_version` (roadmap, *Decided up front*). The JSON shape is validated
  with Zod before the file is written. Golden files pin the JSON and CSV output with redaction
  on and off (roadmap acceptance, TR-10).

## Scope
- In:
  - domain: export report model, key redaction, JSON and CSV serialisation, the field manifest
    the preview shows; golden-file tests;
  - storage: read a node's runs (with checks) and their samples for a time range (no migration);
  - app: Zod export schema, `ExportController` (read → preview → share), presenter, platform
    port that writes the file and opens the share sheet (`expo-file-system`, `expo-sharing`, both
    chosen in tech-stack), export route, Export button on the node screen, i18n strings;
  - e2e flow `export-report` on the seeded voltage history; evidence screenshots;
  - test-plan: TR-09 / TR-10 status, mutation-target row for `export/*`.
- Out:
  - the persisted redaction default in Settings (FR-15 AC1, S-09). Here the screen starts
    with redaction on; S-09 wires the stored default into the same constructor port (D-10);
  - exports of several nodes, or of the whole database;
  - a free date picker (D-3);
  - raw frame bytes and decoded check evidence in the file (D-5);
  - importing an export.

## Findings
- Runs: `DiagnosticRunRepository` has `get`, `latestPerNode`, `recentForNode`, `lastRespondedAt`
  (`packages/domain/src/diagnostics/run.ts:32-41`). Only `get` loads checks
  (`packages/storage/src/diagnostics/run-repository.ts:179-188`). There is an index on
  `diagnostic_runs (device_id, finished_at)` (`packages/storage/migrations/0002_diagnostics.sql`),
  so a range read on `finished_at` needs no schema change.
- Samples: `telemetry_samples` rows are keyed by `(run_id, check_seq)` and carry `device_id`
  (`packages/storage/migrations/0004_telemetry.sql`). `TelemetryRepository` has `latestForNode`
  and `voltageForNode` (`packages/domain/src/telemetry/ports.ts`). Sample rows are parsed by Zod
  in `packages/storage/src/telemetry/sample-rows.ts`.
- `keyPrefix(publicKey)` is `slice(0, 8)` = 4 bytes in hex (`packages/domain/src/nodes/node.ts`).
  That is exactly the redaction D-08 asks for, so the export reuses it.
- Public keys present in stored data: the node key, and `companion.publicKey` on every run
  (`packages/domain/src/diagnostics/run.ts:7-11`). Check evidence holds no key fields, but
  `telemetry.lppHex` and `malformed.hex` are raw payload bytes
  (`packages/domain/src/diagnostics/check.ts:46-52`), and their content is not controlled by us.
- Secrets: guest passwords live only in `SecretStore` (`apps/mobile/src/application/nodes/guest-passwords.ts`).
  A stored login check keeps `passwordSent: boolean`, never the password. A leak test already
  exists for SQLite and logs (`apps/mobile/src/application/nodes/guest-password-leak.int.test.ts`),
  and the export test follows it.
- Zod is a dependency of `storage` and `apps/mobile`, not of `domain`. CLAUDE.md says `domain`
  imports nothing. Lint does not forbid `zod` in domain (`eslint.config.mjs`, `forbid.*`), but the
  rule is written down, so the schema goes to the app layer (D-8).
- Lint forbids Node built-ins in all of `packages/domain/**`, test files included. So golden
  files cannot be read with `node:fs`. The adapter tests already load fixtures with
  `import.meta.glob(..., { query: "?raw", import: "default", eager: true })`
  (`packages/meshcore-adapter/test/fixtures.int.test.ts:10-18`), and the golden test uses the same
  pattern. Unlike `toMatchFileSnapshot`, a stray `-u` cannot rewrite these files.
- Node screen: everything above the run list is a `FlatList` header (`apps/mobile/src/app/node/[id].tsx:80-95`).
  Adding a button there pushes the run rows down. Per the lesson, every e2e flow that asserts run
  rows must be checked, and the full suite must run.
- `Segmented` takes two or three options (`apps/mobile/src/components/ui/segmented.tsx:11`).
  The mockup shows the Export button next to *Run diagnostic* on the node screen
  (`docs/design/mockup/Node.dc.html:38-46`), and the Settings mockup's wording is "Shorten public keys —
  Exports show a 4-byte prefix. Passwords are never exported." (`docs/design/mockup/Settings.dc.html:45-47`).
  There is no mockup for the export screen itself.
- expo-file-system 57 (new API): `new File(Paths.cache, name)`; `create()` throws if the file
  exists; `write(string)`; `uri`. expo-sharing: `isAvailableAsync()`,
  `shareAsync(uri, { mimeType, dialogTitle })`. Source: docs.expo.dev/versions/latest/sdk/filesystem
  (context7). Neither module is installed yet (`apps/mobile/package.json`). Tech-stack pins
  57.0.7 / 57.0.22, both on the registry.
- The app version is in `apps/mobile/app.json` (`0.0.0`). `expo-constants` is already a
  dependency.
- CSV injection: node names and labels come from the mesh or the user, and a spreadsheet runs
  a cell that starts with `=`, `+`, `-` or `@` as a formula (OWASP "CSV Injection"). Numeric
  columns can legitimately start with `-` (RSSI), so only text columns are neutralised (D-7).

## Decisions
| ID | Question | Chosen | Alternatives (and what they would buy) | Why | Reversal | Decided by |
|----|----------|--------|----------------------------------------|-----|----------|------------|
| D-1 | JSON shape | One object: `schema_version: 1`, `generated_at`, `generated_by`, `range {from,to}`, `redaction {public_keys: "prefix" \| "full"}`, `node {…}`, `runs[]`, each run with its `checks[]` and `telemetry[]`. snake_case keys, times as ISO 8601 UTC strings, durations in ms | B: flat arrays `runs[]` + `samples[]` joined by run id (closer to the tables, but readers must join); C: epoch-ms times (exact and compact, but unreadable in a text editor) | Nesting keeps a run and its evidence together, so a reader needs no join. ISO UTC is unambiguous and readable. The whole shape is in `report.ts` and the Zod schema | costly (file format others may parse) | agent |
| D-2 | CSV shape | One row per run, with header row, RFC 4180 (comma, CRLF, quotes only where needed). Columns in *Design*. A `schema_version` column on every row. Per-run telemetry columns take, per field, the first non-null value in check order (status before telemetry). Checks and limitations go in one cell each, joined with `;` | B: one row per telemetry sample (runs without samples disappear, or need empty rows); C: two CSV files, runs and samples (a zip, or two shares); D: `# schema_version` comment line (breaks spreadsheet import) | Operators open CSV in a spreadsheet: one row per run reads as a log. A version column survives any CSV reader | costly (file format) | agent |
| D-3 | How the range is chosen | `Segmented` presets **7 / 30 / 90 days**, default 30, ending at "now" when the screen reads the data | B: native date picker (`@react-native-community/datetimepicker`, exact days, but a new runtime dependency); C: typed dates (no dependency, but error-prone on a phone) | AC1 asks for "a date range", default 30 days. Presets meet it without a dependency and are easy to test. A custom range can be added later behind the same `range` field | cheap | agent |
| D-4 | Which runs fall in the range | `from ≤ finishedAt ≤ to`, inclusive, `from = to − days × 24 h`. Samples belong to the run, not to their own `measuredAt` | B: by `startedAt` (differs only for runs that cross the boundary); C: by sample `measuredAt` (a run could be split across the edge) | `finishedAt` is the time the node screen shows for a run, so the preview count matches the list | cheap | agent |
| D-5 | Is check evidence exported? | No. Each check exports `kind, result, reason, attempts, timeout_ms, timeout_source, started_at, duration_ms`. The decoded values reach the file through the run's telemetry samples. Raw `lppHex` / malformed `hex` never appear | B: full evidence objects (every status counter, but raw bytes we do not control end up in a shared file); C: evidence minus the hex fields (more counters, and a second shape to keep stable) | Smallest stable format that still carries what FR-07 shows. Raw bytes could hold anything, so leaving them out is the privacy default | cheap (additive later) | agent |
| D-6 | Node block contents | `public_key, reported_name, label, role (effective), reported_role, last_heard_at`. No advertised position | B: include `position` (useful for maps, but the node's location ends up in a shared file, and redaction would need a second category) | D-08 includes labels and says nothing about location. Leaving it out is additive to change later. Telemetry samples keep their `extra` values as recorded (GPS from LPP included), because they are measurements the user asked the node for | cheap | agent |
| D-7 | CSV injection | Text cells (names, labels, reasons and the like) that start with `=`, `+`, `-`, `@`, tab or CR get a leading `'`. Numeric cells are written as numbers, untouched | B: no neutralising (exact text, but a name such as `=HYPERLINK(...)` from the mesh runs in a spreadsheet); C: strip those characters (loses data) | Names come from remote nodes. The OWASP-recommended prefix is the conventional fix and keeps the text readable | costly (changes cell contents in a file format, like D-2) | research |
| D-8 | Where the Zod export schema lives | `apps/mobile/src/application/export/schema.ts`. `ExportController` parses the built report before it writes the file; a parse failure is an export error, and nothing is shared | B: in `packages/domain/src/export` (next to the model, but adds `zod` to domain, which CLAUDE.md says imports nothing); C: in `packages/storage` (wrong layer: nothing is stored) | Keeps domain dependency-free and validates at the boundary where the file leaves the app, as tech-stack's "Zod at every boundary" asks | cheap | agent |
| D-9 | Empty range | With 0 runs in the range the preview reads "No runs recorded in this range", and Share is disabled. This text appears only after a successful read (lesson on empty-data messages) | B: allow sharing a report with only the node block (always possible, but it shares an empty file) | Sharing an empty report helps nobody, and the reason is visible | cheap | agent |
| D-10 | Redaction default before S-09 | `ExportController` takes a port `redactionDefault: () => Promise<boolean>`; composition passes `async () => true`. Every open starts from that default, and the switch changes only the current export | B: hard-code `true` in the controller (S-09 has to touch the controller); C: build the setting now (S-09 scope) | The default is right (D-08), and S-09 changes one line in composition | cheap | agent |
| D-11 | File name and location | `guardian-<keyPrefix>-<from yyyymmdd>-<to yyyymmdd>.<json\|csv>` in `Paths.cache`, replacing an existing file of that name. MIME `application/json` / `text/csv` | B: document directory (persists, but the cache is meant for files we hand to another app); C: full key in the name (leaks the key even with redaction on) | The name never carries more than the prefix, whatever the switch says. The cache is what tech-stack names | cheap | agent |
| D-12 | Share failures | `shareAsync` resolving = done (Android does not report whether the user picked a target). Sharing unavailable → "Sharing is not available on this device". A write or share error → "Could not create the export file", with no claimed cause (lesson on neutral errors). The preview stays on screen | B: retry automatically (pointless for a UI action) | Honest and neutral. Nothing is lost, and the user can tap Share again | cheap | agent |
| D-13 | What the preview shows as "fields" | The manifest from `redact.ts`: for CSV the exact column names, for JSON the field groups (`node`, `runs`, `runs[].checks`, `runs[].telemetry`) with their keys. Plus the redaction lines and the counts. No content excerpt | B: first lines of the actual file (shows real values, but long and unreadable on a phone at 200 % font) | AC2 asks for fields and redactions. Deriving them from the same constants the serialiser uses means the preview cannot drift from the file (a test ties them) | cheap | agent |
| D-14 | How samples are read for the range | `TelemetryRepository.forRuns(runIds)`, called by the controller with the ids `runs.forNodeBetween` returned (plan-review finding 3) | B: `TelemetryRepository.forNodeBetween` (the plan's first design; the range rule would live in two SQL queries) | The range rule lives in one query, and samples can never belong to a run outside the range | cheap | agent |

## Design

### Domain (`packages/domain/src/export/`)
- `report.ts`
  - `EXPORT_SCHEMA_VERSION = 1`.
  - `ExportInput { node: Node; runs: DiagnosticRun[] (with checks); samples: TelemetrySample[]; range: { from: number; to: number }; generatedAt: number; generatedBy: string }`.
  - `ExportReport`: the D-1 object as a plain TS type (snake_case keys, ISO strings).
  - `buildReport(input, { redactKeys: boolean }): ExportReport`. Runs are sorted by
    `finishedAt`, then id, ascending. Samples are attached to their run by `runId`, ordered by
    `checkSeq`; a sample whose run is not in `runs` is dropped. Every key passes through
    `exportKey`. Evidence is not read (D-5).
- `redact.ts`
  - `exportKey(publicKey, redactKeys): string`: `keyPrefix(publicKey)` when redacting, else the
    key unchanged.
  - `JSON_FIELDS` (groups → keys) and `exportManifest(format, redactKeys)`:
    `{ fields: string[] | {group, keys}[], redactions: ("PUBLIC_KEYS_PREFIX" | "PUBLIC_KEYS_FULL")[], neverIncluded: ["CREDENTIALS", "RAW_FRAMES"] }`.
- `serialize.ts`
  - `CSV_COLUMNS` (in this order): `schema_version, node_public_key, node_name, node_label,
    run_id, started_at, finished_at, duration_ms, result, reason, attempts_used,
    attempts_per_check, companion_public_key, companion_name, companion_firmware, voltage_v,
    uptime_s, rssi_dbm, rssi_scope, snr_db, snr_scope, noise_floor_dbm, checks, limitations`.
    `checks` cell: `login=RESPONDED/OK;status=NO_RESPONSE/TIMEOUT`, using `kind=result/reason`.
    `limitations` cell: the same format.
  - `toJson(report): string`: `JSON.stringify(report, null, 2) + "\n"`.
  - `toCsv(report): string`: header + one row per run, CRLF, RFC 4180 quoting, D-7 prefix on
    text cells, `null` → empty cell.
- Index exports these plus the types.
- Invariants (tested): with `redactKeys: true` no 64-hex string appears in either output; with
  `false` both keys appear in full; the manifest's CSV fields equal `CSV_COLUMNS`, and the JSON
  groups equal the keys of a built report.

### Storage
- `DiagnosticRunRepository.forNodeBetween(publicKey, from, to): Promise<DiagnosticRun[]>`:
  runs with `from ≤ finished_at ≤ to`, oldest first, **with checks** (one query for runs, one for
  their checks by `run_id IN (…)`; no N+1).
- `TelemetryRepository.forNodeBetween(publicKey, from, to): Promise<TelemetrySample[]>`:
  samples of the same runs (joined on the run's `finished_at`), ordered by run id and `check_seq`.
- Both return `[]` for an unknown key, and throw on a row that fails its existing Zod parse.

### App
- `application/export/ports.ts`: `ExportFilePort { available(): Promise<boolean>; share(file: { name: string; mimeType: string; content: string }): Promise<void> }`.
- `application/export/schema.ts`: `exportReportSchema` (Zod 4, strict objects). Refinement:
  when `redaction.public_keys === "prefix"` every key field matches `/^[0-9a-f]{8}$/`; when
  `"full"`, `/^[0-9a-f]{64}$/`.
- `application/export/export-controller.ts`: `ExportController` with a Zustand vanilla store
  `{ publicKey, days: 7|30|90, format: "json"|"csv", redactKeys, status: "loading"|"ok"|"error", loaded, input: ExportInput | null, share: "idle"|"sharing"|"unavailable"|"failed" }`.
  Ports: `nodes`, `runs`, `telemetry` (repository factories as in `NodeHistoryController`),
  `files: ExportFilePort`, `clock`, `redactionDefault`, `generatedBy`.
  - `open(publicKey)`: idempotent for the same key, so a remount does not reset the user's
    choices (lesson). A new key resets to defaults (30 days, JSON, `redactionDefault()`), then reads.
  - `setDays(d)` re-reads. `setFormat` / `setRedactKeys` only rebuild the preview. A read that
    finishes after a newer read started is discarded (sequence counter).
  - `share()`: takes the current input and options **at call time** (lesson on capturing
    context), builds the report, parses it with the schema, serialises it, then calls
    `files.available()` and `files.share()`. Refused while 0 runs or a share is in flight.
- `application/export/presenter.ts`: `exportPreview(state, formatTime)` → texts as i18n keys:
  range line, counts, the field list from `exportManifest`, redaction lines, the never-included
  line, the empty-range notice (only when `loaded`), the share-button state and its reason.
- `platform/export-files.ts`: `ExpoExportFiles implements ExportFilePort` (File/Paths +
  Sharing). Used in both modes: only the radio is faked.
- Route `app/export/[id].tsx`, registered in `_layout.tsx` with the title "Export". On the node
  screen, an `Export` secondary button below the run panel.

### Error model
| Situation | Shown | Share |
|-----------|-------|-------|
| reading runs/samples fails | "Could not read the stored history" (alert); no counts, no empty notice | disabled |
| node unknown | "Node not found" (existing `nodes.notFound`) | disabled |
| 0 runs | "No runs recorded in this range" | disabled (D-9) |
| schema parse fails | "Could not create the export file" | stays enabled |
| sharing unavailable | "Sharing is not available on this device" | stays enabled |
| write/share throws | "Could not create the export file" | stays enabled |

## Phases

### Phase 1: Export model, redaction and serialisers in the domain
- Files:
  - `packages/domain/src/export/report.ts` (new): `EXPORT_SCHEMA_VERSION`, `ExportInput`,
    `ExportReport`, `buildReport`. Contract: D-1 shape, ordering and the sample-to-run rule above.
  - `packages/domain/src/export/redact.ts` (new): `exportKey`, `JSON_FIELDS`, `exportManifest`.
  - `packages/domain/src/export/serialize.ts` (new): `CSV_COLUMNS`, `toJson`, `toCsv`.
    Contract: RFC 4180 + D-7.
  - `packages/domain/src/export/fixtures.ts` (new, test support): one node, three runs (one
    responded with status + telemetry samples, one `NO_RESPONSE`, one with a login check that
    sent a password), with fixed times. Names include a comma, a quote and a leading `=`.
  - `packages/domain/src/export/golden/{report-redacted,report-full}.{json,csv}` (new).
  - `packages/domain/src/export/export.test.ts` (new):
    - golden: `toJson` / `toCsv` with redaction on and off equal the four files, loaded with
      `import.meta.glob("?raw")` (TR-10);
    - redaction on → no `/[0-9a-f]{64}/` in either output; node and companion keys are 8 chars;
      redaction off → both full keys present (AC3);
    - `schema_version` present in JSON and in every CSV row;
    - CSV: quoting of comma, quote, CR/LF; `'` prefix on `=`/`+`/`-`/`@`/tab text; negative RSSI
      stays numeric; `null` → empty; CRLF line ends;
    - ordering: runs ascending by `finishedAt` with id ties; samples attached by `runId`, sorted by
      `checkSeq`; orphan sample dropped; per-field first non-null rule for CSV telemetry (D-2);
    - no `evidence`, `lppHex` or `hex` key in the JSON (D-5); `passwordSent` never appears;
    - manifest: CSV fields equal `CSV_COLUMNS`; JSON groups equal the keys of a built report;
      redaction entry follows the flag.
  - `packages/domain/src/index.ts`: exports.
  - `context/test-plan.md`: mutation row → `packages/domain/src/export/report.ts`, `redact.ts`,
    `serialize.ts`; TR-10 test names.
- Proves: FR-13 AC3 (unit), AC2 data source (manifest, unit), roadmap golden files and
  `schema_version` (unit), TR-10.
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`.
- Human checks: none.

### Phase 2: Range reads in storage
- Files:
  - `packages/domain/src/diagnostics/run.ts`: `forNodeBetween(publicKey, from, to)` on
    `DiagnosticRunRepository`. Contract: inclusive `finishedAt` range, oldest first, with checks.
  - `packages/domain/src/telemetry/ports.ts`: `forNodeBetween(publicKey, from, to)` on
    `TelemetryRepository`. Contract: samples of exactly those runs, by run id and `checkSeq`.
  - `packages/storage/src/diagnostics/run-repository.ts`, `packages/storage/src/telemetry/telemetry-repository.ts`:
    implementations (two queries for runs + checks, no N+1).
  - `packages/storage/test/run-repository.int.test.ts`, `packages/storage/test/telemetry-repository.int.test.ts`:
    runs on both edges of the range included, one ms outside excluded; another node's runs
    excluded; checks in `seq` order with evidence; samples only of runs in range; unknown key → `[]`;
    a corrupt row throws.
- Proves: FR-13 AC1 data (range selection, integration).
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`.
- Human checks: none.

### Phase 3: Export controller, schema and presenter
- Files:
  - `apps/mobile/src/application/export/ports.ts` (new): `ExportFilePort`.
  - `apps/mobile/src/application/export/schema.ts` (new): `exportReportSchema` with the key
    refinement (D-8).
  - `apps/mobile/src/application/export/export-controller.ts` (new): as in *Design*.
  - `apps/mobile/src/application/export/presenter.ts` (new): `exportPreview`.
  - `apps/mobile/src/application/export/schema.test.ts` (new): both golden JSON files parse;
    a full key under `"prefix"` and a prefix under `"full"` are rejected; unknown keys are rejected.
  - `apps/mobile/src/application/export/export-controller.int.test.ts` (new), real storage on
    `node:sqlite`, a minimal `ExportFilePort` double (lesson: write a port double, not a shared fake):
    - default open: 30 days, JSON, redaction from the port; runs older than 30 days excluded (AC1);
    - `setDays(7|90)` changes the counts; a slow earlier read does not overwrite a later one;
    - `open` twice with the same key keeps the user's choices; a new key resets them;
    - share writes `guardian-<prefix>-<from>-<to>.json|csv` with the right MIME type and content
      that equals `toJson`/`toCsv` of the built report (AC5 at the port);
    - redaction off → the shared content has the full keys; on → none (AC3);
    - **leak canary (AC4, TR-09):** save `pw-LEAK-CANARY` through `GuestPasswords` (in-memory
      `SecretStore`), run a diagnostic with `RunController` on the fake transport so the login
      sends it, then share in both formats with redaction on and off. No output contains the
      canary or any value held in the `SecretStore`;
    - 0 runs → share refused, no port call; repository throws → `status: "error"`, no empty notice;
      the port's `available()` false → `unavailable`, no write; `share` throws → `failed`; the
      schema rejecting → `failed`, no port call;
    - the context captured at `share()`: changing the format while a share is in flight does not
      change the file being shared.
  - `apps/mobile/src/application/export/presenter.test.ts` (new): counts and range line; CSV field
    list equals `CSV_COLUMNS`; redaction line follows the flag; the never-included line is always
    there; the empty notice only when `loaded` (lesson); button disabled reasons.
  - `context/test-plan.md`: TR-09 row → covered (S-08); mutation-target row for
    `apps/mobile/src/application/export/export-controller.ts`.
- Proves: FR-13 AC1 (default range, integration), AC2 (preview model, unit), AC3 (integration),
  AC4 (integration, TR-09), AC5 (port call, integration).
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`.
- Human checks: none.

### Phase 4: Export screen, share platform and node-screen button
- Files:
  - `apps/mobile/package.json`, lockfile: `expo-file-system` 57.0.7 and `expo-sharing` 57.0.22
    via `npx expo install` (versions from tech-stack). Add a config plugin to `app.json` only if
    the module's docs require one for sharing out (`[minor]` if needed).
  - `apps/mobile/src/platform/export-files.ts` (new): `ExpoExportFiles` (D-11, D-12).
  - `apps/mobile/src/composition/index.ts`: `exporter: new ExportController({...})` with
    `redactionDefault: async () => true` (D-10) and `generatedBy` from `expo-constants`.
  - `apps/mobile/src/app/export/[id].tsx` (new): header with the node name; a `Segmented` for
    7/30/90 days and one for JSON/CSV; a "Full public keys" `Switch` with an accessibility label;
    the preview card; the Share button (`testID="export-share"`); alerts for the error model.
    Text never relies on colour alone.
  - `apps/mobile/src/app/_layout.tsx`: register `export/[id]` with the title.
  - `apps/mobile/src/app/node/[id].tsx`: an `Export` secondary button (download icon if
    `icons.tsx` has one, otherwise none, `[minor]`) under the run panel, linking to
    `/export/<key>`.
  - `apps/mobile/src/i18n/en.json`: `export.*` strings. `apps/mobile/src/i18n/catalog.test.ts`:
    every key the presenter can return exists.
  - Lesson check: grep `apps/mobile/e2e/*.yaml` for assertions on run rows (`run-row`, `History`)
    that the extra header height could push below the fold, and adjust them with `scrollUntilVisible`.
- Proves: FR-13 AC1, AC2 (screen, by e2e in phase 5), AC5 (real share sheet: human check).
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm e2e` (full suite, because the
  node header grew).
- Human checks: none here; they are collected in phase 5.

### Phase 5: e2e flow, evidence and human checks
- Files:
  - `apps/mobile/e2e/export-report.yaml` (new): `connect-diag` (diag-ok), then
    `guardian://debug/seed/voltage-history`, tap **Export**. Assert "Last 30 days" selected, the
    run count of the seed, the line "Public keys: shortened to a 4-byte prefix" and the
    never-included line. Switch to CSV and assert the `companion_public_key` column name (an element
    only the preview renders, lesson). Turn on full keys and assert the redaction line changes.
    Pick 7 days. `takeScreenshot: export-preview`. Tap Share, `takeScreenshot: export-share-sheet`,
    `back`. Assert the preview is still shown and that back returns to the node screen (back stack).
  - `context/changes/export-report/evidence/`: the two screenshots (< 300 KB each), plus
    `sample-redacted.json` and `sample-redacted.csv` copied from the golden files for the reviewer.
  - `context/changes/export-report/plan.md`: *Human checks* filled.
- Proves: FR-13 AC1, AC2 (e2e), AC5 (share sheet opens on the emulator, screenshot).
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm e2e`.
- Human checks:
  - On a real phone with the CI APK (`android-apk` artifact): run one diagnostic, open Export,
    choose CSV, tap Share, send it to a files or mail app. The file opens in a spreadsheet with
    one row per run, and the keys are 8 characters.
  - Same, JSON with "Full public keys" on: the file contains the 64-character node key, and no
    guest password (search the file for the password you saved).
  - Wording and layout of the preview (field list, redaction lines) at 200 % font scale.

## Risks and unknowns
- The Android share sheet on the emulator may look different from a phone's, or need a Google
  app to show targets. The e2e asserts only up to tapping Share, and AC5 on a real phone is a
  human check.
- expo-sharing with a `file://` cache URI relies on the module's FileProvider. If Android
  rejects it, use `File.contentUri` (Android-only property) and log it as `[minor]`.
- Adding two native modules changes the APK. `pnpm e2e` rebuilds it, so phase 4 cannot use
  `E2E_SKIP_BUILD=1`.
- The CSV format (D-2) and the JSON shape (D-1) are contracts. They are kept in `report.ts`,
  `serialize.ts` and `schema.ts` so that a PR decision changes those files and the golden files only.
- The extra button on the node screen may push run rows below the fold in existing flows (lesson).
  Phase 4 runs the full e2e suite.

## Progress
<!-- One line per phase. /implement ticks it in the phase's own commit. -->
- [x] Phase 1: Export model, redaction and serialisers in the domain
- [x] Phase 2: Range reads in storage
- [x] Phase 3: Export controller, schema and presenter
- [x] Phase 4: Export screen, share platform and node-screen button
- [x] Phase 5: e2e flow, evidence and human checks

## Human checks
<!-- Filled by /implement: one open checkbox per human check, with how to run it and evidence. -->
- [ ] (Phase 5) CSV share on a real phone: run one diagnostic, open Export, choose CSV, tap Share, send to a files or mail app; the file opens in a spreadsheet with one row per run and 8-character keys — run: CI APK (`android-apk` artifact) — evidence: none (emulator sheet: `evidence/export-share-sheet.png`, sample: `evidence/sample-redacted.csv`)
- [ ] (Phase 5) JSON with "Full public keys" on: the file has the 64-character node key and no guest password (search the file for the password you saved) — run: CI APK, Export > JSON > Full public keys > Share — evidence: `evidence/sample-redacted.json` (redacted shape)
- [ ] (Phase 5) Wording and layout of the preview (field list, redaction lines) at 200 % font scale — run: CI APK, system font size largest, open Export — evidence: `evidence/export-preview.png` (default scale)

## Deviations
<!-- [minor] / [REVIEW] / [FOLLOW-UP] / [STUCK] entries, see autonomy.md section 3 -->
- [minor] Phase 1: plan-review finding 1 (empty companion key). The report exports `companion.public_key` as `null` for a run stored with an empty companion identity (CSV: empty cell). Phase 3's schema refines non-null keys only. Fixture run 3 and tests cover it.
- [minor] Phase 1: plan-review finding 4 (golden files). Generated once from the fixtures with a throwaway test, then checked by hand against the fixture values (times, voltage 3.353, uptime 2837, RSSI -34, SNR 13.25, noise floor -110, empty companion on run 3, quoting and `'` prefix of the node name and label). `ImportMeta.glob` is declared ambiently in `export.test.ts`, as in the adapter test.
- [minor] Phase 1: plan-review finding 6. CSV `node_name` is `reportedName`, `node_label` is `userLabel`, and all CSV times are ISO 8601 UTC like the JSON. Added to the file contract here (D-2 text unchanged).
- [minor] Phase 1: `ExportFormat` / `EXPORT_FORMATS` live in `redact.ts` (the manifest needs them); the JSON manifest has an extra group `runs[].companion` and a root group `report`; `mutation` target list gains `report.ts` (test-plan and `stryker.targets`).
- [minor] Phase 2: plan-review findings 2 and 3. `TelemetryRepository` gets `forRuns(runIds)` instead of `forNodeBetween` (D-14); Phase 3's controller reads runs first, then `telemetry.forRuns(runs.map(r => r.id))`. `run-controller.int.test.ts` (`MemoryRuns`) and `node-history.int.test.ts` (telemetry literal) got the new methods. Both repositories read ids in batches of 500 (SQLite variable limit), so a 90-day range cannot hit it.
- [minor] Phase 3: the controller status gets a fourth value `notFound` (plan: `loading|ok|error`) so an unknown node reads "This node is not in local storage" (`nodes.notFound`) instead of an empty range. The presenter returns `problem` for `error` and `notFound` and then no counts and no empty notice. Catalog keys it returns (`export.*`) are added with the screen in Phase 4.
- [minor] Phase 3: `open` on the same key after an `error` reads again (plan: idempotent for the same key); otherwise the screen could not retry. If `redactionDefault()` throws, redaction stays on. `stryker.targets` gains `export-controller.ts`.
- [minor] Phase 3: `schema.test.ts` loads the domain golden JSON files from `packages/domain/src/export/golden` by relative `import.meta.glob`; `domain/fixtures.ts` is not exported from the domain package.
- [minor] Phase 4: plan-review finding 5. The Export button sits under the run panel as the plan says, not in a two-column row next to *Run diagnostic* as in the mockup (the run panel is a card with its own states, so a row would split it). It has the mockup's download icon (`download` added to `icons.tsx` / `IconName`).
- [minor] Phase 4: plan-review finding 7. `ExpoExportFiles` writes with `create({ overwrite: true })`, so a second share of the same range replaces the file. `expo install` added the `expo-sharing` config plugin to `app.json`; its reformatting of the file was reverted so only that one line changed.
- [minor] Phase 4: the export screen lists JSON fields as `group: key, key` lines and CSV columns as one comma line (testID `export-fields`). `catalog.test.ts` covers every key `exportPreview` can return plus the screen's static ones.
- [minor] Phase 4: lesson on header height. The Export button made the node page taller and broke three flows (`diag-responded`: "Show values" below the fold; `guest-password`, `guest-password-admin`: the run button, and the airtime notice's confirm button, scrolled off). Added `scrollUntilVisible` steps in those three flows. Full suite: 21/21 passed.
- [minor] Phase 5: `export-report.yaml` scrolls to each preview text (the preview card is below the fold) instead of asserting directly; the node screen's Export button got `testID="export-open"`. The flow asserts Share was tapped and the share sheet screenshot shows it opening on the emulator (Quick Share, Drive, Gmail). Full suite: 22/22 (21 on the full run plus this flow rerun after the scroll fix).
- [REVIEW] Mutation: `ExportController.open` called twice at once on a key the controller has not opened yet starts two reads. `state.publicKey` is set only after `await redactionDefault()`, so the second call finds no key and no in-flight guard (`opening` is consulted only after that point). Local DB reads only, no radio, and the later read wins by `seq`, but it contradicts "idempotent for the same key" (lessons). Fixed in review round 1 (R2): `open` records the pending key synchronously; test added.

## Review response
<!-- revise mode only: one line per plan-review finding and what changed -->
Applied while implementing (no separate revise run). Phase 1: finding 1, 4, 6 (see Deviations). Finding 8: D-7 is `costly` for the PR reviewer. Findings 2, 3 applied in Phase 2 (see Deviations, D-14). Findings 5, 7 are for phase 4.
Review round 1: R1 added `ExportController.close()`, called from the screen's effect cleanup, so each visit starts from D-10's defaults and reads again. R3 (share the same range twice) is now a step in `export-report.yaml`; R4 asserts the selected state of the 7-day option.
