# Plan: guest-password (S-05)

## Goal and end state
- The node details screen has a **Guest password** card. The user can save a password for that node
  and remove it. The password is written only to Keystore-backed secure storage
  (expo-secure-store), under a key made from the node public key (FR-14 AC1). It is never shown again,
  logged or written to SQLite (FR-14 AC2).
- A diagnostic run reads the node's stored password when it starts and sends it in the guest login.
  With no stored password it sends an empty one, the open guest login (FR-05 AC2). A rejected
  login still ends the run with `LOGIN_REJECTED` (already in S-04).
- The application layer has `remove(publicKey)` and `clearAll()` operations that leave no secret
  behind. S-09's "delete node history" and "clear all data" call them (FR-14 AC3, TR-21; see D-3).
- One integration test runs sync, save password, diagnostic run against a file-backed SQLite DB
  and captured console output, then scans the DB files and the log for the canary `pw-LEAK-CANARY`
  (FR-14 AC2, TR-09). The export part of TR-09 stays with S-08 (D-8).

## Scope
- In: `SecretStore` port, `GuestPasswords` application service with a Zustand store, Expo and
  in-memory implementations, composition wiring (replacing `password: async () => ""`), password
  validation in domain, node-screen card, i18n strings, e2e flow, leak test, test-plan updates.
- Out: the "delete node history" and "clear all data" screens and the deletion of rows (S-09; they
  call `GuestPasswords.remove` / `clearAll`). Export and its secret scan (S-08). Biometric gating
  (tech-stack: not needed). Showing a stored password again.

## Findings
- The password port already exists: `GuestPasswordSource = (publicKey) => Promise<string>` in
  `apps/mobile/src/application/diagnostics/ports.ts:15`. The composition root wires
  `password: async () => ""` (`apps/mobile/src/composition/index.ts:44`, run-diagnostic plan D-16).
  S-05 swaps that line.
- `RunController.execute` reads the password inside the `runChecks` argument list
  (`apps/mobile/src/application/diagnostics/run-controller.ts:172`), after the progress state is
  set and before any frame is written. If the read throws, the outer catch stores the run as
  `NOT_TESTED` / `UNEXPECTED_ERROR` (`run-controller.ts:186`, `packages/domain/src/diagnostics/classify.ts:28`)
  and nothing goes on the radio.
- The login frame is `CMD_SEND_LOGIN (26)`, 32-byte public key, then the password as UTF-8 to the
  end of the frame (`node_modules/@liamcottle/meshcore.js/src/connection/connection.js:230-235`,
  `buffer_writer.js:45`: `TextEncoder`). meshcore.js comments "max 15 characters". The firmware
  holds the password in a 16-byte C string, so the real limit is 15 **bytes**. This is UNVERIFIED
  on hardware; `tools/capture/src/config.ts:15` applies 15 characters.
- `MeshClient` sends `request.password` as given (`packages/meshcore-adapter/src/client/mesh-client.ts:281`).
  `FakeTransport` records written frames, so a test can read the password bytes in the login frame.
- expo-secure-store is **not installed** yet. tech-stack pins it at 57.0.4 (`context/tech-stack.md:18`).
  API (docs.expo.dev, securestore): `getItemAsync(key)`, `setItemAsync(key, value)`,
  `deleteItemAsync(key)`. Keys may contain only `[A-Za-z0-9._-]`. There is **no list or clear-all
  call**, so clearing every secret needs a record of which keys exist (D-2). The config plugin
  option `configureAndroidBackup: true` keeps `SecureStore` shared preferences out of
  cloud backup and device transfer (D-10).
- Small persisted stores follow one pattern: a `Kv…Store` on `expo-sqlite/kv-store` in
  `apps/mobile/src/platform/` plus an `InMemory…` double in `apps/mobile/src/platform/fake/in-memory.ts`.
  Real SQLite and KV are used in fake builds too (run-diagnostic D-13). Only the radio is faked.
- Validation pattern: `normalizeLabel` in `packages/domain/src/nodes/node.ts:79` returns a
  `{ ok, value } | { ok: false, reason }` result. The node screen shows `TOO_LONG` / `STORAGE_ERROR`
  as `accessibilityRole="alert"` text (`apps/mobile/src/app/node/[id].tsx:84-87,150-154`).
- Nothing deletes nodes or clears data yet (grep: no delete path in `packages/storage/src`). FR-14
  AC3 depends on features S-09 owns (roadmap S-09 *Decided up front*: "hard delete … including
  secrets").
- Mobile tests (`vitest` project `mobile`) do not use real SQLite. `openTestDb` lives in
  `packages/storage/test/helpers/open-test-db.ts` and is not exported (D-9).
- e2e: 18 flows plus `lib/` (test-plan cookbook: guideline ~15, S-12 went to 18 with plan D-13).
  `clearState: true` wipes app data, secure-store prefs included.

## Decisions
| ID | Question | Chosen | Alternatives (and what they would buy) | Why | Reversal | Decided by |
|----|----------|--------|----------------------------------------|-----|----------|------------|
| D-1 | Port and key scheme in secure storage | Domain port `SecretStore { get(key), set(key, value), delete(key) }` (strings, `null` = absent). Keys `guest-password.<publicKey>` (64 lower-case hex). Only `GuestPasswords` builds keys | B: port shaped around passwords (`getPassword(publicKey)`). Each implementation would carry the key scheme and index logic. C: hash the public key in the key. It hides nothing, since public keys are public | tech-stack: "Domain defines the ports (… `SecretStore` …)". A generic three-call port matches expo-secure-store, so the Expo wrapper stays thin and untested (test-plan *Not tested*). All key logic sits in one tested file | costly (persisted key format) | agent |
| D-2 | How "clear all" finds every secret (expo-secure-store cannot list keys) | An index entry `guest-password.index` in the same `SecretStore`: a JSON array of public keys. Set: add to the index, then write the value. Delete: delete the value, then drop it from the index. `clearAll` deletes every indexed value, then the index | B: no index. `clearAll(publicKeys)` gets the list from `NodeRepository.listAll()`. No extra state, but it misses a secret when the row is gone first or the DB was reset, and S-09 must delete in the right order. C: keep the index in SQLite/KV. It splits one invariant across two stores | The index stays with the secrets, so `clearAll` works whatever state the DB is in (TR-21). With the write order, a crash leaves at worst an index entry with no value, which is harmless; it never leaves a value with no index entry | costly (persisted shape) | agent |
| D-3 | FR-14 AC3 before delete/clear features exist | S-05 adds `GuestPasswords.remove(publicKey)` and `clearAll()` and tests that no key is left (AC3 at use-case level). S-09 calls them from its delete/clear flows. Logged as `[REVIEW]` deviation | B: S-05 builds "Delete node" and "Clear all data" now. This takes S-09 scope (confirmation, rows, labels) and adds a node delete the PRD does not define. C: move AC3 to S-09 entirely. The secret API would then be untested in the slice that adds it | Cheapest. It keeps scope to the roadmap item and gives S-09 a single call. The roadmap/PRD conflict reaches the PR (lesson: log a roadmap conflict as `[REVIEW]`) | cheap | agent |
| D-4 | Password validation | Domain `validateGuestPassword(input)`. Kept exactly as typed (no trim; spaces may matter, matches `tools/capture/src/config.ts`). Empty → `EMPTY`. More than 15 UTF-8 bytes → `TOO_LONG`. The message names the limit | B: limit 15 characters (as the capture tool does). Multi-byte input would then be silently cut by the firmware. C: no limit. Long passwords would be truncated on the node and the login rejected for no visible reason | The frame is UTF-8 (`TextEncoder`) and the firmware buffer is bytes. A byte limit is the honest boundary. UNVERIFIED on hardware; human check 1 covers it | cheap | agent |
| D-5 | Card behaviour and wording | Status line "Guest password saved" / "No guest password, the app tries an open guest login". The field is empty, `secureTextEntry`, never pre-filled, and cleared after save. "Save password" is disabled while the field is empty. "Remove password" is shown only when one is saved. Help: "Up to 15 bytes. Kept only in this phone's secure storage." The card sits **below** the role card, so no existing element moves | B: label convention "empty save removes". Since the field never shows the stored value, an accidental tap on Save would delete it. C: show the password with an eye toggle. That needs a read path into the UI and breaks "never shown again" | The status is text, never colour alone (NFR-05). Not showing the secret keeps it out of the UI tree and screenshots. Putting the card below the role card keeps the existing e2e flows stable (lesson: added height) | cheap | agent |
| D-6 | Secret store in fake (e2e) builds | Real `ExpoSecretStore` in both modes, as with SQLite and KV (run-diagnostic D-13). `InMemorySecretStore` only in Vitest | B: in-memory in fake mode, like `lastCompanion`. The e2e restart step could not prove persistence and the Expo wrapper would get no automated run | Only the radio is faked. The e2e is the one automated exercise of the Keystore wrapper (emulator has a Keystore) | cheap | agent |
| D-7 | Secure storage fails | Reading at run start: existing path, run stored `NOT_TESTED` / `UNEXPECTED_ERROR`, nothing sent. Loading the card status: "Could not read the saved password" (alert text, Save/Remove still offered). Save/remove fail: "Could not save the password" / "Could not remove the password" (alert). Errors are never logged with the value | B: on read failure, run with an empty password. This sends a login that will probably be rejected and stores a misleading `LOGIN_REJECTED` | Honest status: an unknown failure gets a neutral reason (lesson: error mapper default branch). Nothing goes on air for a run that cannot be what the user configured | cheap | agent |
| D-8 | Roadmap acceptance "a test scans … export output" when no export exists | The S-05 leak test scans the SQLite files and captured console output. The export scan stays planned for S-08 (TR-09 row already says "planned (S-05, S-08)"). Logged as `[REVIEW]` | B: build a throwaway export stub to scan. It proves nothing about the real S-08 export | No export exists to scan. S-08 owns FR-13 AC4, which scans exports for stored secrets | cheap | agent |
| D-9 | How a mobile test gets file-backed SQLite | Add a test-only subpath export `@guardian/storage/testing` → `test/helpers/open-test-db.ts` (re-exports `openTestDb`). App code never imports it; a lint `no-restricted-imports` entry forbids it outside `*.test.ts` | B: relative import across packages (breaks package boundaries, likely blocked by lint). C: put the leak test in `packages/storage/test`. Storage cannot import the run controller, so it would only test the repositories, not the app flow | The leak test must drive the real controllers into the real SQLite schema, so it lives in `apps/mobile` | cheap | agent |
| D-10 | Android backup of secure-store data | Add plugin `["expo-secure-store", { "configureAndroidBackup": true }]` to `app.json` | B: no plugin entry. Default auto-backup includes shared prefs; the values are useless without the Keystore key, but they still leave the phone | Privacy: local data only (C-04). One config line | cheap | agent |
| D-11 | e2e coverage | New flow `guest-password.yaml`: connect (`diag-ok`), open node, save password, see "Guest password saved", `stopApp`/`launchApp` (no clearState) still saved, run diagnostic → "Responded", remove → "No guest password". 19 flows | B: append steps to `contacts-label-restart.yaml`. That mixes FR-04 and FR-14 in one flow and makes failures harder to read | One flow per feature, as for S-03/S-04. The count above ~15 is noted in the test-plan cookbook | cheap | agent |
| D-12 | Concurrent save/remove on the index | `GuestPasswords` runs secure-store operations one at a time (internal promise chain). | B: no serialisation. Two quick saves could each read the old index and one entry would be lost, so `clearAll` would leave that secret behind | Keeps D-2's invariant without locks in the port | cheap | agent |

## Design
**Domain** (`packages/domain`, pure TS):
- `src/secrets/secret-store.ts`:
  `interface SecretStore { get(key: string): Promise<string | null>; set(key: string, value: string): Promise<void>; delete(key: string): Promise<void>; }`
- `src/nodes/guest-password.ts`: `GUEST_PASSWORD_MAX_BYTES = 15`;
  `validateGuestPassword(input: string): { ok: true; value: string } | { ok: false; reason: "EMPTY" | "TOO_LONG" }`
  (byte length via `new TextEncoder().encode(input).length`).

**Application** (`apps/mobile/src/application/nodes/guest-passwords.ts`), class `GuestPasswords`:
- ctor `(store: SecretStore)`; `readonly store: StoreApi<GuestPasswordsState>` with
  `GuestPasswordsState = { saved: Record<string, "yes" | "no" | "error"> }` (per public key, as last read).
- `load(publicKey): Promise<void>`: reads presence into `saved` (`"error"` on throw).
- `password(publicKey): Promise<string>`: stored value or `""`; throws on store failure (D-7). This is
  the `GuestPasswordSource` passed to `RunController`.
- `save(publicKey, input): Promise<SaveResult>` with
  `SaveResult = { ok: true } | { ok: false; reason: "EMPTY" | "TOO_LONG" | "STORAGE_ERROR" }`.
- `remove(publicKey): Promise<{ ok: boolean }>`, `clearAll(): Promise<void>` (throws on failure, so S-09 can
  report it).
- Key helpers and the index (D-1, D-2) are private to this file. All store calls go through one
  promise chain (D-12). The value is never put in state, thrown errors or logs.

**Platform** (`apps/mobile/src/platform/`):
- `secure-store.ts`: `ExpoSecretStore implements SecretStore` (getItemAsync/setItemAsync/deleteItemAsync).
- `fake/in-memory.ts`: `InMemorySecretStore` (a `Map`, with `keys()` for tests) and a `failWith` switch
  for error-path tests.

**Composition**: `container.passwords = new GuestPasswords(new ExpoSecretStore())`;
`runs` gets `password: (key) => passwords.password(key)`.

**UI**: the `GuestPasswordCard` in `app/node/[id].tsx`, below the role card (D-5). `testID`s:
`password-input`, buttons labelled by their text. Status words come from `en.json` under `password.*`.

**Data flow**: Save → `validateGuestPassword` → `SecretStore.set` (index, then value) → `saved[key] = "yes"`.
Run → `RunController.execute` → `passwords.password(key)` → `MeshClient.runChecks({ password })` →
login frame. Nothing about the password goes to `DiagnosticRunRepository`.

## Phases
### Phase 1: Secret storage and run wiring
- Files:
  - `packages/domain/src/secrets/secret-store.ts`: new port. Contract: `SecretStore` (D-1).
  - `packages/domain/src/nodes/guest-password.ts` + `.test.ts`: validation (D-4). Contract:
    `validateGuestPassword`, `GUEST_PASSWORD_MAX_BYTES`. Table test: "", " ", 15 ASCII, 16 ASCII,
    7 × "ż" (14 bytes) ok, 8 × "ż" (16 bytes) `TOO_LONG`, leading space kept.
  - `packages/domain/src/index.ts`: export both.
  - `apps/mobile/src/application/nodes/guest-passwords.ts`: service (Design). Contract: `GuestPasswords`
    API, key `guest-password.<publicKey>`, index `guest-password.index` (D-1, D-2, D-12).
  - `apps/mobile/src/application/nodes/guest-passwords.int.test.ts`: with `InMemorySecretStore`:
    save → value under the key, index lists it (AC1); save twice → one index entry; two concurrent saves →
    both indexed (D-12); `remove` → key and index entry gone (AC3); `clearAll` with three nodes → store
    has no keys at all (AC3, TR-21); `password` → `""` when none; `failWith` → `STORAGE_ERROR`,
    `saved = "error"`, `password` rejects; no state field contains the value.
  - `apps/mobile/src/application/diagnostics/ports.ts`: update the comment on `GuestPasswordSource`
    (no type change).
  - `apps/mobile/src/application/diagnostics/run-controller.int.test.ts`: FR-05 AC2: stored
    `pw-LEAK-CANARY` → the login frame written to `FakeTransport` ends with its UTF-8 bytes. No stored
    password → login frame is exactly 33 bytes. A failing secret store → run `NOT_TESTED` /
    `UNEXPECTED_ERROR` and no remote frame written (D-7).
  - `apps/mobile/src/platform/fake/in-memory.ts`: `InMemorySecretStore`.
  - `apps/mobile/src/platform/secure-store.ts`: `ExpoSecretStore` (thin, untested per test-plan).
  - `apps/mobile/package.json` + `pnpm-lock.yaml`: `expo-secure-store` `~57.0.4` (tech-stack pin; use
    `pnpm --filter mobile exec expo install expo-secure-store` so the SDK-matched version is chosen).
  - `apps/mobile/app.json`: plugin `["expo-secure-store", { "configureAndroidBackup": true }]` (D-10).
  - `apps/mobile/src/composition/index.ts`: wire `passwords` and the `runs` password source. Remove the
    "empty password until S-05" comment.
  - `packages/storage/package.json`: `"./testing"` subpath export. `packages/storage/test/helpers/index.ts`
    if a re-export is needed. `eslint.config.mjs`: restrict `@guardian/storage/testing` to test files (D-9).
  - `apps/mobile/src/application/nodes/guest-password-leak.int.test.ts`: FR-14 AC2 / TR-09. File-backed
    `openTestDb`, real `SqliteNodeRepository` + `SqliteDiagnosticRunRepository`, `CompanionSession` on
    `FakeBlePlatform(SCENARIOS["diag-ok"])`, `NodesController` sync, `GuestPasswords.save(ROOM_K, "pw-LEAK-CANARY")`,
    one completed run through `RunController`. Spy on every `console` method. Close the DB, then read
    `path`, `path-wal`, `path-shm` (those that exist) as bytes and assert that neither the UTF-8 bytes nor
    the hex of the canary occurs in them or in the captured log. Sanity: the login frame did carry the canary,
    so the test cannot pass by never sending it.
- Proves: FR-14 AC1 (integration, in-memory store), FR-14 AC2 (integration, SQLite file scan), FR-14
  AC3 at use-case level (integration, D-3), FR-05 AC2 (integration, frame bytes), TR-09 (S-05 part), TR-21
  (secret part).
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`.
  `pnpm mutation --mutate apps/mobile/src/application/nodes/guest-passwords.ts` is run by `/mutation`.
- Human checks: none (no UI yet).

### Phase 2: Guest password card, e2e and docs
- Files:
  - `apps/mobile/src/app/node/[id].tsx`: `GuestPasswordCard` below the role card (D-5). It calls
    `passwords.load(node.publicKey)` on mount, uses `secureTextEntry` and `autoCapitalize="none"`,
    `autoCorrect={false}`, clears the field after a successful save, and shows errors as `accessibilityRole="alert"`
    text (D-7). Contract: `testID="password-input"`, accessibility label "Guest password".
  - `apps/mobile/src/application/nodes/presenter.ts` + `presenter.test.ts`: `passwordStatusText(saved)`
    → text key for `"yes" | "no" | "error"`, and `passwordErrorText(reason)` (unit, table).
  - `apps/mobile/src/i18n/en.json`: `password.heading`, `password.saved`, `password.none`,
    `password.readFailed`, `password.help`, `password.save`, `password.remove`, `password.tooLong`,
    `password.saveFailed`, `password.removeFailed`. The catalog test still forbids "offline/down/dead".
  - `apps/mobile/e2e/guest-password.yaml`: flow from D-11, with `takeScreenshot` of the card (saved state),
    and a negative assertion that the canary text is not visible after save.
  - `context/test-plan.md`: TR-09 → "covered (S-01 capture, S-05 SQLite and logs); planned (S-08 export)".
    TR-21 → "covered (S-05 secrets); planned (S-09 rows)". Add `guest-passwords.ts` to *Mutation targets*
    (80 %, report; TR-09, TR-21). Cookbook: e2e flow count 19 with this flow named.
  - `context/changes/guest-password/evidence/`: e2e screenshots (light theme, card saved and none), each under
    300 KB.
- Proves: FR-14 AC1 user path and persistence across restart (e2e), FR-05 AC2 end to end with a saved
  password (e2e, fake radio), NFR-05 status in words (e2e asserts the text).
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm e2e` (full suite, lesson: added height /
  shared screens). Before committing, grep `apps/mobile/e2e` for `label-input`, "Save label", "Add to Dashboard"
  and role buttons and confirm that the flows using them still pass.
- Human checks:
  1. Real hardware, CI APK (`android-apk` artifact), companion connected, Room K: save the real guest password
     → Run diagnostic → login step responded. Then save a deliberately wrong password, wait for the cooldown,
     run → "Login rejected". Remove the password. Confirms D-4 and the UNVERIFIED login behaviour. Evidence: the
     run details screen.
  2. Card wording and look in light and dark (screenshot in `evidence/`, or the phone): status reads clearly,
     the stored password is never shown, Remove appears only when a password is saved.

## Risks and unknowns
- The 15-byte limit and the firmware's handling of a non-empty password on an open-guest node are
  UNVERIFIED (PRD §8). Human check 1 covers it; if the firmware disagrees, only `GUEST_PASSWORD_MAX_BYTES` changes.
- Adding a native module (`expo-secure-store`) requires a rebuild of the e2e APK. `pnpm e2e` builds it,
  but the first run is slower. If the build fails on SDK version mismatch, `expo install` picks the matched
  version (log `[minor]`).
- The storage `./testing` export pulls `node:sqlite` into anything that imports it. The lint rule (D-9) keeps it
  out of app code; Metro never sees it.
- S-09 must call `GuestPasswords.clearAll()` / `remove()`. Logged as `[FOLLOW-UP]` so it is not forgotten.

## Progress
<!-- One line per phase. /implement ticks it in the phase's own commit. -->
- [x] Phase 1: Secret storage and run wiring
- [x] Phase 2: Guest password card, e2e and docs

## Human checks
<!-- Filled by /implement: one open checkbox per human check, with how to run it and evidence. -->
- [ ] (Phase 2) Real hardware, Room K, guest password: save the real password, Run diagnostic, login step responded; then save a deliberately wrong password, wait for the cooldown, run, expect "Login rejected"; then Remove password. Confirms the 15-byte limit (D-4) and the UNVERIFIED login behaviour — run: install the CI APK (`android-apk` artifact), connect the companion, open Room K — evidence: the run details screen (none yet)
- [ ] (Phase 2) Card wording and look in light and dark: status reads clearly, the stored password is never shown, Remove appears only when a password is saved — run: open any node on the CI APK or the emulator build, toggle the theme — evidence: `context/changes/guest-password/evidence/guest-password-saved.png`, `guest-password-none.png` (light theme only; dark not captured)

## Deviations
<!-- [minor] / [REVIEW] / [FOLLOW-UP] / [STUCK] entries, see autonomy.md section 3 -->
- [minor] Phase 1: domain has no `TextEncoder` type (no DOM/node lib), so `validateGuestPassword` counts UTF-8 bytes by code point instead.
- [minor] Phase 1: `apps/mobile/tsconfig.json` gained `"types": ["node"]` so the leak test and the storage test helper typecheck. Node globals are now visible to app code at type level; the lint rules still forbid `node:sqlite` there.
- [minor] Phase 1: `expo install` reformatted `app.json`; reverted and added the `expo-secure-store` plugin line by hand (pinned `~57.0.4`).
- [minor] Phase 1: the lint block for `@guardian/storage/testing` is a separate `apps/mobile/**/*.test.ts` layer restating the full list (plan-review 1); `layer-rules.test.ts` covers test file allowed / app file rejected.
- [minor] Phase 2: the Guest password card sits at the bottom of the node screen, after "Add to dashboard", not directly below the role card. Plan says below the role card; the first e2e run showed `contacts-sync` could not find "Add to dashboard" (added height), so the card moved below it and no existing flow changed.
- [minor] Phase 2: `guest-password.yaml` runs the diagnostic before the restart and checks only persistence after it (plan-review 3). The e2e is a smoke check for FR-05 AC2; the frame bytes are proved by the run-controller integration test (plan-review 4).
- [minor] Phase 2: only light-theme screenshots were taken; dark is left to human check 2.
- [REVIEW] FR-14 AC3 / roadmap S-05: the roadmap says "deleting a node or clearing data deletes its secret",
  but neither a node delete nor "clear all data" exists before S-09. S-05 proves AC3 at the use-case level
  (`GuestPasswords.remove` / `clearAll`), and S-09 wires it into its flows (D-3). Alternative: build both
  deletion features here.
- [REVIEW] Roadmap S-05 acceptance "a test scans the SQLite file and export output": there is no export until
  S-08. S-05 scans the SQLite files and the log output; the export scan stays with S-08 (FR-13 AC4, D-8).
- [FOLLOW-UP] S-09: its delete-node-history and clear-all-data flows must call `container.passwords.remove(publicKey)`
  / `clearAll()` and test that the `SecretStore` is empty afterwards (TR-21).

## Review response
<!-- revise mode only: one line per plan-review finding and what changed -->
- Plan-review 1 (lint for `/testing`): handled in Phase 1 as a mobile test-file lint block plus two layer-rule cases.
- Plan-review 2 (leak test deletes files): the test closes `testDb.db`, scans, and `testDb.close()` runs in `afterEach`; it asserts the DB holds the synced public key.
- Plan-review 5, 7 (promise chain poisoning, bad index): covered by tests in `guest-passwords.int.test.ts`.
- Plan-review 3, 4, 6: Phase 2 (e2e) and D-10 wording; D-10 is an explicit default.
