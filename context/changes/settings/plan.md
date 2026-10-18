# Plan: settings (S-09)

Issue: #10

## Goal and end state
The Settings screen stops being a placeholder. When this change is done:

- Settings shows and saves: a timeout override (Auto, or whole seconds from 5 to 60), attempts per
  check (1, 2 or 3), and the export redaction default (on by default). It also shows the app version
  and the connected companion's model, firmware version and build date (FR-15 AC1). Values survive
  a force stop.
- A diagnostic run uses the saved timeout and attempts (FR-10 AC3/AC4 via Settings). The Export
  screen opens with the saved redaction default (FR-13 AC3 "default settings").
- An out-of-range or non-numeric timeout is rejected, and the message states the allowed range
  (FR-15 AC3). The value that was in use before stays in use.
- Settings lists the nodes that have stored history. "Delete history" (after a confirmation)
  removes that node's runs, checks and telemetry samples, its user label and role, and its guest
  password. "Clear all data" (after a confirmation) removes every node, run, check, sample, the sync
  origin and every guest password (FR-15 AC2, FR-14 AC3, D-12, TR-21).
- Deleting history does not reset the 60 s cooldown of a node tested moments ago (FR-10 AC2).

## Scope
- In:
  - settings model (Zod schema), persistence in `expo-sqlite/kv-store`, `SettingsController`;
  - wiring the stored policy into `RunController` and the redaction default into `ExportController`;
  - a `DataEraser` repository port and its SQLite implementation; a `DataDeletion` use-case that
    also removes secrets and refreshes the in-memory controllers;
  - the Settings screen (S-12 theme and components), its i18n keys, e2e flows and screenshots;
  - test-plan TR-20/TR-21 status and mutation targets for the new application modules.
- Out:
  - theme switch, distance units, language (not in FR-15) → no work;
  - deleting a single run, automatic retention (D-12: no automatic cleanup);
  - remembering the companion's firmware while disconnected (only the live handshake is shown, D-6);
  - a "Remove from dashboard" action (sync-contacts follow-up, not this item).

## Findings
- `apps/mobile/src/app/settings.tsx:8-17` renders `PlaceholderScreen` with `settings.placeholder`
  and the transport line `settings.transport` (`en.json:61-65`). `e2e/smoke.yaml` asserts
  "Transport: Fake (development)", so that line stays.
- Policy: `DiagnosticPolicy { attempts; overrideMs: number | null }` and
  `DEFAULT_DIAGNOSTIC_POLICY = { attempts: 2, overrideMs: null }` in
  `packages/domain/src/policy/retry.ts:5-10`; ranges `ATTEMPTS_RANGE = [1, 3]` (`retry.ts:3`) and
  `OVERRIDE_RANGE_MS = [5_000, 60_000]` (`timeout.ts:5`). `attemptTimeout` throws a `RangeError` on
  an out-of-range override (`timeout.ts:19-25`): "settings validate it first".
- `RunController` reads `this.ports.policy()` synchronously when a run starts
  (`run-controller.ts:165`) and again for `attemptsPerCheck` when it saves (`:263`). Composition
  passes `policy: () => DEFAULT_DIAGNOSTIC_POLICY` (`composition/index.ts:80`).
- `ExportController` already has an async port `redactionDefault: () => Promise<boolean>` and falls
  back to `true` when it throws (`export-controller.ts:42, 163-172`); composition passes
  `async () => true` with the note "until the Settings default exists (plan D-10, S-09)"
  (`composition/index.ts:65-66`).
- Small persisted preferences already live in `expo-sqlite/kv-store`:
  `KvAirtimeNoticeStore` (`platform/airtime-notice-store.ts`, key `notice.airtime.seen`) and
  `KvLastCompanionStore` (`platform/last-companion-store.ts`, key `companion.last`, parsed by a pure
  tested function in `platform/last-companion.ts`).
- Secrets: `GuestPasswords.remove(publicKey)` and `clearAll()` exist and are tested (S-05 D-2/D-3);
  `clearAll` throws on failure "so S-09 can report it" (`guest-passwords.ts:107-115`). S-05 left a
  `[FOLLOW-UP]`: S-09's delete flows must call them (`guest-password/plan.md:229`).
- Schema (`packages/storage/migrations/0001-0004`): `devices` (user columns `user_label`,
  `user_role`, `dashboard_pinned`), `diagnostic_runs → devices ON DELETE CASCADE`,
  `diagnostic_checks → diagnostic_runs ON DELETE CASCADE`, `telemetry_samples → devices` and
  `→ diagnostic_checks ON DELETE CASCADE`, `contact_sync_origin` (single row). The app enables
  `PRAGMA foreign_keys = ON` (`open-guardian-db.ts:11`); the `node:sqlite` test helper does not
  necessarily, so the eraser deletes child rows explicitly (D-8).
- No repository has a delete method today (`NodeRepository` in `domain/src/nodes/ports.ts`,
  `DiagnosticRunRepository` in `domain/src/diagnostics/run.ts:31-45`, `TelemetryRepository`).
- In-memory caches that a deletion must refresh: `NodesController` (`load()` is memoised,
  `reload()`/`refresh()` are private, `nodes-controller.ts:92-205`), `RunController.latest` (filled
  by private `reload()`, `run-controller.ts:313-321`), `NodeHistoryController.byNode`
  (`node-history.ts:57-80`).
- Cooldown is computed from `RunController.latest[publicKey]` (`run-controller.ts:290-293`,
  `domain/src/policy/cooldown.ts`). Reloading `latest` after a deletion would drop the entry and
  lift the cooldown.
- Companion info: `CompanionInfo { name, model, firmwareVersion, firmwareVerCode, buildDate, … }`
  (`domain/src/companion/companion.ts:4-13`) is in the session's `connection.companion` while
  connected; `SessionState.firmwareTested` (`companion-session.ts:43`). App version:
  `Constants.expoConfig?.version` (already used in `composition/index.ts:67`).
- Existing UI parts to reuse: `AppButton` with `variant: "primary" | … | "danger"`
  (`components/ui/button.tsx`), `Segmented` (`components/ui/segmented.tsx`), `Card`, `Screen`,
  `BottomNav current="settings"`; the Export screen uses a `Switch` for redaction
  (`app/export/[id].tsx:83`).
- Result texts that make the policy visible in e2e: `"Waited {{seconds}} s (your setting)"`
  (`en.json:218`) and `"Requests sent: {{used}} (up to {{per}} per check)"` (`en.json:253`).
- Lessons that bind this plan: idempotent screen-effect calls (`load()`); never render "none"/
  default values from a loading or error state; capture context at operation start; neutral reason
  for unknown errors; grep every e2e flow that touches a changed screen; re-take screenshots when
  text changes; Run mutation on every test-plan target the diff touches (`run-controller.ts`,
  `guest-passwords.ts` if touched).
- Library facts: `expo-sqlite/kv-store` exposes `getItem/setItem/removeItem` (async, string values);
  React Native `Alert.alert(title, message, buttons)` shows a native dialog that Maestro taps by
  button text. Zod 4 `z.strictObject`, `z.number().int().min().max()`.

## Decisions
| ID | Question | Chosen | Alternatives (and what they would buy) | Why | Reversal | Decided by |
|----|----------|--------|----------------------------------------|-----|----------|------------|
| D-1 | Where are settings stored? | One JSON value under key `settings` in `expo-sqlite/kv-store`: `{ "version": 1, "timeoutOverrideS": number \| null, "attempts": 1\|2\|3, "redactKeys": boolean }`, parsed with a Zod strict schema. Only `platform/settings-store.ts` knows the key | B: a `settings` table in a new migration 0005. Typed columns and part of "clear all", but a migration for three values. C: one KV key per value. No JSON parsing, but three reads and partial writes | Follows the two existing KV preference stores; one file to swap. The `version` field lets a later shape change migrate in code | costly (persisted data shape) | agent |
| D-2 | What happens when the stored value is unreadable (bad JSON, out-of-range value)? | Use the defaults, keep running, show "Saved settings could not be read. Defaults are in use." until the next successful save, which overwrites the bad value | B: reject only the bad field and keep the rest. Keeps more, but a half-valid blob is a sign of a bug, not a user choice. C: delete the value at load. Silent | An invalid override would make `attemptTimeout` throw; defaults are the PRD values. The note keeps it honest | cheap | agent |
| D-3 | Timeout input | A numeric text field (whole seconds) with Save, plus an "Auto" button. Accept only `^\d+$` after trimming, 5–60. Anything else (empty, `4`, `61`, `12.5`, `abc`) is rejected with "Enter whole seconds from 5 to 60." and the field keeps the text | B: stepper or segmented presets (10/20/30/60). Out-of-range impossible, so AC3 would only be a schema test. C: accept decimals. Finer, but the radio cannot use sub-second precision meaningfully | AC3 talks about a rejected out-of-range value, so the input must allow one. Whole seconds match the "5–60 s" wording | cheap | agent / prd |
| D-4 | Attempts input | `Segmented` with 1, 2, 3; the schema still rejects other values (TR-20) | B: text field like the timeout. Allows typing 0 or 4 only to reject it | Three options fit a segmented control; reuses S-12 components | cheap | agent |
| D-5 | When is a changed setting applied? | Immediately on save: `policy()` reads the controller's current state when a run starts. A run already in flight keeps the policy it started with (it is read once at start, `run-controller.ts:165`) | B: apply on next app start. Simpler state, but confusing | Matches the existing synchronous port; no contract change | cheap | agent |
| D-6 | Companion firmware info while disconnected | Show "Connect a companion to see its firmware." Connected: name, model, firmware version, build date, and the existing untested-firmware note when `firmwareTested === false` | B: show the last known firmware from the newest stored run (`companion_firmware`). Works offline, but it is history, not the current device, and only the version string is stored | Honest: the screen states only what the live handshake reported | cheap | agent |
| D-7 | What does "Delete history" of one node remove? | All its runs, checks and samples; `user_label` and `user_role` set to NULL; its guest password. The `devices` row stays (it is the companion's contact data and the next sync would recreate it anyway); `dashboard_pinned` stays (a dashboard choice, not history) | B: delete the `devices` row (cascade). One statement, but the node disappears from the Dashboard until the next sync and a pinned chat contact is lost. C: keep the label. Contradicts AC2 "labels are removed" | AC2 names runs, samples and labels; the roadmap adds secrets. Keeping the row avoids a node vanishing while it is still in the companion's contacts | costly (deletes data) | agent / prd |
| D-8 | How are rows deleted? | New domain port `DataEraser { eraseNodeHistory(publicKey); eraseAll() }`, implemented in `packages/storage/src/data/data-eraser.ts`. Each method runs in one transaction and deletes child rows explicitly (samples → checks → runs → …), so it does not depend on `PRAGMA foreign_keys`. `eraseAll` empties `telemetry_samples`, `diagnostic_checks`, `diagnostic_runs`, `devices`, `contact_sync_origin`; the `schema_version`/migration bookkeeping stays | B: add delete methods to each existing repository. Spreads one transaction over three classes. C: delete the database file. Total, but the open handle and migration state need special care | One port, one file, one transaction per action; easy to test on `openTestDb` | costly (deletes data) | agent |
| D-9 | What does "Clear all data" cover? | Every database row listed in D-8 and every guest password (`GuestPasswords.clearAll`). Preferences stay: settings, the airtime-notice flag and the remembered companion. The confirmation text says so | B: also reset settings, the notice flag and the remembered companion ("like a fresh install"). More thorough, but resets choices the user did not ask to lose, and the live session holds the remembered companion in memory | AC2 names runs, samples and labels; secrets are required by FR-14 AC3. The narrower set is the cheaper to widen later; the wording keeps it honest | cheap | agent / prd |
| D-10 | Order of rows vs secret, and partial failure | Rows first (one transaction), then the secret. Rows fail → "Could not delete the stored data. Nothing was removed." Secret fails → "History deleted, but the guest password could not be removed. Try again." Both actions are idempotent, so Try again repeats the whole action | B: secret first. A row failure would then leave history without its password, which the user cannot see | Every failure is reported with what did and did not happen; retry is safe | cheap | agent |
| D-11 | Deleting while a run or a contact sync is active | Refuse: both buttons are disabled and show "Wait until the running check or sync has finished." `DataDeletion` also re-checks and returns `BUSY` | B: allow and let the run save into a cleared database. The save would fail or re-create a half record | A run captures its context at start (lesson) and saves at the end; erasing under it gives a confusing result | cheap | agent |
| D-12 | Must deleting history lift the cooldown? | No. `RunState.lastRequestAt` (`publicKey → finish time of the last run that sent requests`, filled when a run finishes) is kept in state; the exported `cooldownMs(state, publicKey, now)` takes the larger of it and the `latest`-based value, and `RunController.start` and both screens (node screen, nearest card) call it, so the Run button stays disabled after a deletion (plan-review finding 1) | B: let the reload of `latest` lift it. Simpler, but "delete history" becomes a way around FR-10 AC2 | Radio hygiene (CLAUDE.md) outranks simplicity; the map is local to `RunController` | cheap | agent |
| D-13 | Which nodes does the "Delete history" list show? | Nodes with at least one stored run (`RunController.latest`) or a user label or role, sorted like the Dashboard; empty → "No node has stored history." (only after both stores loaded without error) | B: every known node (300+ contacts). C: a "Delete history" button on the Node screen. Closer to the data, but AC2 places it in Settings | Short list of exactly the nodes the action affects | cheap | agent / prd |
| D-14 | Confirmation UI | Native `Alert.alert` with Cancel and a destructive "Delete" / "Clear all data" button; the message names the node (or "all nodes") and lists what goes | B: an in-screen confirm card. Themed, but more code and state | Native, accessible, testable with Maestro by button text | cheap | agent |

## Design

### Settings model (`apps/mobile/src/application/settings/settings.ts`, pure)
- `interface Settings { timeoutOverrideS: number | null; attempts: number; redactKeys: boolean }`,
  `DEFAULT_SETTINGS = { timeoutOverrideS: null, attempts: 2, redactKeys: true }` (attempts from
  `DEFAULT_DIAGNOSTIC_POLICY`).
- `settingsSchema` (Zod strict, `version: z.literal(1)`), bounds derived from `OVERRIDE_RANGE_MS`
  (÷ 1000) and `ATTEMPTS_RANGE`, never re-typed.
- `parseStoredSettings(raw: string | null): { settings: Settings; unreadable: boolean }`: `null` →
  defaults, not unreadable; bad JSON or schema failure → defaults, unreadable.
- `serializeSettings(s: Settings): string`.
- `parseTimeoutInput(text: string): { ok: true; seconds: number } | { ok: false; reason: "OUT_OF_RANGE"; min: 5; max: 60 }`.
- `toPolicy(s: Settings): DiagnosticPolicy` (`overrideMs = seconds × 1000`).

### Ports (`apps/mobile/src/application/settings/ports.ts`)
- `SettingsStore { read(): Promise<string | null>; write(raw: string): Promise<void> }` — both
  reject on failure (lesson: every port that starts native work has an error path).
- `DeletionPorts { eraser: () => Promise<DataEraser>; passwords: Pick<GuestPasswords, "remove" | "clearAll">; busy: () => boolean; refresh: { nodes(): Promise<void>; runs(): Promise<void>; history(publicKey: string | null): void } }`.

### `SettingsController` (`settings-controller.ts`)
- Zustand vanilla store `SettingsState { status: "loading" | "ready"; settings: Settings; unreadable: boolean; save: "idle" | "failed" }`.
- `load(): Promise<void>` memoised (idempotent). Read failure → defaults with `unreadable: true`.
- `setTimeout(input: string | "auto"): Promise<SaveResult>`, `setAttempts(n)`, `setRedactKeys(b)`:
  validate → write the whole object → update state only after the write succeeded. Writes run one
  at a time (same serial-tail pattern as `GuestPasswords`). `SaveResult = { ok: true } | { ok: false; reason: "OUT_OF_RANGE" | "STORAGE_ERROR"; range?: [5, 60] }`.
- `policy(): DiagnosticPolicy` (sync, current state; defaults before load), `redactionDefault(): Promise<boolean>` (awaits `load()` first).

### Data deletion
- Domain: `packages/domain/src/data/eraser.ts` — `interface DataEraser { eraseNodeHistory(publicKey: string): Promise<void>; eraseAll(): Promise<void> }`; exported from `index.ts`. Unknown node → no-op.
- Storage: `SqliteDataEraser(driver)` in `packages/storage/src/data/data-eraser.ts`, exported from
  `index.ts`. `eraseNodeHistory`, in one `driver.transaction`: delete from `telemetry_samples`,
  `diagnostic_checks`, `diagnostic_runs` where the run/device belongs to the node, then
  `UPDATE devices SET user_label = NULL, user_role = NULL WHERE public_key = ?`.
  `eraseAll`: delete every row of the five tables in child-first order.
- Application: `DataDeletion` (`apps/mobile/src/application/settings/data-deletion.ts`):
  `deleteNodeHistory(publicKey): Promise<DeletionResult>`, `clearAll(): Promise<DeletionResult>`,
  `DeletionResult = { ok: true } | { ok: false; reason: "BUSY" | "STORAGE_ERROR" | "SECRET_ERROR" }`.
  Flow: `busy()` → `BUSY`; erase rows (throw → `STORAGE_ERROR`, secrets untouched); remove secret(s)
  (throw or `{ ok: false }` → `SECRET_ERROR`); then refresh nodes, runs and history (a refresh
  failure shows up as the controllers' own storage error, not as a deletion failure). A single
  in-flight deletion at a time (a second call while one runs returns the same promise).
- Controller changes: `NodesController.reload(): Promise<void>` (public; re-reads even after
  `load()`), `RunController.refreshLatest(): Promise<void>` and the cooldown memory of D-12,
  `NodeHistoryController.forget(publicKey | null)` (drops cached entries so the next visit reads
  fresh data).

### Settings screen (`apps/mobile/src/app/settings.tsx`) and presenter
- `application/settings/presenter.ts`: `settingsView(settingsState, session, runs, nodes, appVersion)`
  → texts as `Text` (i18n key + params): timeout line ("Timeout: Auto" / "Timeout: 20 s"), attempts,
  redaction line, app version, companion lines (D-6), deletion list (D-13), busy note (D-11).
  While `status === "loading"` it returns a loading view (no "Auto" claim — lesson).
- Sections (Cards): Diagnostics (timeout field `settings-timeout-input`, Save `settings-timeout-save`,
  Auto `settings-timeout-auto`, error text; attempts `Segmented` ids `settings-attempts-1..3`),
  Export (Switch `settings-redact`, label "Shorten public keys in exports"), About (app version,
  companion, transport line), Data (node rows with `settings-delete-<keyPrefix>` buttons; danger
  `settings-clear-all`).
- `_layout.tsx` calls `container.settings.load()` once (idempotent) so `policy()` has the saved
  values before the first run.

## Phases

### Phase 1: Settings model, store and policy wiring
- Files:
  - `apps/mobile/src/application/settings/settings.ts` (+ `settings.test.ts`): schema, parse,
    serialize, timeout input, `toPolicy`. Contract: stored shape of D-1; `parseTimeoutInput`.
  - `apps/mobile/src/application/settings/ports.ts`: `SettingsStore`.
  - `apps/mobile/src/application/settings/settings-controller.ts` (+ `settings-controller.int.test.ts`
    with an in-memory `SettingsStore` double that can fail on read/write): load, save, serial
    writes, `policy()`, `redactionDefault()`.
  - `apps/mobile/src/platform/settings-store.ts`: `KvSettingsStore` on `expo-sqlite/kv-store`, key
    `settings`.
  - `apps/mobile/src/composition/index.ts`: `settings: new SettingsController(...)`;
    `policy: () => settings.policy()`; `redactionDefault: () => settings.redactionDefault()`.
  - `apps/mobile/src/app/_layout.tsx`: `void container.settings.load()` in a mount effect.
  - `apps/mobile/src/application/diagnostics/run-controller.int.test.ts`: one case: a policy port
    backed by a `SettingsController` with override 5 s / attempts 1 reaches `session.runChecks` and
    the saved run's `attemptsPerCheck`.
- Proves: TR-20 (unit: 4/5/60/61 s, `12.5`, `abc`, empty; attempts 0/1/3/4; non-boolean redaction;
  unknown key; wrong `version`), FR-15 AC3 at use-case level (rejected value leaves the old one in
  state and store), D-2 (unreadable → defaults + flag), persistence round-trip through the store
  double, FR-10 AC3/AC4 wiring (integration).
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`.
- Human checks: none.

### Phase 2: Data deletion
- Files:
  - `packages/domain/src/data/eraser.ts`, `packages/domain/src/index.ts`: `DataEraser` port.
  - `packages/storage/src/data/data-eraser.ts`, `packages/storage/src/index.ts`: `SqliteDataEraser`.
  - `packages/storage/test/data-eraser.int.test.ts`: on `openTestDb`, two nodes with runs, checks,
    samples, labels, roles, a pin and a sync origin. `eraseNodeHistory(A)` leaves A's row (label and
    role NULL, pin kept) and all of B; `recentForNode(A)`, `latestForNode(A)`, `voltageForNode(A)`
    are empty. `eraseAll` leaves all five tables empty and the database still migrated (a new sync
    and save work). Unknown key is a no-op. A failing statement rolls the transaction back.
  - `apps/mobile/src/application/settings/data-deletion.ts` (+ `data-deletion.int.test.ts` with the
    real `SqliteDataEraser` on `openTestDb`, the real `GuestPasswords` on an in-memory
    `SecretStore`, and minimal port doubles that throw, per lesson): ok path removes rows and the
    secret (the `SecretStore` has no key left after `clearAll`, TR-21); `BUSY`; `STORAGE_ERROR`
    leaves the secret; `SECRET_ERROR` after rows are gone; refreshes are called; concurrent calls
    share one run.
  - `apps/mobile/src/application/nodes/nodes-controller.ts`: public `reload()`.
  - `apps/mobile/src/application/diagnostics/run-controller.ts` (+ int test): `refreshLatest()`;
    cooldown memory (D-12). Test: run finishes → `refreshLatest()` after the run's rows are gone →
    start within 60 s is still refused with the cooldown text.
  - `apps/mobile/src/application/nodes/node-history.ts` (+ int test): `forget(publicKey | null)`.
  - `apps/mobile/src/composition/index.ts`: `deletion: new DataDeletion(...)` with
    `busy = () => runs.getState().active !== null || nodes.getState().sync.kind === "syncing"`.
  - `context/test-plan.md`, `stryker.targets`: add `apps/mobile/src/application/settings/settings.ts`,
    `settings-controller.ts`, `data-deletion.ts` and `packages/storage/src/data/data-eraser.ts` as
    mutation targets (80 %, report); TR-20 → covered (S-09), TR-21 → covered (S-05 secrets, S-09 rows).
- Proves: FR-15 AC2 and FR-14 AC3 at integration level (TR-21), D-10, D-11, D-12.
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`.
- Human checks: none.

### Phase 3: Settings screen — preferences and about
- Files:
  - `apps/mobile/src/application/settings/presenter.ts` (+ `presenter.test.ts`): view model of the
    preferences and about sections; loading view; D-6 texts; error texts of D-2, D-3 and save
    failure.
  - `apps/mobile/src/app/settings.tsx`: real screen with `Screen`, `Card`, `Segmented`, `Switch`,
    `AppButton`, `BottomNav current="settings"`; keeps the transport line.
  - `apps/mobile/src/i18n/en.json`: `settings.*` keys (remove `settings.placeholder` if no other
    screen uses it; `PlaceholderScreen` is removed if unused).
  - `apps/mobile/e2e/settings.yaml`: clearState → Settings shows "Timeout: Auto", attempts 2
    selected, redaction on, "Connect a companion to see its firmware."; type `61` → Save → "Enter
    whole seconds from 5 to 60." and still "Timeout: Auto"; `4` → same; `20` → "Timeout: 20 s";
    attempts 3; redaction off; `stopApp` + `launchApp` (no clearState) → the three values are kept;
    screenshot `settings`.
  - `apps/mobile/e2e/settings-policy.yaml`: `lib/connect-diag` with `diag-no-reply` → Settings
    shows the companion firmware → timeout 5, attempts 1, redaction off → back → Run diagnostic →
    "No response — cause unknown" → details show "Waited 5 s (your setting)" and "up to 1 per check"
    → back → Export shows "Public keys: written in full" without touching the toggle.
  - Before committing: grep `apps/mobile/e2e/**` for `settings`, `Settings will appear here` and
    `Transport:` (smoke, `lib/look-screens.yaml`, `app-look.yaml`) and update assertions; re-take the
    app-look Settings screenshots (lesson).
- Proves: FR-15 AC1 (e2e), FR-15 AC3 (e2e), FR-10 AC3/AC4 and FR-13 AC3 through Settings (e2e),
  persistence across restart (e2e).
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm e2e` (full suite, lesson).
- Human checks: see *Human checks* 1–2.

### Phase 4: Settings screen — delete history and clear all data
- Files:
  - `apps/mobile/src/application/settings/presenter.ts` (+ test): deletion list (D-13), busy note
    (D-11), result texts (D-10); empty-list text only when both stores are loaded without error.
  - `apps/mobile/src/app/settings.tsx`: Data section, `Alert.alert` confirmations (D-14), result
    message under the section.
  - `apps/mobile/src/i18n/en.json`: confirmation titles, messages and result texts.
  - `apps/mobile/e2e/settings-delete.yaml`: `lib/connect-diag` with `diag-ok` → back → seed
    `voltage-history` → set a label on Room K → Settings lists Room K → Delete → Cancel keeps it →
    Delete → confirm "Delete" → "No node has stored history." → Room K's node screen shows no runs
    and no label; then set timeout 20 s, Clear all data → confirm → Dashboard shows "Known nodes will appear here.";
    screenshots `settings-data`, `settings-confirm`; Settings still shows the saved timeout after the clear (D-9).
- Proves: FR-15 AC2 (e2e with confirmation), D-13 empty state.
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm e2e`.
- Human checks: see *Human checks* 3–4.

## Risks and unknowns
- `Alert.alert` button lookup in Maestro on the `guardian` AVD: if text lookup fails, the flow uses
  the Android button ids (`android:id/button1`); logged as `[minor]` if needed.
- `expo-sqlite/kv-store` keeps its values in its own database `ExpoSQLiteStorage`
  (`node_modules/expo-sqlite/src/Storage.ts:474`), separate from the app database, and `eraseAll`
  touches only the five named tables, so settings survive "Clear all data" as D-9 says. The
  phase 4 e2e checks that the saved settings are still there after clearing.
- A sync started after a "Clear all data" re-creates nodes: expected and correct.
- Mutation on `run-controller.ts` and `nodes-controller.ts`/`node-history.ts` changes: the
  mutation step must run on every touched target (lesson).

## Progress
<!-- One line per phase. /implement ticks it in the phase's own commit. -->
- [x] Phase 1: Settings model, store and policy wiring
- [x] Phase 2: Data deletion
- [ ] Phase 3: Settings screen — preferences and about
- [ ] Phase 4: Settings screen — delete history and clear all data

## Human checks
<!-- Filled by /implement: one open checkbox per human check, with how to run it and evidence. -->
Planned (each two minutes, CI APK `android-apk` on a real phone with a paired companion):
1. (Phase 3) Settings look in light and dark and at 200 % font size: sections readable, nothing
   clipped, the timeout field and buttons reachable — evidence: e2e screenshot `settings`.
2. (Phase 3) Connected to the real companion, About shows its model, firmware version and build date
   matching the Connect screen; set timeout 10 s and attempts 1, run a diagnostic against a node:
   the result details say "Waited 10 s (your setting)" and "up to 1 per check".
3. (Phase 4) Wording of both confirmations and of the D-9 note that settings are kept.
4. (Phase 4) On the phone: delete one node's history, force-stop and reopen: its runs, label and
   guest password are gone, other nodes unchanged.

## Deviations
<!-- [minor] / [REVIEW] / [FOLLOW-UP] / [STUCK] entries, see autonomy.md section 3 -->
- [minor] (Phase 1) Plan D-5 says a run keeps the policy it started with, but `RunController.finish` re-read `policy().attempts` when saving, so a setting saved mid-run would have recorded the wrong `attemptsPerCheck`. `execute` now reads the policy once and passes `attempts` to `finish`; integration test added.
- [minor] (Phase 1) The in-memory `SettingsStore` double is `InMemorySettingsStore` in `platform/fake/in-memory.ts` (where the other doubles live) instead of inside the controller test.

- [minor] (Phase 2) Plan-review finding 1 (cooldown button): done as `RunState.lastRequestAt` + `cooldownMs`, used by `start`, `app/node/[id].tsx` and `nearest-repeater-card.tsx`; test reads the UI value after `refreshLatest()`.
- [minor] (Phase 2) Plan-review finding 3: `RunController.busy()` (from the tap until the run ends) feeds `DataDeletion`'s busy check. The reverse race (a run starting during a deletion; Run is not disabled by Settings) is not guarded: `[FOLLOW-UP]` for Phase 4, where the Settings screen can disable deletion buttons while a deletion runs.
- [minor] (Phase 2) Plan-review finding 4: migrations use `PRAGMA user_version`; nothing to preserve, `eraseAll` touches only the five data tables.
- [minor] (Phase 2) `SqliteDataEraser` is covered with `PRAGMA foreign_keys = OFF` in its test, to prove the explicit child deletes.

## Review response
<!-- revise mode only: one line per plan-review finding and what changed -->
