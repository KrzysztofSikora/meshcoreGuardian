# Plan: sync-contacts (S-03)

## Goal and end state
After connecting, the app loads the companion's contacts into local SQLite storage. The Dashboard
lists known nodes with their name, role and last-heard time, and the user can label them, set
their role and keep both across restarts. When done:

- A successful handshake starts one contact sync on its own (it is a local companion command, not
  LoRa traffic). The Dashboard also has a "Sync contacts" button. Each contact is stored once, keyed
  by its full 32-byte public key. It is listed with its name, role (Repeater, Room server, Chat,
  Unknown) and last-heard time when the companion reports one (FR-04 AC1).
- A contact type the app does not know (anything except chat 1, repeater 2 and room 3) shows the
  role "Unknown", and the user can set the role by hand (FR-04 AC2, Q-03).
- A label or role the user sets wins over the protocol value, which stays visible as "Reported as
  …". Both survive an app restart (FR-04 AC3). A later sync never overwrites them.
- Repeaters, room servers and Unknown nodes show on the Dashboard on their own. Chat contacts show
  only under "All contacts", and the user can add one to the Dashboard. A node that is no longer
  in the companion's contacts keeps its row and shows "Not in companion contacts".
- Both lists are `FlatList`s (virtualised) and handle the 350 contacts of the real fixture (FR-04 AC4).
- Storage foundation: `SqlDriver` port, a `PRAGMA user_version` migration runner and
  `0001_init.sql` with the `devices` table. The same SQL runs in tests on `node:sqlite` and in the
  app on `expo-sqlite`.
- e2e (fake transport, real SQLite on the emulator): sync, label and role edit, then a restart
  still shows the label and role.

## Scope
- In: domain node model and `NodeRepository` port; `packages/storage` driver port, migration
  runner, first migration, node repository with the sync merge rules; `MeshClient.getContacts`;
  a fake contacts script derived from the S-01 fixture; the `ExpoSqlDriver` and app composition;
  the application `NodesController`; Dashboard list, the All contacts filter, and label, role and
  pin editing on the node screen; i18n; two Maestro flows; updates to the test plan and
  compatibility doc.
- Out: diagnostics and the "diagnostics disabled" button for nodes not in contacts (S-04 reads
  `inContacts`); `last_tested_at` and the status chip text from FR-11 (S-04); battery profile (P1);
  deleting nodes or clearing data (S-09); incremental sync with `since` and the `0x90`
  contacts-full push (FOLLOW-UP); removing a node from the Dashboard (FOLLOW-UP); lat/lon and paths
  of contacts; node telemetry and details beyond name, role and label (S-06).

## Findings
- **Contact frames are decoded already.** `decodeFrame` returns `contactsStart { count }`, `contact
  { publicKey (64 hex), type, flags, path, outPath, name, lastAdvert, lat, lon, lastMod }` and
  `endOfContacts` (`packages/meshcore-adapter/src/decode/decode-frame.ts:39-55`,
  `decodeContact` `:228`). The name is read from raw bytes, so a name that fills all 32 bytes works.
- **`MeshClient` handles one frame per request.** `pending` holds a single `{ kind, resolve }`
  (`src/client/mesh-client.ts:33-38`, `onFrame` `:168`). A busy flag is used only by `handshake`
  (`:69`). Frames of other kinds are dropped while a request waits (`:179`). This is why adverts and
  RX-log pushes that arrive during a sync do no harm (`docs/compatibility.md` Contacts table).
- **Encoder:** meshcore.js `sendCommandGetContacts(since)` writes `[0x04]`, plus `since` u32 only
  when it is truthy (`node_modules/@liamcottle/meshcore.js/src/connection/connection.js:67`). The
  `MeshCoreConnection` used by `MeshClient` can send it already.
- **Real sync (S-01):** `handshake.json` has tx `04` at 194 ms, `contactsStart` count 350, then 350
  contact frames ~50–100 ms apart, and `endOfContacts` at 27.2 s. Over BLE a sync took 21.7–26.9 s
  (`docs/compatibility.md:50`). The types seen are 306 × 2 (repeater), 14 × 3 (room) and 30 × 1
  (chat), with no type 0 or 4. The firmware defines `ADV_TYPE_SENSOR = 4`; meshcore.js
  `Constants.AdvType` knows only 0–3 (`constants.js:124`).
- **Clocks cannot be trusted:** `lastAdvert` is the timestamp from the remote node's advert. The
  fixture has 7128002 (1970), 1720281318 (2024) and chat-1 1836274226 (2028). `lastMod` is the
  companion's own clock at the last change to the contact; all values in the fixture are close to
  the capture date (2026-10). Using `lastMod` as "last heard" is `UNVERIFIED` (D-7).
- **Firmware count semantics:** `CMD_GET_CONTACTS` sends the total contact count in
  `contactsStart` and then filters by `since`. Without `since`, count = number of contact frames
  (350 = 350 in both fixtures).
- **Fixture frames for the app:** the first 30 contact frames (seq 6–35) hold 27 repeaters,
  `chat-1` (seq 16), `chat-2` (seq 25) and the room `PL- RDE_Room_MXC` (seq 35). Chat names were
  redacted at capture time (S-01 D-13), so they are safe to ship.
- **Fake build:** `FakeBlePlatform.connect` builds a `FakeTransport` from `HANDSHAKE_FRAMES`
  (`apps/mobile/src/platform/fake/fake-ble-platform.ts:94-99`). `FakeTransport` consumes each
  recorded exchange once (`src/transport/fake-transport.ts:108`), so a second "Sync contacts" needs
  a second recorded exchange in the script.
- **Storage today:** `packages/storage/src/index.ts` is empty. `test/helpers/open-test-db.ts`
  opens a temp `node:sqlite` `DatabaseSync` and has no driver or migrations. Lint forbids
  `node:sqlite` in `packages/storage/src` and `apps/mobile`, and also deep imports such as
  `@guardian/storage/testing` (`eslint.config.mjs:15-19,42-45,100-102`). So app tests cannot reach
  the `node:sqlite` driver, and only storage tests run real SQL.
- **expo-sqlite 57** (`apps/mobile/node_modules/expo-sqlite/build/SQLiteDatabase.d.ts`):
  `openDatabaseSync(name)`, `execAsync(sql)`, `runAsync(sql, params) → { changes, lastInsertRowId }`,
  `getAllAsync<T>(sql, params)`. `withExclusiveTransactionAsync(task(txn))` (`:119`) is the only
  transaction that scopes its queries; `withTransactionAsync` lets other queries interleave
  (`:77-94`). The app already uses `expo-sqlite/kv-store` (a separate database) for the last companion.
- **Metro and `.sql`:** Metro does not load `.sql` files as strings unless the transformer is
  configured to, and Vite needs `?raw` for that. The roadmap fixes the file name `0001_init.sql` (D-3).
- **Routes:** five screens plus the debug route (`apps/mobile/src/app/_layout.tsx:10-17`). The
  Dashboard and node screens are still placeholders (`app/index.tsx`, `app/node/[id].tsx`).
- **Test plan:** TR-11 (data lost on restart or migration) and TR-15 (sync duplicates or overwrites
  data, or deletes history) are planned for S-03. Mutation target
  `packages/storage/src/sync/contacts.ts` is at 70 %.

## Decisions
| ID | Question | Chosen | Alternatives (and what they would buy) | Why | Reversal | Decided by |
|----|----------|--------|----------------------------------------|-----|----------|------------|
| D-1 | Shape of the `devices` table | `devices(id INTEGER PK, public_key TEXT NOT NULL UNIQUE CHECK(length = 64), reported_name TEXT NOT NULL, reported_role TEXT NOT NULL CHECK(role set), reported_type INTEGER NOT NULL, user_label TEXT NULL CHECK(length 1–64), user_role TEXT NULL CHECK(role set), last_heard_at INTEGER NULL, in_contacts INTEGER NOT NULL CHECK(0/1), dashboard_pinned INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, synced_at INTEGER NOT NULL)`. Timestamps are UTC epoch ms. Reported values and user values sit in separate columns | B: one `role` column plus `role_source`. Matches the PRD wording, but then the reported role is lost once the user sets one, and the roadmap wants "reported as …" kept. C: also add `last_tested_at` and the battery profile now. Saves a migration later, but stores columns nobody writes yet | Keeping both columns makes "user wins, protocol shown" a plain read with no history table. Later columns come in additive migrations (S-04 is the first test of TR-11 migrations) | costly | agent |
| D-2 | Migration runner | `migrateToLatest(driver)` reads `PRAGMA user_version` and applies each later migration in its own transaction, then sets `user_version = n` in that same transaction. Unknown higher version → `SchemaTooNewError` (the app shows a storage error and never downgrades) | B: a `schema_migrations` table. Gives history and timestamps, at the cost of one more table and bookkeeping. C: run `CREATE TABLE IF NOT EXISTS` on every start. This cannot express changes to existing columns | `user_version` is built into SQLite on both drivers and is enough for a linear list | cheap | agent |
| D-3 | How does a `.sql` migration reach Metro and Vitest? | `packages/storage/migrations/0001_init.sql` is the source. `pnpm --filter @guardian/storage gen:migrations` (a ~20-line Node script `packages/storage/scripts/gen-migrations.mjs`) writes `src/migrations/generated.ts` (`MIGRATIONS: readonly { version, name, sql }[]`). A storage test regenerates the file in memory and fails if the committed copy is stale | B: a custom Metro transformer for `.sql` plus a Vite raw plugin. No generated file, but two bundler configs to keep aligned. C: write migrations as TS string modules. Simplest, but it breaks the roadmap's `0001_init.sql` | The roadmap fixes `.sql` files, and a generated module works in every runtime with no bundler change | cheap | agent |
| D-4 | `SqlDriver` port | Defined in `packages/storage/src/driver.ts`: `exec(sql)`, `run(sql, params) → { changes }`, `all<T>(sql, params) → T[]`, `transaction<T>(fn: (tx: SqlDriver) => Promise<T>) → T`. All async, with positional `?` params of `string \| number \| null`. Drivers: `ExpoSqlDriver` (app; `transaction` = `withExclusiveTransactionAsync`, queries go to `txn`) and `NodeSqlDriver` (storage tests only; `BEGIN IMMEDIATE`/`COMMIT`/`ROLLBACK`) | B: put the port in `domain`. Domain would then know about SQL. C: a sync API. node:sqlite is synchronous, but expo's sync API blocks the JS thread during a 350-row sync | The tech stack places `SqlDriver` in storage with these four methods. Async fits expo, and node:sqlite wraps easily | cheap | agent / tech-stack |
| D-5 | Contact type → role | `1 → chat`, `2 → repeater`, `3 → room_server`, anything else (0, 4 sensor, unknown) → `unknown`. The raw type is kept in `reported_type` and shown as "Reported as Unknown (type 4)" | B: a fifth role `sensor`. More precise, but the PRD fixes four roles. C: hide type 0/4 contacts. Hides nodes the user may want to check | The PRD role set plus AC2 (unknown → set by hand). The raw value keeps the information | cheap | prd |
| D-6 | When does a sync run? | Once per connection, right after the handshake succeeds, if the `contacts` capability is supported and the app is active. The user can also tap "Sync contacts" on the Dashboard while connected. No timer and no retry | B: manual only. Less BLE traffic (a sync takes ~25 s), but the Dashboard stays empty until the user finds the button. C: on every Dashboard focus. Repeats a 25 s sync for nothing | Contacts is a local companion command, not a remote LoRa request (FR-10 AC6 covers remote requests). One sync per connect is bounded and expected | cheap | agent |
| D-7 | What is "last heard"? | `last_heard_at` = the contact's `lastMod` (companion clock, seconds → ms). `0` → null → "Last heard: not reported". It is shown as an absolute local date and time, labelled "Last heard (companion clock)". `UNVERIFIED` in `docs/compatibility.md` | B: `lastAdvert` (the remote node's own clock). The fixture shows 1970, 2024 and 2028 values for it. C: do not show any time. Fails AC1 although the protocol has a usable value | `lastMod` comes from the clock of the device the user is holding next to the phone. The label says whose clock it is | cheap | agent |
| D-8 | Sync merge rules (TR-15) | In one transaction: upsert by `public_key`; set `reported_*`, `last_heard_at`, `in_contacts = 1`, `synced_at`; never touch `user_label`, `user_role`, `dashboard_pinned`, `created_at`. After a **complete** sync, set `in_contacts = 0` on every row whose key was not in the batch. Rows are never deleted. Complete = `endOfContacts` arrived **and** received count = `contactsStart` count. On a count mismatch: upsert what came, mark nothing as missing, status "Partial sync (n of m)". On timeout, drop or a malformed frame: store nothing | B: store received contacts even after a timeout or drop. Keeps more data, but a half-sync mixed with old rows is harder to explain. C: delete nodes that are missing. Breaks the roadmap rule that history is kept | Only a sync that is known to be complete may mark a node as missing, so a radio hiccup never marks hundreds of nodes "Not in companion contacts" | costly | agent / user (roadmap) |
| D-9 | `in_contacts` is relative to which companion? | The last complete sync, whichever companion did it. Not stored per companion | B: a `companion_contacts(companion_key, node_id)` table. Exact when several companions are used, but the PRD rules out several companions at once (NG) and nothing reads per-companion membership yet | Simplest. Diagnostics (S-04) need membership in the connected companion, and the last sync is that companion | costly | agent |
| D-10 | Who is on the Dashboard? | Derived, not stored: `isOnDashboard(node) = effectiveRole(node) !== "chat" \|\| node.dashboardPinned`. "Add to dashboard" sets `dashboard_pinned = 1` | B: an `on_dashboard` column that each sync sets. Then a user role change (repeater → chat) would leave a chat contact on the Dashboard, and the sync code gets a second job | The roadmap rule "repeater, room server or unknown → Dashboard on each sync" follows from the role. The user's role override applies too | cheap | agent / user (roadmap) |
| D-11 | Sync bounds and errors in `MeshClient.getContacts` | Send `[0x04]` (no `since`). Wait for `contactsStart` for up to 5 s. After that, each frame must follow the previous one within 5 s (idle bound), and the whole sync is capped at 120 s. Result `{ contacts: ContactReport[]; expected: number }`. Errors: `ContactsTimeoutError { stage: "start" \| "idle" \| "total"; received; expected }`, `CommandRejectedError { code? }` for an `err` frame, `MalformedFrameError`, `TransportUnavailableError`, `AbortError`. It shares the handshake's busy flag (`Error("busy")`). Frames of other kinds in between are ignored | B: one fixed 60 s timeout. Too short for a slow phone link, and needlessly long when the companion says nothing. C: a cap computed from the count (count × 500 ms). Tighter, but it depends on Android timing nobody has measured | The real gap between frames is ≤ 100 ms and a full sync takes 22–27 s. 5 s idle notices silence quickly, and 120 s leaves 4× headroom | cheap | agent |
| D-12 | Fake contacts for e2e and app tests | `packages/meshcore-adapter/src/transport/contacts-script.ts`: `CONTACTS_FRAMES` = the recorded tx `04`, a `contactsStart` rewritten to the new count, recorded contact frames seq 6–35 (byte for byte, with their gaps), one derived **type-4** contact (copy of seq 6 with byte 33 = 4, name "Sensor test" and public key last byte flipped), and the recorded `endOfContacts`: 31 contacts in ~2 s. `FakeBlePlatform` appends it twice after the handshake frames, so "Sync contacts" can run once more. A test checks the recorded frames against the fixture and the derived edits field by field | B: bundle `handshake.json` (290 KB) and replay all 350 contacts. Realistic, but a 27 s sync on each e2e flow, and S-02 D-3 already chose not to bundle fixtures. C: hand-written contact frames. Lose the real encoding (emoji, 32-byte names) | Same pattern as `HANDSHAKE_FRAMES` (S-02 D-3). 31 rows are more than one screen (AC4). The type-4 row covers AC2 on screen | cheap | agent |
| D-13 | Where does the app keep data in the fake build? | Real `expo-sqlite` database `guardian.db` in both modes. Only the BLE platform is faked. Maestro's `clearState: true` empties it per flow | B: an in-memory repository in fake mode. Cannot prove "restart keeps labels" (roadmap e2e) | The e2e acceptance needs real persistence, and SQLite does no radio work | cheap | agent |
| D-14 | Where is "All contacts"? | A two-button filter at the top of the Dashboard ("Dashboard" / "All contacts", `accessibilityState.selected`), same `FlatList`. Tapping a row opens `/node/[publicKey]` | B: a sixth route `/contacts`. A separate screen, but the tech stack lists five routes and the list is the same component. C: a section header under the Dashboard list. 350 chat and repeater rows under the Dashboard bury it | Keeps the five routes. One list component with two filters | cheap | agent |
| D-15 | Editing label and role | On the node screen: a `TextInput` "Label" (max 64 characters, counted as code points; trimmed; empty = remove the label) with "Save label"; role buttons Repeater / Room server / Chat / Unknown plus "Use reported role" (clears `user_role`). "Add to dashboard" is shown when the node is not on the Dashboard. Validation is in domain `normalizeLabel` (`{ ok: true, value: string \| null } \| { ok: false, reason: "TOO_LONG" }`) and is enforced again by the SQL `CHECK` | B: inline editing in the list row. Fewer taps, but cramped at 200 % font scale (NFR-05). C: a modal. Navigation is no simpler | The node screen is the planned home of node details (S-06) | cheap | agent |
| D-16 | How does the application reach `getContacts`? | `CompanionSession.fetchContacts({ signal })` delegates to the current `MeshClient`, and throws `TransportUnavailableError` when not connected. `NodesController` (`application/nodes/nodes-controller.ts`, Zustand vanilla store) subscribes to the session store and calls it on the transition to `connected` (D-6) | B: expose the `MeshClient` from the session. A wider surface, and any caller could start requests. C: sync inside `CompanionSession`. Mixes node storage into the connection state machine | One narrow method keeps one owner of the client and its single-flight | cheap | agent |
| D-17 | App tests and storage | `NodesController` tests use a small in-memory `NodeRepository` double (records calls, returns the lists it was given). Merge rules are tested only in `packages/storage` on `node:sqlite` | B: let app tests import a `node:sqlite` driver. Needs a lint exception for `apps/mobile` and a deep import into storage | Lint keeps `node:sqlite` out of the app (TR-22). The merge logic has one home and one test suite | cheap | agent |
| D-18 | Zod in storage | Add `zod` `4.6.5` (the exact version the app uses) to `packages/storage` to parse rows into domain `Node` (the tech stack puts Zod at DB → domain) | B: hand-written row checks. No new manifest entry | Not new to the app bundle; it follows the tech stack | cheap | tech-stack |

## Design

### Data flow
```
CompanionSession ──connected──▶ NodesController (application, zustand/vanilla)
   │ fetchContacts({signal})        │ NodeRepository (domain port)
   ▼                                ▼
MeshClient.getContacts ─────▶ ContactReport[] ─▶ SqliteNodeRepository.applySync (storage)
   │ MeshCoreConnection (0x04)                       │ SqlDriver
   ▼                                                 ▼
MeshTransport (BLE | Fake)                     ExpoSqlDriver (app) | NodeSqlDriver (tests)
Dashboard / node screen ──useStore──▶ NodesController.store { nodes, sync, storage }
```

### Domain (`packages/domain/src/nodes/`)
- `node.ts`:
  - `NODE_ROLES = ["repeater", "room_server", "chat", "unknown"] as const`, `NodeRole`.
  - `ContactReport { publicKey: string /* 64 lower-case hex */; name: string; type: number; lastHeardAt: number | null /* epoch ms */ }`.
  - `Node { publicKey; reportedName: string; reportedRole: NodeRole; reportedType: number; userLabel: string | null; userRole: NodeRole | null; lastHeardAt: number | null; inContacts: boolean; dashboardPinned: boolean; createdAt: number; syncedAt: number }`.
  - `roleFromContactType(type: number): NodeRole` (D-5); `effectiveRole(node)`;
    `displayName(node)` = user label, else the reported name, else `null` (the UI shows "Unnamed
    node <key prefix>"); `keyPrefix(publicKey)` = the first 8 hex characters; `isOnDashboard(node)`
    (D-10); `normalizeLabel(input)` (D-15); `sortNodes(nodes)` = by display name, case-insensitive,
    then by public key.
  - `contactLastHeard(lastMod: number): number | null` (seconds → ms, 0 → null) (D-7).
- `ports.ts`: `NodeRepository { applySync(reports: ContactReport[], opts: { complete: boolean; now: number }): Promise<SyncOutcome>; listAll(): Promise<Node[]>; get(publicKey): Promise<Node | null>; setLabel(publicKey, label: string | null): Promise<void>; setRole(publicKey, role: NodeRole | null): Promise<void>; pinToDashboard(publicKey): Promise<void> }`; `SyncOutcome { added: number; updated: number; markedMissing: number }`.
- `sync.ts`: `CONTACT_SYNC_FAILURES = ["NO_RESPONSE", "TRANSPORT_UNAVAILABLE", "UNSUPPORTED", "MALFORMED_RESPONSE", "STORAGE_ERROR"] as const`; `ContactSyncState = { kind: "idle" } | { kind: "syncing" } | { kind: "done"; at; total } | { kind: "partial"; at; received; expected } | { kind: "failed"; reason }`.

### Storage (`packages/storage/`)
- `migrations/0001_init.sql`: `devices` (D-1) and an index on `in_contacts`.
- `scripts/gen-migrations.mjs` → `src/migrations/generated.ts` (D-3).
- `src/driver.ts`: `SqlDriver`, `SqlValue = string | number | null` (D-4).
- `src/migrate.ts`: `migrateToLatest(driver, migrations = MIGRATIONS): Promise<{ from: number; to: number }>`, `SchemaTooNewError` (D-2).
- `src/sync/contacts.ts`: `applyContactSync(driver, reports, { complete, now }): Promise<SyncOutcome>` (D-8): one transaction, `INSERT … ON CONFLICT(public_key) DO UPDATE SET reported_name, reported_role, reported_type, last_heard_at, in_contacts = 1, synced_at`. When `complete` is true and the batch is not empty, `UPDATE devices SET in_contacts = 0 WHERE in_contacts = 1 AND public_key NOT IN (SELECT key FROM json_each(?))`, with the key list bound as one JSON parameter (no limit on bound variables). `added` counts rows that did not exist before (looked up in the transaction first). A complete sync with **zero** contacts marks nothing missing (an empty companion is suspicious and cheap to resync).
- `src/nodes/node-repository.ts`: `SqliteNodeRepository implements NodeRepository`. Rows are parsed with Zod (D-18). `setLabel` and `setRole` on an unknown key throw `NodeNotFoundError`.
- `src/index.ts` exports the driver type, `migrateToLatest`, `MIGRATIONS`, `SqliteNodeRepository`, the errors.
- Test helpers: `test/helpers/node-sql-driver.ts` (`NodeSqlDriver` over `DatabaseSync`), `open-test-db.ts` gains `{ driver }` and `openTestDb({ migrate?: boolean | number })` (default: all migrations; a number stops at that version; `false` = none). The existing tests stay valid.

### Adapter (`packages/meshcore-adapter/src/`)
- `client/mesh-client.ts`: `getContacts({ signal }?): Promise<{ contacts: ContactReport[]; expected: number }>` (D-11). The single `pending` slot becomes a frame handler (`(decoded) => void`) plus cleanup, so handshake steps and the contacts collector share `failPending`, disconnect and abort handling. The handshake behaves exactly as before; its tests stay unchanged. Contact → `ContactReport` via `roleFromContactType` is **not** applied here: the client returns `{ publicKey, name, type, lastHeardAt: contactLastHeard(lastMod) }`.
- `client/errors.ts`: `ContactsTimeoutError`, `CommandRejectedError`.
- `transport/contacts-script.ts`: `CONTACTS_FRAMES` (D-12). Exported.

### Application (`apps/mobile/src/application/nodes/`)
- `nodes-controller.ts`: `NodesController({ session, repository: () => Promise<NodeRepository>, appState, clock })`. Store `{ nodes: Node[]; loaded: boolean; storage: "ok" | "error"; sync: ContactSyncState }`. Methods: `load()` (idempotent, per the accepted lesson on idempotent screen calls), `sync()` (single flight: a second call while syncing does nothing), `setLabel(key, input) → { ok } | { ok: false; reason: "TOO_LONG" }`, `setRole(key, role | null)`, `pin(key)`, `dispose()`. It reloads `nodes` after every write. Error → reason: `ContactsTimeoutError` → `NO_RESPONSE`, `TransportUnavailableError` → `TRANSPORT_UNAVAILABLE`, `CommandRejectedError` → `UNSUPPORTED`, `MalformedFrameError` → `MALFORMED_RESPONSE`, repository failure → `STORAGE_ERROR`, `AbortError` → back to `idle`. Disconnecting aborts a running sync.
- `companion-session.ts`: adds `fetchContacts({ signal })` (D-16).

### Platform and composition
- `apps/mobile/src/platform/sqlite/expo-sql-driver.ts`: `ExpoSqlDriver` (D-4); `openGuardianDb()` = `openDatabaseSync("guardian.db")`, `PRAGMA foreign_keys = ON`, `migrateToLatest`.
- `composition/index.ts`: `nodes: new NodesController({ … repository: lazily opened, migrated SqliteNodeRepository })`, the same in both modes (D-13).
- `platform/fake/fake-ble-platform.ts`: script = `HANDSHAKE_FRAMES` + `CONTACTS_FRAMES` × 2 (D-12).

### UI
- `app/index.tsx`: connection chip (kept), "Connect companion" link, a sync line (`Syncing contacts…`, `Contacts synced: 31`, `Partial sync: 30 of 31`, `Contact sync failed: <reason>`), the "Sync contacts" button (enabled only when connected and `actionAvailability(capabilities, "contacts")` allows it, with the reason shown otherwise), the D-14 filter, and a `FlatList` (`keyExtractor` = public key) of `NodeRow`s. Empty states: "Known nodes will appear here." (kept, an e2e anchor) and "No contacts yet".
- `components/node-row.tsx`: display name, role text, "Last heard (companion clock): …" or "Last heard: not reported", and "Not in companion contacts" when `!inContacts`. One `accessibilityLabel` joins them. No colour-only status.
- `app/node/[id].tsx`: name, key prefix, role and "Reported as <role>" (with "(type n)" for unknown), the label editor, role buttons, "Add to dashboard", and the not-in-contacts note. The rest of the S-06 placeholder text stays.

### Error model
| Source | Sync state | Data |
|--------|------------|------|
| `endOfContacts`, count matches | `done` | upsert, mark missing |
| `endOfContacts`, count differs | `partial` | upsert only |
| no `contactsStart` in 5 s / gap > 5 s / > 120 s | `failed(NO_RESPONSE)` | nothing stored |
| `err` frame | `failed(UNSUPPORTED)` | nothing stored |
| malformed frame | `failed(MALFORMED_RESPONSE)` | nothing stored |
| link drop / not connected | `failed(TRANSPORT_UNAVAILABLE)` | nothing stored |
| SQL error | `failed(STORAGE_ERROR)` | transaction rolled back |
| migration error / schema too new | `storage: "error"`; lists empty, "Local storage could not be opened" | untouched |

## Phases

### Phase 1: Domain node model
- Files:
  - `packages/domain/src/nodes/node.ts` + `node.test.ts`: types and pure functions above. Contract: `NodeRole` values (`repeater`, `room_server`, `chat`, `unknown`) match the D-1 `CHECK`; `ContactReport` and `Node` field names.
  - `packages/domain/src/nodes/ports.ts`: `NodeRepository`, `SyncOutcome`. Contract: method signatures above.
  - `packages/domain/src/nodes/sync.ts` + `sync.test.ts`: `CONTACT_SYNC_FAILURES`, `ContactSyncState`, `isContactSyncFailure`.
  - `packages/domain/src/index.ts`: exports.
- Proves: FR-04 AC2 at unit level (`roleFromContactType` table over 0, 1, 2, 3, 4, 255; `effectiveRole` with and without a user role), the label rule (64 code points ok, 65 rejected, an emoji counts as one, whitespace only → null), `isOnDashboard` over all four roles × pinned, `contactLastHeard(0) → null`, `sortNodes` ordering.
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm vitest run --project domain`.
- Human checks: none.

### Phase 2: Storage foundation (driver, migrations, `devices`)
- Files:
  - `packages/storage/migrations/0001_init.sql`: D-1 schema. Contract: the column names and `CHECK`s.
  - `packages/storage/scripts/gen-migrations.mjs`, `packages/storage/package.json` (`gen:migrations` script, `zod` 4.6.5 dependency).
  - `packages/storage/src/migrations/generated.ts` (generated, committed).
  - `packages/storage/src/driver.ts`, `src/migrate.ts`, `src/index.ts`. Contract: `SqlDriver` (D-4), `migrateToLatest` (D-2).
  - `packages/storage/test/helpers/node-sql-driver.ts`, `test/helpers/open-test-db.ts` (driver + migrate option).
  - `packages/storage/test/migrate.int.test.ts`: fresh DB → version 1 with `devices`; running it twice is a no-op; `user_version` 99 → `SchemaTooNewError`; a migration that fails rolls back and leaves the version unchanged; a row inserted at version 1 survives `migrateToLatest` (the TR-11 pattern for later migrations).
  - `packages/storage/test/migrations-generated.test.ts`: `generated.ts` equals the output of the generator for `migrations/*.sql` (D-3).
  - `packages/storage/test/node-sql-driver.int.test.ts`: `transaction` commits; it rolls back when `fn` throws.
- Proves: TR-11 (migration part), the D-1 `CHECK`s (65-character label and bad role are rejected by SQL) at integration level.
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm vitest run --project storage`.
- Human checks: none.

### Phase 3: Node repository and sync merge
- Files:
  - `packages/storage/src/sync/contacts.ts`: `applyContactSync` (D-8). Contract: the merge rules.
  - `packages/storage/src/nodes/node-repository.ts`: `SqliteNodeRepository`, `NodeNotFoundError`, Zod row schema.
  - `packages/storage/test/contact-sync.int.test.ts`: sync twice → one row per key, `added` 0 the second time; a user label and role survive a sync that changes the reported name and type; a key missing from a complete sync → `in_contacts = 0`, row and user fields kept, back to 1 when it reappears; an incomplete sync marks nothing missing; an empty complete sync marks nothing missing; 350 reports in one call (keys from the fixture) take one transaction; a failing insert rolls back the whole batch.
  - `packages/storage/test/node-repository.int.test.ts`: `setLabel`/`setRole`/`pinToDashboard` round trip on a file DB that is closed and reopened (TR-11 restart part, FR-04 AC3); an unknown key → `NodeNotFoundError`; a label of 65 characters is refused.
  - `context/test-plan.md`: TR-11 → covered (S-03 part), TR-15 → covered; the mutation target row stays `packages/storage/src/sync/contacts.ts`.
- Proves: FR-04 AC3 (integration), TR-15, TR-11.
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm vitest run --project storage`.
- Human checks: none.

### Phase 4: `MeshClient.getContacts` and the contacts script
- Files:
  - `packages/meshcore-adapter/src/client/mesh-client.ts`: generalised `pending` handler; `getContacts` (D-11). Contract: return shape, errors, shared busy flag.
  - `packages/meshcore-adapter/src/client/errors.ts`: `ContactsTimeoutError`, `CommandRejectedError`.
  - `packages/meshcore-adapter/src/transport/contacts-script.ts` (D-12); `src/index.ts` exports.
  - `packages/meshcore-adapter/test/mesh-client-contacts.int.test.ts` (fake timers, `FakeTransport`): both real fixtures (handshake, then contacts) → 350 reports with 306/14/30 types and `expected` 350; the write is exactly `[0x04]`; adverts and RX-log pushes in between are ignored (the real fixtures already contain them); silence → `ContactsTimeoutError("start")` at 5 s; `corrupt` on a contact frame → `MalformedFrameError`; `dropAfterWrites` / `drop()` mid-sync → `TransportUnavailableError` in the same tick; abort → `AbortError` and later frames are ignored; a gap over 5 s → `"idle"`; a frame every 4 s for 130 s → `"total"`; `err` frame → `CommandRejectedError`; a second call while one runs → `busy`; a handshake after the sync still works. Faults the shared fake cannot produce (`err` frame, a slow trickle) use a minimal scripted transport in the test (lesson: minimal port double).
  - `packages/meshcore-adapter/test/contacts-script.int.test.ts`: recorded frames in `CONTACTS_FRAMES` equal fixture seq 4–35 and 359 byte for byte (except the rewritten count); the derived frame differs from seq 6 only in type, name and the last key byte; the count equals the number of contact frames.
- Proves: FR-04 AC1 data path (integration, real fixture), D-11 bounds.
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm vitest run --project meshcore-adapter`.
- Human checks: none.

### Phase 5: Application controller, SQLite driver and composition
- Files:
  - `apps/mobile/src/application/connection/companion-session.ts`: `fetchContacts` (D-16). The existing session tests are unchanged, plus one test for `fetchContacts` when disconnected.
  - `apps/mobile/src/application/nodes/nodes-controller.ts` + `nodes-controller.int.test.ts` (fake BLE platform with `CONTACTS_FRAMES`, in-memory repository double, D-17): connect → exactly one sync → `done(31)` and `applySync` called with `complete: true`; a reconnect syncs again, but a store update without a new connection does not; contacts capability unsupported → no sync and no `0x04` write; background → no auto sync; a drop mid-sync → `failed(TRANSPORT_UNAVAILABLE)` and nothing stored; silence → `failed(NO_RESPONSE)`; `sync()` twice → one `0x04` write; a repository error → `failed(STORAGE_ERROR)`; a repository that cannot open → `storage: "error"`; `setLabel` too long → `TOO_LONG` and no write; `load()` twice → one read.
  - `apps/mobile/src/platform/sqlite/expo-sql-driver.ts`: D-4 driver, `openGuardianDb`.
  - `apps/mobile/src/platform/fake/fake-ble-platform.ts`: script with contacts (D-12).
  - `apps/mobile/src/composition/index.ts`: `nodes` controller (D-13).
  - `apps/mobile/package.json`: `@guardian/storage` workspace dependency.
- Proves: D-6 trigger rules and the error mapping (integration); TR-18 for the sync side (no sync in the background).
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`.
- Human checks: none (the real driver is covered by phase 6 e2e and the phone check).

### Phase 6: Dashboard, node editing, e2e and docs
- Files:
  - `apps/mobile/src/app/index.tsx`, `apps/mobile/src/components/node-row.tsx`, `apps/mobile/src/app/node/[id].tsx`: UI above.
  - `apps/mobile/src/application/nodes/presenter.ts` + `presenter.test.ts`: the pure view model (row text keys, the sync line, button availability, the "Reported as" text) so the screens stay thin.
  - `apps/mobile/src/i18n/en.json`: `nodes.*`, `roles.*`, `sync.*` keys. The catalog test still passes.
  - `apps/mobile/e2e/contacts-sync.yaml`: connect-ok → back to Dashboard → `PL-KR-WRBL-RPT`, `PL- RDE_Room_MXC` and "Sensor test" (Unknown) are visible, `chat-1` is not → "All contacts" → `scrollUntilVisible` `chat-2` and the last recorded contact → open `chat-1` → "Add to dashboard" → back → `chat-1` is on the Dashboard; "Sync contacts" again → "Contacts synced: 31".
  - `apps/mobile/e2e/contacts-label-restart.yaml`: connect, sync, open "Sensor test", set role Repeater and label "Hilltop" → `stopApp` → `launchApp` (no `clearState`) → Dashboard shows "Hilltop", "Repeater" and "Reported as Unknown (type 4)" in details, all without connecting.
  - `docs/compatibility.md`: Contacts table gains "Role exposure (Q-03)" (types 1–3 seen; 0/4 → Unknown, `UNVERIFIED`) and "lastMod as last heard" (`UNVERIFIED`, D-7).
  - `context/test-plan.md`: e2e list.
- Proves: FR-04 AC1, AC2, AC4 (e2e; AC4 by `FlatList` plus scrolling 31 rows), AC3 (e2e restart).
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm e2e --flow apps/mobile/e2e/contacts-sync.yaml`, `pnpm e2e --flow apps/mobile/e2e/contacts-label-restart.yaml`.
- Human checks:
  - On a real phone with the CI APK and the Heltec companion: connect and wait for "Contacts synced: <n>" (about 25 s for 350). Check that the Dashboard lists repeaters and room servers, that chat contacts are only under All contacts, and that scrolling 350 rows is smooth. Record the sync duration and the count. (Proves `ExpoSqlDriver` and real BLE timing against D-11's 5 s idle bound.)
  - On the phone: set a label on one node, force-stop the app, reopen it: the label is still there.
  - Wording: the sync failure texts and "Last heard (companion clock)" read clearly to an operator.

## Risks and unknowns
- **A long sync blocks other requests.** A 25 s sync holds `MeshClient`'s single flight. In S-04 a
  diagnostic started during a sync is refused as busy. That is correct for radio hygiene, but S-04
  must show "Contact sync in progress", not a vague busy message. Note for S-04.
- **Android BLE timing** may be slower than the laptop's ~50–100 ms per frame. If a phone shows
  gaps near 5 s, D-11's idle bound needs raising (one constant). The phone human check records it.
- **`lastMod` meaning** (D-7) is read from firmware behaviour, not documentation. If it changes on
  path updates without any packet from the node, "last heard" overstates freshness a little. The
  label names the companion clock.
- **Generated migration file** (D-3) can be forgotten; the staleness test catches it in `pnpm test`.
- **Count mismatch** semantics (D-8) rest on firmware source: with `since` the count would differ.
  We never send `since`.

## Progress
<!-- One line per phase. /implement ticks it in the phase's own commit. -->
- [x] Phase 1: Domain node model
- [ ] Phase 2: Storage foundation (driver, migrations, `devices`)
- [ ] Phase 3: Node repository and sync merge
- [ ] Phase 4: `MeshClient.getContacts` and the contacts script
- [ ] Phase 5: Application controller, SQLite driver and composition
- [ ] Phase 6: Dashboard, node editing, e2e and docs

## Human checks
<!-- Filled by /implement: one open checkbox per human check, with how to run it and evidence. -->

## Deviations
<!-- [minor] / [REVIEW] / [FOLLOW-UP] / [STUCK] entries, see autonomy.md section 3 -->
- [FOLLOW-UP] Incremental sync with `since` = last `mostRecentLastMod`, and handling of the `0x90` contacts-full push.
- [FOLLOW-UP] "Remove from dashboard" for pinned chat contacts (and a rule for hiding repeaters the user does not care about).

## Review response
<!-- revise mode only: one line per plan-review finding and what changed -->
