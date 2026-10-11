# Mutation check: sync-contacts

Targets (changed logic files, one line of reason each):
- `packages/storage/src/sync/contacts.ts`: merge of reported contacts, removed-contact marking (TR-15, test-plan target)
- `packages/domain/src/nodes/node.ts`: role, label validation, last-heard mapping, sort order
- `packages/domain/src/nodes/sync.ts`: sync failure type guard
- `packages/storage/src/nodes/node-repository.ts`: row → domain mapping, query results
- `packages/meshcore-adapter/src/transport/contacts-script.ts`: recorded frames the fake transport replays
- `apps/mobile/src/application/nodes/presenter.ts`: sync button and list rules shown to the user
- `packages/meshcore-adapter/src/client/mesh-client.ts`: added in review round 1 (R1): pending handler, `collectContacts` timers, `finishPending`
- `apps/mobile/src/application/nodes/nodes-controller.ts`: added in review round 1 (R2): partial sync, error mapping, single-flight guard

Skipped: migrations, SQL driver wiring, composition, screens, e2e flows (wiring/presentation).

Tests: Vitest through Stryker (`pnpm mutation --mutate <file> --force`).
Score: 93.2% -> 97.3% over the six targets (before: 259 killed / 18 survived / 1 no coverage; after: 327 killed / 9 survived / 0 no coverage / 2 timeout).
The "before" run used Stryker's incremental cache, which went stale for `contacts-script.ts` (reported 3 survivors after tests that kill them; `--force` showed none). Every "after" number is a `--force` run.

| File | Before | After |
|------|--------|-------|
| `storage/src/sync/contacts.ts` | 20 / 1 / 0 | 20 / 1 / 0 |
| `domain/src/nodes/node.ts` | 62 / 8 / 1 | 66 / 5 / 0 |
| `domain/src/nodes/sync.ts` | 6 / 1 / 0 | 6 / 1 / 0 |
| `storage/src/nodes/node-repository.ts` | 34 / 5 / 0 | 37 / 2 / 0 |
| `meshcore-adapter/src/transport/contacts-script.ts` | 42 / 1 / 0 | 101 killed + 2 timeout / 0 / 0 |
| `mobile/src/application/nodes/presenter.ts` | 95 / 2 / 0 | 97 / 0 / 0 |

(killed / survived / no coverage)

## Mutants
| File:line | Mutator | Change | Decision | Note / test added |
|-----------|---------|--------|----------|-------------------|
| `node-repository.ts:40` | ConditionalExpression | `inContacts: true` | strengthen | killed by "reads a contact missing from a complete sync as not in contacts" (get and listAll) |
| `node-repository.ts:62` | ArrowFunction | `listAll` maps to `undefined` | strengthen | killed by the same test (listAll content, not just length) |
| `node-repository.ts:26` | MethodExpression | schema `.max(1)` → `.min(1)` | strengthen | killed by the same test (a 0 row must parse) |
| `node-repository.ts:10-11` | StringLiteral | error message and name emptied | accept | wording of `NodeNotFoundError`; the class and key are asserted |
| `presenter.ts:93` | LogicalOperator / Conditional | `\|\|` → `&&`, condition `false` | strengthen | killed by "needs both a connection and known capabilities" |
| `contacts-script.ts:11,163,167` | StringLiteral | `dir: "rx"` emptied | strengthen | killed by "writes once, then only receives" |
| `node.ts:87` (inner) | Conditional / Equality | `a.publicKey > b.publicKey` → `true`, `false`, `>=` | equivalent | only changes the comparator result 1 vs 0 for a pair the engine already keeps in order; the outer `<` branch is killed in both input orders by "breaks name ties by key in either input order". Depends on the engine's comparator call order (V8 verified) |
| `node.ts:80` | MethodExpression | `toLowerCase` → `toUpperCase` | equivalent | `localeCompare` on names gives the same order for case-folded letters either way; only differs for punctuation between `Z` and `a`, not a requirement |
| `node.ts:86` | ConditionalExpression | `byName !== 0` → `true` | strengthen | killed by the key tie-break tests |
| `node.ts:87` | UnaryOperator (no coverage) | `-1` → `+1` | strengthen | killed by the key tie-break tests |
| `sync.ts:20` | ConditionalExpression | `typeof value === "string"` → `true` | equivalent | `includes` on a non-string is false anyway |
| `contacts.ts:21` | OptionalChaining | `known[0]?.n` → `known[0].n` | equivalent | `SELECT count(*)` always returns exactly one row |

## Review round 1 (R1, R2), `--force` runs
`mesh-client.ts` 87.95 % -> 90.36 % (150 killed / 14 survived / 2 no coverage); `nodes-controller.ts` 75.15 % -> 89.70 % (148 / 17 / 0).
Killed by the new tests: `clearTimeout(idleTimer)` and `clearTimeout(totalTimer)` in the cleanup (sync finished 10 s and 100 s before the next one), `finishPending()` after `endOfContacts`, `complete` forced to `true`, the `UNSUPPORTED` and `MALFORMED_RESPONSE` mappings, the unknown-error branch, the `syncing` guard, `dispose()`, and the `load`/`write` storage-error paths.

| File:line | Mutator | Change | Decision | Note |
|-----------|---------|--------|----------|------|
| `mesh-client.ts:240` | BlockStatement | `expected === null` branch emptied | equivalent | the branch only returns at the end of an `else if` chain; an empty block behaves the same. The "before contactsStart" test kills the `false` condition |
| `mesh-client.ts:141` | CallExpression | `reply.catch(() => undefined)` removed | accept | only suppresses an unhandled-rejection warning during `write` |
| `mesh-client.ts:164,179` | CallExpression | same, in `close` / `step` | accept | handshake code and unsubscription of listeners on a closed client; not part of this change |
| `mesh-client.ts:281` | OptionalChaining | `pending?.cleanup` | equivalent | `finishPending` runs only with a pending request |
| `mesh-client.ts:88-90,113-114,299,307` | various | handshake code | accept | not in this diff; covered by the connect-companion change |
| `nodes-controller.ts:72,76` | Conditional | initial `wasConnected` and the abort on disconnect | accept | `CompanionSession` aborts its fetches on disconnect too (two owners, kept as a second line of defence); a FOLLOW-UP in plan.md |
| `nodes-controller.ts:124` | Conditional / Equality | `this.abort !== abort` in `finally` | accept | only clears a handle; a stale handle at most aborts an already finished controller |
| `nodes-controller.ts:43-45,150,158,177,187,192` | various | initial state values, optional chain, `signal` object, refresh state | accept | covered indirectly (initial state is replaced by the first load); no behaviour at stake |

## Dead-weight tests
None found. The two new sort tests could be one parametrised table if more orderings are added.

## Gaps for the test plan
- Stryker's `incremental: true` can report stale survivors after test-only changes; mutation runs after strengthening need `--force`. The test-plan recipe (*Run a mutation check*) does not say so.
- `contacts.ts` merge counts (`added`/`updated`) are only reachable through an existing-row count that cannot be 0 rows; no gap in behaviour.

## Proposed lessons
Run mutation on every test-plan target file the diff touches; never skip a target because its change looks small.
Re-run mutation with `--force` after the last test change; an incremental run keeps old results and can show killed mutants as survivors.
