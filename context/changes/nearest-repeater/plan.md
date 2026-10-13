# Plan: nearest-repeater (S-11)

## Goal and end state
The Dashboard opens with a "Nearest node" card above the node list (PR #19, D-3: repeaters and room
servers, the role is shown). It names one node
picked from the companion's contacts by known hop count, then distance from the companion, then
last heard, and shows its last known path, its distance and 8-point compass direction from the
companion, its last-heard time and a Run diagnostic button (FR-21 AC1, AC2). Missing data reads as
words ("Path unknown", "Position not advertised", "Companion position not set", AC3). Every value
is labelled as the companion's last known path / the node's advertised position as of the last
contact sync, never "in range" or "online" (AC4). With no repeater in the contacts the card says so
and points to Sync contacts (AC5). "Other nearby" lists up to 5 next candidates. The feature uses
only contact-sync data and the companion's self info: no location permission, no extra radio
request (AC6).

## Scope
- In:
  - decode `out_path_len` → hop count and `adv_lat`/`adv_lon` → advertised position into
    `ContactReport`; companion position from self info into `CompanionInfo`;
  - migration `0003`: per-node path and position columns, plus the companion position of the last
    sync (D-1, D-2);
  - domain: great-circle distance, 8-point compass, candidate ranking;
  - Dashboard card with "Other nearby" and Run diagnostic;
  - fake-transport scenario with paths and positions; Maestro flows and screenshots.
- Out:
  - a map, phone location, live position, trace/path discovery (NG maps, AC6);
  - showing path or position on the node details screen (S-06 owns that screen) → `[FOLLOW-UP]`
    candidate, not done here;
  - unit settings (miles); metric only until S-09 (D-7);
  - re-verifying `out_path_len` / positions on real firmware: human check with the CI APK.

## Findings
- `ContactReport` (`packages/domain/src/nodes/node.ts:8`) has only `publicKey`, `name`, `type`,
  `lastHeardAt`. `MeshClient.collectContacts` builds it (`packages/meshcore-adapter/src/client/mesh-client.ts:452-456`)
  and drops `frame.path`, `frame.lat`, `frame.lon`, which `decodeContact` already decodes
  (`packages/meshcore-adapter/src/decode/decode-frame.ts:228-243`). `decodePathLen`
  (`packages/meshcore-adapter/src/decode/path.ts:13`) returns `{kind:"unknown"}` for 0xFF, else
  `hops = raw & 0x3f` (UNVERIFIED).
- Positions are decoded as degrees (`advLat / 1e6`); a contact that never advertised a position
  sends 0,0. All 31 recorded contacts in `CONTACTS_FRAMES` (`packages/meshcore-adapter/src/transport/contacts-script.ts`)
  have path byte `ff` and lat/lon zero, and the recorded self info in `HANDSHAKE_FRAMES`
  (`handshake-script.ts:16`) has lat/lon zero. So the existing fake scenarios already give the
  "without positions" card; a derived script is needed for the "with positions" card.
- Byte offsets (firmware 1.17 `MyMesh.cpp`, matching `decode-frame.ts`): contact frame
  `out_path_len` @35, `out_path` @36–99, name @100–131, `last_advert` @132, `adv_lat` i32le @136,
  `adv_lon` i32le @140, `lastmod` @144; self info `adv_lat` i32le @36, `adv_lon` @40.
- `CompanionInfo` (`packages/domain/src/companion/companion.ts:2`) has no position;
  `MeshClient.handshake` (`mesh-client.ts:169-185`) has the `selfInfo` frame with `lat`/`lon` and
  drops them.
- `applyContactSync` (`packages/storage/src/sync/contacts.ts:10`) upserts reported columns in one
  transaction; user columns are never touched. `SqliteNodeRepository` maps rows with Zod
  (`packages/storage/src/nodes/node-repository.ts:17`). Migrations are `migrations/NNNN_name.sql`
  turned into `src/migrations/generated.ts` by `scripts/gen-migrations.mjs`; a staleness test
  guards the generated file.
- `NodesController.sync` (`apps/mobile/src/application/nodes/nodes-controller.ts:96`) awaits the
  repository and the fetch before `applySync`; per lesson "capture the context … when the operation
  starts", the companion must be read from the session before the first await.
- Dashboard (`apps/mobile/src/app/index.tsx`) renders a `FlatList` of `NodeRow`s; Run diagnostic
  lives in `RunPanel` on `/node/[id]` (`apps/mobile/src/app/node/[id].tsx:134`), which also shows
  the airtime notice and progress. `runButton` (`application/diagnostics/presenter.ts:23`) gives
  the enabled state and the reason.
- `FakeTransport` gives no reply to a write that matches no scripted exchange
  (`fake-transport.ts:30`), so a run against a repeater without a remote script stays in
  "Step: Login · Attempt 1 of 2" until cancelled — enough to prove "Run diagnostic from the card
  starts a run".
- AC6: `app.json` configures ble-plx with `neverForLocation: true`;
  `platform/ble/permissions.test.ts:14` already asserts no `LOCATION` permission is requested.

## Decisions
| ID | Question | Chosen | Alternatives (and what they would buy) | Why | Reversal | Decided by |
|----|----------|--------|----------------------------------------|-----|----------|------------|
| D-1 | Per-node storage shape for path and position | Migration `0003_nearest.sql` adds nullable `devices.path_hops INTEGER` (0–63, `NULL` = unknown path) and `adv_lat REAL`, `adv_lon REAL` (both `NULL` = not advertised, incl. 0,0), and `path_companion_key TEXT` (nullable, 64 hex: the companion that gave `path_hops`; the ranking's filter key, added by review R2). Written by every sync for the contacts in the batch; old rows stay `NULL` until the next sync | B: store the raw `out_path_len` byte (could be re-decoded without a resync if the UNVERIFIED encoding is wrong); C: a separate `node_paths` table (keeps `devices` narrow) | Roadmap fixes "stored per node on each sync (new migration)". Additive nullable columns are the least destructive change; a wrong decode is fixed by one tap on Sync contacts, so B buys little | costly | agent |
| D-2 | Where the companion's position lives, so the Dashboard can rank and show distance while disconnected and at app start | New single-row table `contact_sync_origin` (`id = 1`, `companion_public_key`, nullable `companion_lat`/`companion_lon`, `synced_at`) written in the same transaction as the sync; `NodeRepository.syncOrigin()` reads it | B: only the live session's companion position (no storage; but distance and ranking change when disconnected, and the card at app start has no distance); C: an extra field in the last-companion key-value store (no SQL, but not atomic with the paths it belongs to, and only read by the Connect screen today) | The hop counts are relative to the companion at sync time; storing its position with them keeps one consistent "as of the last sync" snapshot (roadmap) and keeps the whole costly shape in one migration | costly | agent |
| D-3 | Which nodes are candidates | `inContacts && effectiveRole(node)` is `repeater` or `room_server`; both rank by the same rules and the card shows the node's role; heading "Nearest node" (a user role override counts; nodes marked "not in contacts" do not) | A: repeaters only (the original reading; a room server with repeat enabled next to the companion was never shown); reported role only (ignores the user's correction from S-03) | Real hardware: a room server with repeat enabled sits next to the companion and must be eligible | cheap | user (PR #19) |
| D-4 | Final tie-break after hops, distance, last heard | Public key ascending; `lastHeardAt = null` sorts after any time | B: display name (readable, but labels change) | Deterministic order for tests and for a stable card between syncs | cheap | agent |
| D-5 | Which text wins when both the companion and the repeater lack a position | "Companion position not set" | B: "Position not advertised" (about the node, but the operator cannot fix it) | The companion's position is the one the operator can set, and it affects every candidate | cheap | agent |
| D-6 | Run diagnostic on the card | Uses `runButton` for enabled state and reason; on tap calls `runs.start(publicKey)` and pushes `/node/[id]`, where the existing `RunPanel` shows the airtime notice, progress and Cancel | B: render `RunPanel` inside the card (no navigation, but the Dashboard grows notice, progress and result blocks and the panel needs extracting from the screen file) | Reuses the one place that already handles notice, progress, cancel and refusals; the card stays small | cheap | agent |
| D-7 | Distance units and rounding | Metric: `< 1 km` → metres rounded to 10 m ("850 m"); `< 10 km` → one decimal ("1.2 km"); else whole km ("23 km"). Earth radius 6 371 008.8 m (mean). Distance 0 shows no direction | B: imperial switch (needs S-09 settings) | PRD has no unit setting; one decimal is honest for advertised positions | cheap | agent |
| D-8 | Compass words | Full words in the catalog ("north-east"), keys `nearest.compass.N` … `NW`; `index = round(bearing / 45) mod 8` | B: abbreviations "NE" (shorter, but screen readers spell letters) | NFR-05 accessibility; still compact | cheap | agent |
| D-9 | "Other nearby" presentation | Inside the card, collapsed behind an "Other nearby (n)" toggle; each entry is a link to `/node/[id]` with name, path line and distance line | B: always expanded (no tap, but up to 5 more blocks push the list off-screen); C: a separate screen (more routing for 5 rows) | AC2 asks the card to link to the next candidates; collapsed keeps the list visible | cheap | agent |
| D-10 | Card placement | `FlatList` `ListHeaderComponent` (scrolls with the list); shown also when the list is empty | B: fixed `View` above the filters (always visible, but takes fixed height from the list on small screens) | "Above the list" without shrinking the list viewport that existing e2e flows scroll | cheap | agent |
| D-11 | Mutation targets for the new domain logic | Add `packages/domain/src/geo/geo.ts` and `packages/domain/src/nodes/nearest.ts` to `context/test-plan.md` *Mutation targets* and `stryker.targets` (80 %, report) | B: leave the table alone (fewer runs) | The ranking decides what the user is told first, like `classify.ts`; test-plan allows slices to extend the table | cheap | agent |

## Design

### Domain (`packages/domain`, no imports)
- `geo/geo.ts`:
  - `interface GeoPoint { lat: number; lon: number }` (degrees);
  - `advertisedPosition(lat: number, lon: number): GeoPoint | null` → `null` for exactly 0,0 or a
    non-finite / out-of-range value;
  - `distanceMeters(a: GeoPoint, b: GeoPoint): number` (haversine);
  - `initialBearing(a, b): number` (0–360, from `a` to `b`);
  - `COMPASS_POINTS = ["N","NE","E","SE","S","SW","W","NW"] as const`,
    `compassPoint(bearing): CompassPoint`.
- `nodes/node.ts`: `ContactReport` gains `pathHops: number | null` and
  `position: GeoPoint | null`; `Node` gains the same two fields (as of the last sync).
- `companion/companion.ts`: `CompanionInfo` gains `position: GeoPoint | null`.
- `nodes/nearest.ts`:
  - `interface RankedRepeater { node: Node; hops: number | null; distanceM: number | null; direction: CompassPoint | null }`;
  - `rankRepeaters(nodes: readonly Node[], companion: GeoPoint | null): RankedRepeater[]` —
    candidates per D-3, order: hops asc (null last), distance asc (null last), `lastHeardAt` desc
    (null last), public key asc (D-4);
  - `nearestRepeaters(nodes, companion, others = 5): { nearest: RankedRepeater | null; others: RankedRepeater[] }`.
- `nodes/ports.ts`: `SyncOrigin { companionPublicKey: string; position: GeoPoint | null; at: number }`;
  `applySync(reports, { complete, now, origin: { companionPublicKey, position } })`;
  `syncOrigin(): Promise<SyncOrigin | null>`.

### Adapter (`packages/meshcore-adapter`)
- `collectContacts`: `pathHops = frame.path.kind === "known" ? frame.path.hops : null`,
  `position = advertisedPosition(frame.lat, frame.lon)`.
- `handshake`: `position = advertisedPosition(self.lat, self.lon)`.
- `transport/nearest-script.ts` (fake only): `withSelfPosition(frames, point)` and
  `withContactGeo(frames, edits: Record<keyPrefix, { hops: number | null; position: GeoPoint | null }>)`
  rewrite bytes @35 / @136 / @140 of contact frames and @36 / @40 of self-info frames;
  `NEAREST_HANDSHAKE_FRAMES`, `NEAREST_CONTACTS_FRAMES` built from the recorded scripts with a
  documented set of edits (companion near Kraków; ≥ 7 repeaters with mixed direct / 1–2 hop /
  unknown paths, with and without positions, so ranking order, "Other nearby" (5) and both
  missing-position texts are reachable).

### Storage (`packages/storage`)
- `migrations/0003_nearest.sql`:
  `ALTER TABLE devices ADD COLUMN path_hops INTEGER CHECK (path_hops IS NULL OR path_hops BETWEEN 0 AND 63)`;
  `adv_lat REAL CHECK (adv_lat IS NULL OR adv_lat BETWEEN -90 AND 90)`;
  `adv_lon REAL CHECK (adv_lon IS NULL OR adv_lon BETWEEN -180 AND 180)`;
  `CREATE TABLE contact_sync_origin (id INTEGER PRIMARY KEY CHECK (id = 1), companion_public_key TEXT NOT NULL, companion_lat REAL, companion_lon REAL, synced_at INTEGER NOT NULL)`.
- `applyContactSync`: upsert also sets `path_hops`, `adv_lat`, `adv_lon` (replacing earlier
  values, including with `NULL`); `INSERT … ON CONFLICT(id) DO UPDATE` the origin row with
  `synced_at = now`, in the same transaction.
- `SqliteNodeRepository`: reads the new columns (`lat`/`lon` both non-null → `GeoPoint`),
  `syncOrigin()`.

### Application and UI (`apps/mobile`)
- `NodesController`: `NodesState.origin: SyncOrigin | null`; `sync()` reads
  `session.store.getState().connection` **before the first await**; if it is not `connected` the
  sync ends `failed: TRANSPORT_UNAVAILABLE` as today's fetch would. `refresh()` also loads
  `syncOrigin()`.
- `application/nodes/nearest-presenter.ts` (pure, no RN): `nearestCard(nodes, origin, formatTime)`
  → `{ kind: "empty"; text; syncHint }` or `{ kind: "found"; nearest: CandidateModel; others: CandidateModel[]; asOf: Text | null }`
  where `CandidateModel = { publicKey, name: Text, path: Text, position: Text, lastHeard: Text }`.
  Texts:
  - path: `nearest.path.direct` "Last known path: direct" / `nearest.path.hops` "Last known path:
    {{count}} hop(s)" / `nearest.path.unknown` "Path unknown";
  - position: `nearest.position.distance` "Advertised position: {{distance}} {{direction}} of the
    companion" / `nearest.position.noDirection` (distance 0) / `nearest.position.notAdvertised`
    "Position not advertised" / `nearest.position.companionNotSet` "Companion position not set" (D-5);
  - `nearest.asOf` "As of the last contact sync, {{time}}";
  - `nearest.empty` "No repeater or room server in the companion's contacts." + `nearest.syncHint` "Use Sync
    contacts to update the list."
  - `formatDistance(m): Text` per D-7.
- `components/nearest-repeater-card.tsx`: header "Nearest node"; candidate block; Run
  diagnostic button (`runButton` state, reason below; `accessibilityLabel` "Run diagnostic on
  {{name}}"; D-6); "Other nearby (n)" toggle (D-9). No colour-only status.
- `app/index.tsx`: card as `ListHeaderComponent` (D-10).
- `debug/scenarios.ts` + `platform/fake/fake-ble-platform.ts`: attempt option `nearest: true`
  selecting `NEAREST_HANDSHAKE_FRAMES` / `NEAREST_CONTACTS_FRAMES`; scenario `nearest`.

### Error model
- Storage failure on read keeps today's behaviour (`storage: "error"`, card not shown).
- A contact with an out-of-range position decodes to `position: null` (not advertised), never
  throws; `pathHops` is whatever `decodePathLen` gives (UNVERIFIED encoding).
- No new radio request anywhere; the card is a pure function of stored state.

## Phases
### Phase 1: Domain geometry and ranking
- Files:
  - `packages/domain/src/geo/geo.ts` (+ `geo.test.ts`): new. Contract: `GeoPoint`,
    `advertisedPosition`, `distanceMeters`, `initialBearing`, `COMPASS_POINTS`, `compassPoint`.
  - `packages/domain/src/nodes/nearest.ts` (+ `nearest.test.ts`): new. Contract: `rankRepeaters`,
    `nearestRepeaters`, `RankedRepeater`.
  - `packages/domain/src/nodes/node.ts`: `ContactReport.pathHops`, `ContactReport.position`,
    `Node.pathHops`, `Node.position` (required, nullable).
  - `packages/domain/src/companion/companion.ts`: `CompanionInfo.position`.
  - `packages/domain/src/index.ts`: exports.
  - Every place that builds these types gets the fields so the build stays green, with `null`
    values only (no behaviour yet): `mesh-client.ts` contact and handshake mappings,
    `node-repository.ts` row transform, test builders in `nodes-controller.int.test.ts`,
    `companion-session.int.test.ts`, storage tests.
- Proves: FR-21 AC2 (ranking incl. every tie-break and the 5-candidate cut), AC3 data side
  (0,0 → not advertised; unknown path last). Unit tests: known distances (e.g. Kraków–Warsaw
  ≈ 252 km within 0.5 %, antipodal-ish and same-point cases), bearing for each of the 8 points and
  the boundaries 22.5° / 337.5°, ranking tables.
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`,
  `pnpm mutation --mutate packages/domain/src/nodes/nearest.ts`,
  `pnpm mutation --mutate packages/domain/src/geo/geo.ts`.
- Human checks: none.

### Phase 2: Decode, store and load path, position and sync origin
- Files:
  - `packages/meshcore-adapter/src/client/mesh-client.ts`: fill `pathHops`/`position` from the
    contact frame and `position` from self info. Contract: `ContactReport`, `CompanionInfo`.
  - `packages/meshcore-adapter/test/mesh-client-contacts.int.test.ts`,
    `mesh-client.int.test.ts`: a contact with known path (hash size 1 and 2) and position, one with
    0xFF and 0,0; handshake with and without companion position.
  - `packages/storage/migrations/0003_nearest.sql`, `src/migrations/generated.ts` (regenerated).
    Contract: D-1, D-2 schema.
  - `packages/storage/src/sync/contacts.ts`: write the three columns and the origin row in the
    sync transaction.
  - `packages/storage/src/nodes/node-repository.ts`: read columns; `syncOrigin()`.
  - `packages/domain/src/nodes/ports.ts`: `SyncOrigin`, `applySync` `origin` option,
    `syncOrigin()`.
  - `packages/storage/test/{contact-sync,node-repository,migrate}.int.test.ts`: values round-trip;
    a later sync replaces a path with unknown and a position with none; user columns untouched;
    origin replaced, not duplicated; migration from v2 with existing rows keeps them with `NULL`s.
  - `apps/mobile/src/application/nodes/nodes-controller.ts` (+ `.int.test.ts`): capture the
    companion before the first await; pass `origin`; `NodesState.origin`; refresh loads it. Test:
    a disconnect during the fetch still stores the origin captured at start (lesson).
- Proves: AC1/AC4 data provenance ("as of the last sync"), AC6 (only contact sync and self info:
  the controller test asserts the only frame written by a sync is get-contacts).
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`,
  `pnpm mutation --mutate packages/storage/src/sync/contacts.ts`,
  `pnpm mutation --mutate packages/meshcore-adapter/src/client/mesh-client.ts`.
- Human checks: none.

### Phase 3: Nearest repeater card on the Dashboard
- Files:
  - `apps/mobile/src/application/nodes/nearest-presenter.ts` (+ `.test.ts`): new. Contract:
    `nearestCard`, `formatDistance`, `CandidateModel`.
  - `apps/mobile/src/components/nearest-repeater-card.tsx`: new card (D-6, D-9).
  - `apps/mobile/src/app/index.tsx`: card as `ListHeaderComponent` (D-10).
  - `apps/mobile/src/i18n/en.json`: `nearest.*` keys incl. compass words (D-8), plurals.
  - `apps/mobile/src/i18n/catalog.test.ts`: every `nearest.*` / compass key exists; no
    `nearest.*` text contains "in range", "online", "reachable" (AC4).
- Proves: AC1 (model has name, path, position, last heard, run button state), AC3 (each missing
  text, D-5 precedence), AC4 (catalog test), AC5 (empty model with sync hint), D-7 rounding table —
  unit tests on the presenter.
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`.
- Human checks: card layout and wording on the emulator screenshots from phase 4 (see there).

### Phase 4: Fake scenario and e2e
- Files:
  - `packages/meshcore-adapter/src/transport/nearest-script.ts` (+
    `test/nearest-script.int.test.ts`): new; the test decodes the edited frames and asserts each
    edit, and that everything else equals the recorded script. Exported from `src/index.ts`.
  - `apps/mobile/src/platform/fake/fake-ble-platform.ts`: attempt option `nearest: true`.
  - `apps/mobile/src/debug/scenarios.ts`: scenario `nearest`.
  - `apps/mobile/e2e/nearest-positions.yaml`: connect with `nearest`, assert card name, "Last known
    path: direct", distance + direction text, last heard; open "Other nearby", assert the next
    names in order; screenshot `nearest-with-positions`; tap "Run diagnostic on <name>", confirm
    the airtime notice, see "Step: Login · Attempt 1 of 2", Cancel.
  - `apps/mobile/e2e/nearest-no-positions.yaml`: fresh launch shows the empty card (AC5) —
    screenshot `nearest-empty`; connect with `connect-ok`, assert "Path unknown" and "Companion
    position not set"; screenshot `nearest-without-positions`.
  - `context/test-plan.md`, `stryker.targets`: D-11.
  - `context/changes/nearest-repeater/evidence/`: the three screenshots (< 300 KB each).
- Proves: roadmap e2e acceptance (card shows expected repeater, "Other nearby" lists the next
  ones, Run diagnostic from the card starts a run; screenshots with and without positions).
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm e2e` (all flows, so the card
  does not break existing dashboard flows).
- Human checks:
  - Look at `evidence/nearest-with-positions.png`, `nearest-without-positions.png`,
    `nearest-empty.png`: wording reads as "last known"/"advertised", nothing suggests live
    reachability; the card does not crowd the list.
  - Real hardware with the CI APK (`android-apk` artifact, test-plan *Install a PR build*):
    connect to the companion, let the sync finish, and compare the card's repeater, hop line and
    distance with the MeshCore app's contact details for the same repeater (`out_path_len`
    and advertised position are `UNVERIFIED`). Note whether the companion position shows as set.

## Risks and unknowns
- `out_path_len` encoding on firmware 1.17 (hash-size bits) and whether repeaters advertise
  positions are `UNVERIFIED`; the recorded capture has only unknown paths and 0,0 positions. A
  wrong decode shows a wrong hop count, fixed in the adapter without a schema change (hops column
  stays valid).
- The recorded companion has no position, so most real operators may first see "Companion
  position not set"; ranking then falls back to hops and last heard, which is still AC2-correct.
- Maestro matching: the card adds "Run diagnostic" and last-heard texts to the Dashboard. The card
  button's accessibility label differs ("Run diagnostic on …"), and existing diag flows tap
  "Run diagnostic" only on the node screen; `pnpm e2e` runs every flow in phase 4 to catch
  ambiguity.
- `NodeRepository` interface change touches every fake repository in tests.

## Progress
<!-- One line per phase. /implement ticks it in the phase's own commit. -->
- [x] Phase 1: Domain geometry and ranking
- [x] Phase 2: Decode, store and load path, position and sync origin
- [x] Phase 3: Nearest repeater card on the Dashboard
- [x] Phase 4: Fake scenario and e2e

## Human checks
<!-- Filled by /implement: one open checkbox per human check, with how to run it and evidence. -->
- [ ] (Phase 4) Wording reads as "last known"/"advertised", nothing suggests live reachability, the card does not crowd the list — run: open the screenshots — evidence: `context/changes/nearest-repeater/evidence/nearest-with-positions.png`, `nearest-without-positions.png`, `nearest-empty.png`
- [ ] (Phase 4) Real hardware, CI APK (`android-apk` artifact, test-plan *Install a PR build*): connect, let the sync finish, compare the card's repeater, hop line and distance with the MeshCore app's contact details for the same repeater (`out_path_len` and positions are UNVERIFIED); note whether the companion position shows as set — run: install APK, connect — evidence: none

## Deviations
<!-- [minor] / [REVIEW] / [FOLLOW-UP] / [STUCK] entries, see autonomy.md section 3 -->
- [REVIEW] Plan-review 1 (partial sync from another companion): `rankRepeaters` and `nearestRepeaters` take an optional `syncedAt`; the Dashboard passes `origin.at` (phase 3), so only nodes the last sync reported are ranked and labelled "as of the last contact sync". Phase 2 needs a contact-sync test for a partial sync from another companion. Alternative: a `path_companion_key` column per node.
- [REVIEW] Review R2 supersedes the `syncedAt` deviation above: migration `0003` gained nullable `devices.path_companion_key` (the alternative named there), written by `applyContactSync`; `rankRepeaters` filters on `pathCompanionKey === origin.companionPublicKey`, so a partial sync from the same companion keeps unreported repeaters. The migration is unreleased, so no new migration. This extends D-1's shape (costly) additively.
- [minor] Plan-review 2: the D-11 edits to `context/test-plan.md` and `stryker.targets` were done in phase 1, with the files they cover.
- [minor] Plan-review 3: builders in `presenter.test.ts`, `catalog.test.ts`, `node.test.ts`, storage tests and the controller test got `pathHops: null, position: null`; `capabilities.test.ts`, `check.test.ts` and `handshake-script.int.test.ts` needed no change (typecheck green).
- [minor] Phase 2: `NodesController.sync` decides `TRANSPORT_UNAVAILABLE` itself when the session is not connected at the start (after the repository step, as before), instead of calling `fetchContacts`, which would have failed the same way; the `scripted` test session now starts connected. `migrate.int.test.ts` asserted version `2` after migrating from 1; it now asserts `MIGRATIONS.length`, and a v2→v3 test was added. Test frame builders (`contactFrame`, `selfInfoFrame`) take optional lat/lon.
- [REVIEW] Review R7: PR #19 D-3 (room servers are candidates, heading "Nearest node", role shown) overrules the repeaters-only wording of PRD FR-21 AC1/AC2/AC5; `context/prd.md` FR-21 was updated to match, and the Goal and Design texts here follow. Alternative: keep FR-21 as written and drop room servers.
- [minor] Review R8: 945f395 also made the nearest candidate a link to `/node/[id]` (like the "Other nearby" entries, D-6/D-9), so a tap on the card opens the node screen; it was not asked at PR #19. Alternative: remove the `Link` wrapper in `nearest-repeater-card.tsx`.
- [FOLLOW-UP] Plan-review 5: S-08 export must leave out or redact the companion position (`contact_sync_origin`) and node positions by default and list them in the preview.

- [minor] Phase 3: the "other nearby" compass word is a nested `Text` in the distance line's params (`NearestText`), resolved in the card; the card reuses `runButton` (already covered by presenter tests) so no separate disabled-reason test was added. The card renders nothing until the node list is loaded.

- [minor] Phase 4: the card sits above the list, so the diag-cancel, diag-no-response and contacts-sync flows had `assertVisible` on a row text that moved off-screen; they now use `scrollUntilVisible`. The derived "Sensor test" contact shares the key prefix of the first repeater, so it also gets the edit (it is not a repeater, no effect on the card).

## Review response
<!-- revise mode only: one line per plan-review finding and what changed -->
- 1 (major): handled in the ranking with a `syncedAt` filter (Deviations; superseded by review R2, now a `path_companion_key` filter), tests in phase 1 (`nearest.test.ts`) and phase 2.
- 2: D-11 moved into phase 1 (done).
- 3: line number and builder list noted in Deviations; typecheck covers the rest.
- 4: phase 3: the card component computes `runButton` from `session.store` and `runs.store` like `RunPanel` (cooldown from `runs.store.latest`), with a disabled-reason test.
- 5: `[FOLLOW-UP]` for S-08 in Deviations.
- 6: phase 2: capture the companion before the first await but decide the outcome after the repository step, keeping today's order.
