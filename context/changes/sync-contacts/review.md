# Review: sync-contacts

Verdict: APPROVE WITH FOLLOW-UPS
Gates: typecheck ok, lint ok, unit tests ok (45 files, 631 tests), e2e ok (9/9 flows), mutation (`--force`) presenter.ts 100 %, mesh-client.ts 90.36 % (14 survived, 2 no coverage), nodes-controller.ts 89.70 % (17 survived), companion-session.ts 78.2 % (55 survived, 3 no coverage) · Round: 2

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
| `apps/mobile/src/application/connection/companion-session.ts` + int test | done | `fetchContacts`; also aborts fetches on disconnect/dispose (logged deviation); test-plan mutation target never mutated in this change (R6) |
| `apps/mobile/src/application/nodes/nodes-controller.ts` + int test | done | R2 fixed: partial sync, UNSUPPORTED/MALFORMED/UNEXPECTED, guard and dispose tested |
| `apps/mobile/src/application/nodes/presenter.ts` + test | done | |
| `apps/mobile/src/platform/sqlite/expo-sql-driver.ts` | done | D-19 mutex |
| `apps/mobile/src/platform/sqlite/expo-sql-driver.test.ts`, `open-guardian-db.ts` | unplanned | logged deviation (phase 5) |
| `apps/mobile/src/platform/fake/fake-ble-platform.ts` | done | |
| `apps/mobile/src/composition/index.ts`, `apps/mobile/package.json` | done | |
| `apps/mobile/src/app/index.tsx`, `components/node-row.tsx` | done | R5 fixed: Dashboard filter has its own empty text |
| `apps/mobile/src/app/node/[id].tsx` | done | R3 fixed: "Reported name: …" under a label; unknown type always shown |
| `apps/mobile/src/components/translate.ts`, `i18n/catalog.test.ts` | unplanned | logged deviation (phase 6) |
| `apps/mobile/src/i18n/en.json` | done | |
| `apps/mobile/e2e/contacts-sync.yaml`, `contacts-label-restart.yaml` | done | plan-review #5 applied ("Syncing contacts…" asserted) |
| `docs/compatibility.md`, `context/test-plan.md` | done | |
| `context/changes/sync-contacts/{plan,plan-review,mutation}.md`, `evidence/*` | done | R1 fixed: `mesh-client.ts` and `nodes-controller.ts` triaged; `companion-session.ts` still missing (R6) |
| `packages/domain/src/nodes/sync.ts` + test, `en.json` | done | round 1: `UNEXPECTED` failure reason (R4), logged under *Deviations* |
| `context/lessons.md` | unplanned | two lessons proposed in round 1 |
| `context/roadmap.md`, `pnpm-lock.yaml` | unplanned | status and lockfile, expected |

## Areas
| Area | Result | One-line reason |
|------|--------|-----------------|
| Correctness | ok | R3, R4, R5 fixed as suggested; unknown errors now map to a neutral `UNEXPECTED` reason |
| Design | ok | layers respected; cancellation still has two owners, logged as FOLLOW-UP |
| Safety | ok | no new inputs or secrets in round 1 |
| Tests | concern | `companion-session.ts` (test-plan target) not mutated: 78 %, untriaged survivors in `fetchContacts` signal forwarding (R6); one controller survivor untriaged (R7) |
| Simplicity | ok | fixes are small and local |
| Plan fidelity | ok | roadmap "reported as …" now met for name and role |
| Agent decisions | ok | D-8 and D-9 (costly) each live in one place; round 1 decisions recorded under *Deviations* |

## Findings

### R1: Mutation target `mesh-client.ts` skipped; survivors in the new contacts code are untriaged
- Severity: major
- Where: `context/changes/sync-contacts/mutation.md:9`, `packages/meshcore-adapter/src/client/mesh-client.ts:230-232,240,251`
- Problem: `mesh-client.ts` is a test-plan mutation target (80 %), but `mutation.md` skips it as "only a thin `getContacts` call added". The diff adds 146 lines: a generalised `Pending` handler, `collectContacts` with three timers, and `finishPending`. `pnpm mutation --mutate packages/meshcore-adapter/src/client/mesh-client.ts --force` gives 87.95 % with these survivors in the new code: removing `clearTimeout(idleTimer)` (`:231`) or `clearTimeout(totalTimer)` (`:232`) in the contacts cleanup; removing `this.finishPending()` after `endOfContacts` (`:251`); and emptying the `expected === null` guard (`:240`), so a contact frame before `contactsStart` would be counted. The first three are the stale-timer class the connect-companion lesson names: if the cleanup is lost, the 120 s total timer from a finished sync fires `failPending` on whatever request is pending later (a second sync, or an S-04 diagnostic) and rejects it with `ContactsTimeoutError`. No test would notice. This also breaches the lesson "Re-run mutation … copy every survivor into `mutation.md`".
- Fix: Add tests to `mesh-client-contacts.int.test.ts`: (a) finish one sync, start a second `getContacts` on a transport that stays silent after `contactsStart`, advance past the first sync's 120 s point but before the second's bounds, and assert the second is still pending (kills `:231`, `:232`, `:251`); (b) script a `contact` frame before `contactsStart` and assert it is not in `contacts`. Then add a `mesh-client.ts` section to `mutation.md` with a decision for every survivor.
- Effort: small
- Lesson candidate: Run mutation on every test-plan target file the diff touches; never skip a target because its change looks small.
- Decision: fixed (2b15f2b) + lesson proposed

### R2: `NodesController` never tests a partial sync or the UNSUPPORTED and MALFORMED mappings
- Severity: major
- Where: `apps/mobile/src/application/nodes/nodes-controller.ts:53-55,104,93`, `nodes-controller.int.test.ts`
- Problem: Mutation (`--force`) on `nodes-controller.ts` gives 75.15 %. `const complete = result.contacts.length === result.expected` → `true` survives. With that mutant, a partial sync is passed to `applySync` as `complete: true` and marks every absent node "Not in companion contacts". That is the case D-8 (costly) exists to prevent, and no test reaches it. `CommandRejectedError → UNSUPPORTED` and `MalformedFrameError → MALFORMED_RESPONSE` have no coverage, although Phase 5 claims "Proves … the error mapping". `if (this.syncing) return` also survives: the "second sync() does nothing" test passes because `MeshClient` refuses the second call as busy, not because of the controller guard. `mutation.md` neither lists this file as a target nor as skipped. Related simplicity note: the controller's own abort on disconnect (`:76`) and passing `signal` to `fetchContacts` (`:158`) also survive, because `CompanionSession` already aborts fetches itself. Cancellation has two owners.
- Fix: Add controller tests with a scripted transport (lesson: minimal port double): `contactsStart` count 3, two contacts, `endOfContacts` → `partial { received: 2, expected: 3 }` and `applySync` called with `complete: false`; an `err` frame → `failed(UNSUPPORTED)`; a truncated contact frame → `failed(MALFORMED_RESPONSE)`; for the guard, assert the state never leaves `syncing` between the two calls. Optionally drop the controller's disconnect subscription abort and keep `dispose()` as the only use of its `AbortController`.
- Effort: small
- Lesson candidate: no
- Decision: fixed (ac610ad)

### R3: The reported name disappears once the user sets a label
- Severity: major
- Where: `apps/mobile/src/application/nodes/presenter.ts:44-49`, `apps/mobile/src/app/node/[id].tsx:58-64`
- Problem: Roadmap S-03 (user decision): "User-set role and label always override protocol-reported values; the protocol value is kept for display ('reported as …')". The plan goal says the same. `reportedName` is stored but no screen renders it (`grep reportedName apps/mobile/src` finds only tests). After a label is set, `nameText` shows the label and `reportedAsText` shows only the reported *role* ("Reported as Repeater"). The operator can no longer see which advertised name the label covers. Also, D-5 says the raw type is shown as "Reported as Unknown (type 4)", but `reportedAsText` returns `null` until the user edits something. So an untouched type-4 node never shows its type. The phase 6 deviation covers the role text only, not the name.
- Fix: When `userLabel !== null`, show "Reported name: <reportedName>" (new key `nodes.reportedName`) on the node screen. Show the "Reported as <role>" line always on the node screen, or at least whenever `reportedRole === "unknown"`. Extend `presenter.test.ts`, and assert the reported name in `contacts-label-restart.yaml`.
- Effort: small
- Lesson candidate: no
- Decision: fixed (ac610ad)

### R4: Unclassified sync errors are shown as "the Bluetooth link was lost"
- Severity: minor
- Where: `apps/mobile/src/application/nodes/nodes-controller.ts:55`, `apps/mobile/src/i18n/en.json` `sync.failed.TRANSPORT_UNAVAILABLE`
- Problem: `failureFor` maps any error it does not recognise to `TRANSPORT_UNAVAILABLE`, which reads "Contact sync failed: the Bluetooth link was lost." One such error already exists: `MeshClient` rejects with `Error("busy")` when a request is in flight. The controller guard hides it today, but S-04 adds other requests, and the plan's risk section asks for "Contact sync in progress" there, not a vague message. The mutation run shows the effect: without the controller guard, the second call ends as "link was lost" while the link is fine. That breaks the CLAUDE.md honest-status rule.
- Fix: Map the busy case explicitly (a typed `BusyError` in the adapter → its own reason, or leave the state unchanged), and give other unknown errors a neutral text such as "Contact sync failed (unexpected error)" instead of claiming a link loss.
- Effort: small
- Lesson candidate: Do not let an error mapper's default branch claim a specific cause; unknown errors get a neutral reason.
- Decision: fixed (ac610ad; neutral UNEXPECTED reason, typed busy error left as FOLLOW-UP in plan.md) + lesson proposed

### R5: The Dashboard says "No contacts yet" when only chat contacts exist
- Severity: minor
- Where: `apps/mobile/src/app/index.tsx:79-83`
- Problem: With the Dashboard filter on and every stored node a chat contact (none pinned), `rows` is empty but `nodes.nodes.length > 0`, so the list shows `dashboard.empty` = "No contacts yet". The companion does have contacts, and they are listed under All contacts. The text is wrong.
- Fix: Use a filter-specific empty text for the Dashboard, for example "No repeaters or room servers yet. Chat contacts are under All contacts.", and keep "No contacts yet" for the All filter.
- Effort: small
- Lesson candidate: no
- Decision: fixed (ac610ad)

### R6: `companion-session.ts` is a test-plan mutation target but was never mutated; `fetchContacts` signal forwarding is untested
- Severity: major
- Where: `context/changes/sync-contacts/mutation.md:3-13`, `apps/mobile/src/application/connection/companion-session.ts:207,211-219,247`
- Problem: The test plan lists `companion-session.ts` as a mutation target (80 %). This diff adds `fetchContacts` and the fetch aborts in `disconnect`/`dispose`, but `mutation.md` names the file neither as a target nor as skipped (the same gap R1 fixed for `mesh-client.ts`). `pnpm mutation --mutate apps/mobile/src/application/connection/companion-session.ts --force` gives 78.2 % (207 killed, 55 survived, 3 no coverage). Survivors in the new code: removing `signal?.addEventListener("abort", onAbort, …)` (`:213`) and `if (signal?.aborted) own.abort()` (`:212`), emptying the `finally` block (`:217-219`, so `fetches` keeps finished controllers and the caller's listener stays attached), and `client === null || …connected` → `client === null && …` (`:207`, a call while the client exists but the state is not `connected` reaches `getContacts`). `:212` and the `dispose()` fetch abort (`:247`) have no coverage. So the path `NodesController.dispose()` → caller signal → session → `MeshClient` abort is not tested anywhere: the controller test uses a scripted session, and the session test only checks the not-connected rejection. Mutation.md accepts the controller's `:76` abort survivor because "`CompanionSession` aborts its fetches too", but that session behaviour is itself unproven by mutation.
- Fix: Add `companion-session.int.test.ts` cases on a connected fake session with a contacts script that stalls after `contactsStart`: (a) aborting the caller's signal rejects `fetchContacts` with `AbortError` and a following `fetchContacts` succeeds (kills `:213`, `:217-219`); (b) an already-aborted signal rejects at once without a write (kills `:212`); (c) `dispose()` during a fetch rejects it with `AbortError` (covers `:247`); (d) `fetchContacts` during `connecting` rejects with `TransportUnavailableError` (kills `:207`). Then add `companion-session.ts` to `mutation.md` with a decision for every survivor in the changed lines (the older ones may be one `accept` row pointing at connect-companion).
- Effort: small
- Lesson candidate: no (covered by the lesson proposed for R1)
- Decision: fixed (60b7b40)

### R7: Controller `dispose()` test claims "unsubscribes" but does not check it; the survivor is missing from mutation.md
- Severity: minor
- Where: `apps/mobile/src/application/nodes/nodes-controller.int.test.ts:296`, `apps/mobile/src/application/nodes/nodes-controller.ts:143-144`, `context/changes/sync-contacts/mutation.md` round-1 table
- Problem: Removing `this.unsubscribe()` in `dispose()` (`:143`) survives, and so does `this.abort?.abort()` → `this.abort.abort()` (`:144`, `dispose()` with no sync running would throw). Neither line is in the round-1 triage table, which lists `:158` (now killed) instead. Without the unsubscribe, a disposed controller still starts a sync on the next connection.
- Fix: In the dispose test, after `dispose()` drive the session store to `connected` with `contacts` supported and assert `calls()` stays 1; add a `dispose()` call without a running sync. Update the mutation.md row.
- Effort: small
- Lesson candidate: no
- Decision: fixed (60b7b40)
