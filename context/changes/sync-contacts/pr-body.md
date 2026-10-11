# feat(sync-contacts): load companion contacts into local storage and list known nodes on the Dashboard

Roadmap S-03. After the handshake the app now syncs the companion's contacts into local SQLite (also on a "Sync contacts" button). The Dashboard lists known nodes with name, role and last-heard time. The user can label a node, set its role and pin chat contacts to the Dashboard. Labels and roles win over the protocol values, the reported values stay visible, and both survive a restart. Covers PRD FR-04 AC1–AC4 (AC4 by `FlatList` and an e2e run over 31 rows; the real 350-contact check is a human check below).
Closes #4

> **Status:** Ready for review

## ⚠ Needs your decision
No `[STUCK]` or `[REVIEW]` deviations. No review findings are left open (7 raised, 7 fixed). Plan review verdict: READY WITH NOTES (its two major findings, the idle bound and the SQLite transaction connection, are applied; see [plan.md#review-response](context/changes/sync-contacts/plan.md#review-response)).

- **D-8 (costly):** Sync merge rules. Chosen: in one transaction upsert by public key, never touch `user_label`, `user_role` or `dashboard_pinned`; only a **complete** sync (`endOfContacts` and received count = `contactsStart` count) sets `in_contacts = 0` on absent nodes. A count mismatch stores what arrived and marks nothing as missing; a timeout, drop or malformed frame stores nothing. Rows are never deleted. Alternatives: B: store contacts even after a timeout (keeps more data, but a half-sync mixed with old rows is hard to explain). C: delete missing nodes (breaks the roadmap rule to keep history). Switching costs: `packages/storage/src/sync/contacts.ts`, `nodes-controller.ts` error mapping, and the TR-15 tests.
- **D-9 (costly):** `in_contacts` is relative to the last complete sync, whichever companion did it; it is not stored per companion. Alternative: a `companion_contacts(companion_key, node_id)` table, exact with several companions (the PRD rules out several at once). Switching costs: a new migration and a rewrite of the merge and of whatever S-04 reads for "diagnostics disabled".
- **D-1 (costly):** `devices` table keeps reported values and user values in separate columns (`reported_*`, `user_label`, `user_role`). Alternative B: one `role` column plus `role_source` (loses the reported role once the user sets one). C: add `last_tested_at` and battery profile now. Switching costs: `0001_init.sql`, regenerated `generated.ts`, node repository and its Zod row schema, and a data migration once users have data.
- **D-7 (cheap, but user-visible and `UNVERIFIED`):** "Last heard" is the contact's `lastMod` (companion clock), labelled "Last heard (companion clock)". The remote `lastAdvert` is unusable in the fixture (1970, 2024 and 2028 values). Confirm on a real phone whether `lastMod` is a fair "last heard" (see human checks).

Reply in a review comment, e.g. `D-8: take B`, `drop the lessons commit`, then run `.claude/workflow/address-pr <PR number>`.

## Human checks
- [ ] Real phone, CI APK (`android-apk` artifact) + Heltec companion: install the CI APK, Connect companion, back to Dashboard, wait for "Contacts synced: <n>" (about 25 s for 350). Check that repeaters and room servers are listed, chat contacts are only under All contacts, and scrolling 350 rows is smooth. Record sync duration, count and the largest gap between frames (the idle bound is 15 s, D-11). Evidence: none yet; emulator run with fake transport: [phase-6-contacts-sync.png](context/changes/sync-contacts/evidence/phase-6-contacts-sync.png)
- [ ] Real phone: node row → Label → Save label → force-stop the app → reopen: the label is still there. Evidence: none yet; emulator run: [phase-6-label-restart.png](context/changes/sync-contacts/evidence/phase-6-label-restart.png)
- [ ] Wording: the sync failure texts and "Last heard (companion clock)" read clearly to an operator. Run: read `apps/mobile/src/i18n/en.json` keys `sync.*`, `nodes.*`. Evidence: none

## Other decisions made by the agent (cheap to change)
Full text in [plan.md#decisions](context/changes/sync-contacts/plan.md#decisions).

| ID | Question | Chosen | Alternatives |
|----|----------|--------|--------------|
| D-2 | Migration runner | `PRAGMA user_version`, one transaction per migration, `SchemaTooNewError` on a higher version | `schema_migrations` table; `CREATE TABLE IF NOT EXISTS` on each start |
| D-3 | How `.sql` reaches Metro and Vitest | `0001_init.sql` is the source; generated `generated.ts` plus a staleness test | custom Metro/Vite `.sql` transformers; TS string migrations |
| D-4 | `SqlDriver` port | In `packages/storage`: `exec`, `run`, `all`, `transaction`; `ExpoSqlDriver` and test-only `NodeSqlDriver` | port in `domain`; sync API |
| D-5 | Contact type → role | 1 chat, 2 repeater, 3 room server, anything else Unknown; raw type kept | fifth role `sensor`; hide type 0/4 |
| D-6 | When does a sync run | Once after each successful handshake (if `contacts` is supported and the app is active) plus a manual button; no timer, no retry | manual only; on every Dashboard focus |
| D-10 | Who is on the Dashboard | Derived: role is not chat, or pinned | stored `on_dashboard` column |
| D-11 | `getContacts` bounds | `contactsStart` within 5 s, 15 s idle between contact frames, 120 s total (idle raised from 5 s after plan review: the real fixture has a 4.9 s gap) | single 60 s timeout; cap from count |
| D-12 | Fake contacts for e2e | `CONTACTS_FRAMES`: 30 recorded contact frames plus one derived type-4 "Sensor test", 31 in ~2.1 s | bundle the 290 KB fixture; hand-written frames |
| D-13 | Data in the fake build | Real `expo-sqlite` in both modes, only BLE is faked | in-memory repository |
| D-14 | Where "All contacts" lives | Two-button filter on the Dashboard | sixth route; section header |
| D-15 | Label/role editing | On the node screen, label max 64 code points | inline in the row; modal |
| D-16 | How the application reaches `getContacts` | `CompanionSession.fetchContacts({ signal })` | expose `MeshClient`; sync inside the session |
| D-17 | App tests and storage | In-memory repository double; merge rules tested only in storage | `node:sqlite` in app tests (needs lint exception) |
| D-18 | Zod in storage | `zod` 4.6.5 parses rows into domain `Node` | hand-written row checks |
| D-19 | `ExpoSqlDriver` serialisation | One connection with a promise-chain mutex and hand-written `BEGIN IMMEDIATE`/`COMMIT`/`ROLLBACK` (replaces `withExclusiveTransactionAsync`, plan review #2) | exclusive transaction (second connection, `database is locked` on edits) |

## Quality
- Gates (review round 2): typecheck ok, lint ok, unit tests ok (45 files, 631 tests), e2e ok (9/9 flows). Full detail: [review.md](context/changes/sync-contacts/review.md).
- Review: APPROVE WITH FOLLOW-UPS, round 2. Round 1: 5 findings (R1–R5), all fixed. Round 2: 2 findings (R6, R7), both fixed. Deferred 0, rejected 0. Open findings: 0.
- Mutation: 93.2 % → 97.3 % over the six initial targets (all after-numbers are `--force` runs). Review rounds added `mesh-client.ts` (87.95 % → 90.36 %), `nodes-controller.ts` (75.15 % → 90.9 %) and `companion-session.ts` (78.2 % → 82.7 %). Remaining survivors are triaged in [mutation.md](context/changes/sync-contacts/mutation.md); no `bug` mutants left. `companion-session.ts` is below the 80 % test-plan target only on older, unchanged connect-companion code (accepted rows).
- Proposed lessons (drop commit `7c9a61a docs(sync-contacts): propose lessons` to reject them):
  - Run mutation on every test-plan target file the diff touches; never skip a target because its change looks small.
  - Re-run mutation with `--force` after the last test change; an incremental run keeps old results and can show killed mutants as survivors.
  - Do not let an error mapper's default branch claim a specific cause; unknown errors get a neutral reason.

## Follow-ups
- [FOLLOW-UP] Give `MeshClient` a typed `BusyError` (now a plain `Error("busy")`) and show "Contact sync in progress" for it before S-04 adds more requests (R4).
- [FOLLOW-UP] Cancellation of a contact sync has two owners (`NodesController` and `CompanionSession`); keep one when S-04 adds requests (R2).
- [FOLLOW-UP] Incremental sync with `since` = last `mostRecentLastMod`, and handling of the `0x90` contacts-full push.
- [FOLLOW-UP] "Remove from dashboard" for pinned chat contacts (and a rule for hiding repeaters the user does not care about).
- Note for S-04: a diagnostic started during a ~25 s contact sync is refused as busy and must say so ([plan.md#risks-and-unknowns](context/changes/sync-contacts/plan.md#risks-and-unknowns)).
- Test-plan gap noted in mutation: the *Run a mutation check* recipe does not say that runs after strengthening need `--force`.

## Commits
```
22e4ac7 docs(sync-contacts): triage review round 2
60b7b40 fix(sync-contacts): test fetchContacts signal forwarding and controller dispose (R6, R7)
598afee docs(sync-contacts): review
284913f docs(sync-contacts): triage review round 1
7c9a61a docs(sync-contacts): propose lessons
ac610ad fix(sync-contacts): show reported name, neutral sync error, controller tests, dashboard empty text (R2, R3, R4, R5)
2b15f2b fix(sync-contacts): test that a finished contact sync leaves no stale timer (R1)
fd184e2 docs(sync-contacts): review
8c0b86a docs(sync-contacts): mutation
e3b19a6 test(sync-contacts): strengthen assertions from mutation check
26e28f1 feat(sync-contacts): dashboard node list, node editing, e2e and docs
2bd7183 feat(sync-contacts): nodes controller, SQLite driver and composition
08f8477 feat(sync-contacts): MeshClient.getContacts and the contacts script
569278f feat(sync-contacts): node repository and contact sync merge
b556cce feat(sync-contacts): storage driver port, migration runner and devices table
53bce45 feat(sync-contacts): domain node model, repository port and sync state
b5a7982 docs(sync-contacts): plan-review
4fa4219 docs(sync-contacts): plan
```

<details><summary>Run</summary>

Branch `change/sync-contacts`, base `main`, started 2026-10-11 23:01. Failed step: none. Draft reason: none. Phases ticked 6/6. Plan review: READY WITH NOTES.

The run summary lists the steps from mutation onward (the plan, plan-review and implement steps ran earlier and are not in it):

| Step | Attempt | Model | Cost |
|------|---------|-------|------|
| mutation | 1 | sonnet | $0.45 |
| review (round 1: APPROVE WITH FOLLOW-UPS, 5 open) | 1 | opus | $1.58 |
| fix-review | 1 | sonnet | $0.64 |
| review (round 2: APPROVE WITH FOLLOW-UPS, 2 open) | 1 | opus | $0.86 |
| fix-review | 1 | sonnet | $0.45 |
| pr-body | 1 | sonnet | not yet recorded |

Listed steps total $3.98.
</details>
