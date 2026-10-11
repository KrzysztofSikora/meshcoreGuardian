# Review: sync-contacts

Verdict: APPROVE WITH FOLLOW-UPS
Gates: typecheck ok, lint ok, unit tests ok (45 files, 615 tests), e2e ok (9/9 flows, incl. contacts-sync and contacts-label-restart), mutation mesh-client.ts 87.95 % (18 survived, 2 no coverage), mutation nodes-controller.ts 75.15 % (21 survived, 20 no coverage) · Round: 1

## Plan vs diff
| File | Status | Note |
|------|--------|------|
| `packages/domain/src/nodes/node.ts` + `node.test.ts` | done | D-5, D-7, D-10, D-15 rules as planned |
| `packages/domain/src/nodes/ports.ts` | done | |
| `packages/domain/src/nodes/sync.ts` + `sync.test.ts` | done | |
| `packages/domain/src/index.ts` | done | |
| `packages/storage/migrations/0001_init.sql` | done | D-1 schema and CHECKs |
| `packages/storage/scripts/gen-migrations.mjs`, `src/migrations/generated.ts`, `package.json` | done | staleness test present |
| `packages/storage/src/driver.ts`, `migrate.ts`, `index.ts` | done | |
| `packages/storage/src/sync/contacts.ts` | done | D-8 merge, json_each key list |
| `packages/storage/src/nodes/node-repository.ts` | done | Zod row parse, `NodeNotFoundError` |
| `packages/storage/test/*` (helpers, migrate, contact-sync, node-repository, node-sql-driver, migrations-generated) | done | |
| `packages/storage/test/open-test-db.int.test.ts` | unplanned | logged deviation (async `openTestDb`) |
| `packages/meshcore-adapter/src/client/mesh-client.ts` | done | generalised pending handler, D-11 bounds |
| `packages/meshcore-adapter/src/client/errors.ts`, `src/index.ts` | done | |
| `packages/meshcore-adapter/src/transport/contacts-script.ts` | done | D-12, retimed per plan-review #3 |
| `packages/meshcore-adapter/test/mesh-client-contacts.int.test.ts`, `contacts-script.int.test.ts` | done | |
| `apps/mobile/src/application/connection/companion-session.ts` + int test | done | `fetchContacts`; also aborts fetches on disconnect/dispose (logged deviation); unrelated reformat of the `scan` call |
| `apps/mobile/src/application/nodes/nodes-controller.ts` + int test | done | partial-sync and two error mappings untested (R2) |
| `apps/mobile/src/application/nodes/presenter.ts` + test | done | |
| `apps/mobile/src/platform/sqlite/expo-sql-driver.ts` | done | D-19 mutex |
| `apps/mobile/src/platform/sqlite/expo-sql-driver.test.ts`, `open-guardian-db.ts` | unplanned | logged deviation (phase 5) |
| `apps/mobile/src/platform/fake/fake-ble-platform.ts` | done | |
| `apps/mobile/src/composition/index.ts`, `apps/mobile/package.json` | done | |
| `apps/mobile/src/app/index.tsx`, `components/node-row.tsx` | done | empty-state text wrong when only chat contacts exist (R5) |
| `apps/mobile/src/app/node/[id].tsx` | diverged | reported name never shown once a label is set; "Reported as" hidden until an edit (R3) |
| `apps/mobile/src/components/translate.ts`, `i18n/catalog.test.ts` | unplanned | logged deviation (phase 6) |
| `apps/mobile/src/i18n/en.json` | done | |
| `apps/mobile/e2e/contacts-sync.yaml`, `contacts-label-restart.yaml` | done | plan-review #5 applied ("Syncing contacts…" asserted) |
| `docs/compatibility.md`, `context/test-plan.md` | done | |
| `context/changes/sync-contacts/{plan,plan-review,mutation}.md`, `evidence/*` | done | mutation.md skips `mesh-client.ts` with a wrong reason (R1) |
| `context/roadmap.md`, `pnpm-lock.yaml` | unplanned | status and lockfile, expected |

## Areas
| Area | Result | One-line reason |
|------|--------|-----------------|
| Correctness | ok | ACs met; merge rules, bounds and error model match the plan; e2e passes |
| Design | ok | layers respected; port in domain, SQL in storage, expo only in `platform/sqlite` |
| Safety | ok | bound parameters only; column names in `update()` are internal constants; no secrets |
| Tests | concern | untriaged survivors on mutation target `mesh-client.ts` (stale timers); controller partial-sync path untested |
| Simplicity | ok | small modules; cancellation has two owners (controller and session), see R2 note |
| Plan fidelity | concern | roadmap "protocol value kept for display" not met for the name (R3) |
| Agent decisions | ok | D-8 and D-9 (costly) each live in one place (`applyContactSync`, `in_contacts`) |

## Findings

### R1: Mutation target `mesh-client.ts` skipped; survivors in the new contacts code are untriaged
- Severity: major
- Where: `context/changes/sync-contacts/mutation.md:9`, `packages/meshcore-adapter/src/client/mesh-client.ts:230-232,240,251`
- Problem: `mesh-client.ts` is a test-plan mutation target (80 %), but `mutation.md` skips it as "only a thin `getContacts` call added". The diff adds 146 lines: a generalised `Pending` handler, `collectContacts` with three timers, and `finishPending`. `pnpm mutation --mutate packages/meshcore-adapter/src/client/mesh-client.ts --force` gives 87.95 % with these survivors in the new code: removing `clearTimeout(idleTimer)` (`:231`) or `clearTimeout(totalTimer)` (`:232`) in the contacts cleanup; removing `this.finishPending()` after `endOfContacts` (`:251`); and emptying the `expected === null` guard (`:240`), so a contact frame before `contactsStart` would be counted. The first three are the stale-timer class the connect-companion lesson names: if the cleanup is lost, the 120 s total timer from a finished sync fires `failPending` on whatever request is pending later (a second sync, or an S-04 diagnostic) and rejects it with `ContactsTimeoutError`. No test would notice. This also breaches the lesson "Re-run mutation … copy every survivor into `mutation.md`".
- Fix: Add tests to `mesh-client-contacts.int.test.ts`: (a) finish one sync, start a second `getContacts` on a transport that stays silent after `contactsStart`, advance past the first sync's 120 s point but before the second's bounds, and assert the second is still pending (kills `:231`, `:232`, `:251`); (b) script a `contact` frame before `contactsStart` and assert it is not in `contacts`. Then add a `mesh-client.ts` section to `mutation.md` with a decision for every survivor.
- Effort: small
- Lesson candidate: Run mutation on every test-plan target file the diff touches; never skip a target because its change looks small.
- Decision: open

### R2: `NodesController` never tests a partial sync or the UNSUPPORTED and MALFORMED mappings
- Severity: major
- Where: `apps/mobile/src/application/nodes/nodes-controller.ts:53-55,104,93`, `nodes-controller.int.test.ts`
- Problem: Mutation (`--force`) on `nodes-controller.ts` gives 75.15 %. `const complete = result.contacts.length === result.expected` → `true` survives. With that mutant, a partial sync is passed to `applySync` as `complete: true` and marks every absent node "Not in companion contacts". That is the case D-8 (costly) exists to prevent, and no test reaches it. `CommandRejectedError → UNSUPPORTED` and `MalformedFrameError → MALFORMED_RESPONSE` have no coverage, although Phase 5 claims "Proves … the error mapping". `if (this.syncing) return` also survives: the "second sync() does nothing" test passes because `MeshClient` refuses the second call as busy, not because of the controller guard. `mutation.md` neither lists this file as a target nor as skipped. Related simplicity note: the controller's own abort on disconnect (`:76`) and passing `signal` to `fetchContacts` (`:158`) also survive, because `CompanionSession` already aborts fetches itself. Cancellation has two owners.
- Fix: Add controller tests with a scripted transport (lesson: minimal port double): `contactsStart` count 3, two contacts, `endOfContacts` → `partial { received: 2, expected: 3 }` and `applySync` called with `complete: false`; an `err` frame → `failed(UNSUPPORTED)`; a truncated contact frame → `failed(MALFORMED_RESPONSE)`; for the guard, assert the state never leaves `syncing` between the two calls. Optionally drop the controller's disconnect subscription abort and keep `dispose()` as the only use of its `AbortController`.
- Effort: small
- Lesson candidate: no
- Decision: open

### R3: The reported name disappears once the user sets a label
- Severity: major
- Where: `apps/mobile/src/application/nodes/presenter.ts:44-49`, `apps/mobile/src/app/node/[id].tsx:58-64`
- Problem: Roadmap S-03 (user decision): "User-set role and label always override protocol-reported values; the protocol value is kept for display ('reported as …')". The plan goal says the same. `reportedName` is stored but no screen renders it (`grep reportedName apps/mobile/src` finds only tests). After a label is set, `nameText` shows the label and `reportedAsText` shows only the reported *role* ("Reported as Repeater"). The operator can no longer see which advertised name the label covers. Also, D-5 says the raw type is shown as "Reported as Unknown (type 4)", but `reportedAsText` returns `null` until the user edits something. So an untouched type-4 node never shows its type. The phase 6 deviation covers the role text only, not the name.
- Fix: When `userLabel !== null`, show "Reported name: <reportedName>" (new key `nodes.reportedName`) on the node screen. Show the "Reported as <role>" line always on the node screen, or at least whenever `reportedRole === "unknown"`. Extend `presenter.test.ts`, and assert the reported name in `contacts-label-restart.yaml`.
- Effort: small
- Lesson candidate: no
- Decision: open

### R4: Unclassified sync errors are shown as "the Bluetooth link was lost"
- Severity: minor
- Where: `apps/mobile/src/application/nodes/nodes-controller.ts:55`, `apps/mobile/src/i18n/en.json` `sync.failed.TRANSPORT_UNAVAILABLE`
- Problem: `failureFor` maps any error it does not recognise to `TRANSPORT_UNAVAILABLE`, which reads "Contact sync failed: the Bluetooth link was lost." One such error already exists: `MeshClient` rejects with `Error("busy")` when a request is in flight. The controller guard hides it today, but S-04 adds other requests, and the plan's risk section asks for "Contact sync in progress" there, not a vague message. The mutation run shows the effect: without the controller guard, the second call ends as "link was lost" while the link is fine. That breaks the CLAUDE.md honest-status rule.
- Fix: Map the busy case explicitly (a typed `BusyError` in the adapter → its own reason, or leave the state unchanged), and give other unknown errors a neutral text such as "Contact sync failed (unexpected error)" instead of claiming a link loss.
- Effort: small
- Lesson candidate: Do not let an error mapper's default branch claim a specific cause; unknown errors get a neutral reason.
- Decision: open

### R5: The Dashboard says "No contacts yet" when only chat contacts exist
- Severity: minor
- Where: `apps/mobile/src/app/index.tsx:79-83`
- Problem: With the Dashboard filter on and every stored node a chat contact (none pinned), `rows` is empty but `nodes.nodes.length > 0`, so the list shows `dashboard.empty` = "No contacts yet". The companion does have contacts, and they are listed under All contacts. The text is wrong.
- Fix: Use a filter-specific empty text for the Dashboard, for example "No repeaters or room servers yet. Chat contacts are under All contacts.", and keep "No contacts yet" for the All filter.
- Effort: small
- Lesson candidate: no
- Decision: open
