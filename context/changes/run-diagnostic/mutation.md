# Mutation check: run-diagnostic

Targets: the test-plan mutation targets the diff touches, run one file at a time with `--force`
(see Gaps: the incremental cache hid results). Tests: `vitest.config.mts` (all projects).

| Target | Why | Before | After (killed / survived / no coverage / timeout) |
|--------|-----|--------|----------------------------------------------------|
| `packages/domain/src/diagnostics/classify.ts` | best-evidence rule | 97.7% | 100% (88 / 0 / 0 / 0) |
| `packages/domain/src/diagnostics/check.ts` | planning and stop rule | 100% | 100% (31 / 0 / 0 / 0) |
| `packages/domain/src/diagnostics/rules.ts` | result × reason → texts | 62.0% | 100% (129 / 0 / 0 / 0) |
| `packages/domain/src/policy/timeout.ts` | attempt timeout | 89.1% | 89.1% (41 / 5 / 0 / 0) |
| `packages/domain/src/policy/retry.ts` | retry rule | 96.3% | 96.3% (26 / 1 / 0 / 0) |
| `packages/domain/src/policy/cooldown.ts` | per-node cooldown | 100% | 100% (17 / 0 / 0 / 0) |
| `apps/mobile/src/application/diagnostics/run-controller.ts` | start, cancel, refusals, stored result | 73.0% | 96.6% (190 / 7 / 0 / 0) |
| `packages/meshcore-adapter/src/client/mesh-client.ts` | single-flight, abort, error mapping | 87.8% | 94.3% (362 / 17 / 5 / 0) |
| `apps/mobile/src/application/connection/companion-session.ts` | `runChecks`, shared ledger | 81.5% | 82.5% (241 / 50 / 1 / 0) |

Score: see the table (per file) · `rules.ts` before is the first run; its survivors were all
killed by the new table test.

## Mutants

Survivors in code this change added or changed. Mutants in code from earlier changes are listed at
the end.

| File:line | Mutator | Change | Decision | Note / test added |
|-----------|---------|--------|----------|-------------------|
| classify.ts:70 | MethodExpression | `some` → `every` for LOGIN_REJECTED | strengthen | classify case "a rejected login wins over a later reply" |
| classify.ts:82 | MethodExpression | `some` → `every` for NO_RESPONSE | strengthen | classify case "no reply next to an untested check…" |
| rules.ts:32-102 | StringLiteral / ArrayDeclaration | empty cause, next-step and limitation names; empty arrays | strengthen | `rules.test.ts` table of the FR-09 parts per pair; checks every pair is in the table |
| timeout.ts:22 | StringLiteral | error message | accept | message text only |
| timeout.ts:27 | Conditional / Logical | `estimateMs !== null/undefined` forced or `\|\|` | equivalent | `null > 0` and `undefined > 0` are false, so the `> 0` test decides alone |
| retry.ts:15 | StringLiteral | error message | accept | message text only |
| run-controller.ts:87-88 | Conditional / Arrow | `get` on a missing store, `.catch` | strengthen | "get returns null when the read of one run fails", "storage that cannot open" |
| run-controller.ts:50,55 | Boolean / String | initial `loaded`, `storage` | strengthen | "starts with nothing loaded…" |
| run-controller.ts:96-107,118-119 | Conditional / Boolean | `running` flag not set or not released; busy check in `confirmNotice` | strengthen | "a second start while the first waits…", "a start while the airtime notice check is pending…", "a run started from the notice also blocks a second start". The client's own single-flight used to hide these |
| run-controller.ts:102 (no coverage) | Boolean | unreadable notice flag treated as seen | strengthen | "treats an unreadable notice flag as not seen" |
| run-controller.ts:110 | Arrow | `seen().catch(() => false)` → `() => undefined` | equivalent | both are falsy, so `!(await …)` takes the same branch |
| run-controller.ts:78 | Conditional | `if (state === "background") this.cancel()` → `if (true)` | strengthen | "an appState change to active leaves the run in flight alone" (R6) |
| run-controller.ts:102 | Arrow | `markSeen().catch(() => undefined)` | strengthen | "runs even if the notice cannot be remembered" |
| run-controller.ts:115 | Conditional / Logical | `confirmNotice` guards | strengthen | "confirmNotice without a notice…", "…in the background keeps the notice…" |
| run-controller.ts:130 | OptionalChaining | `cancel()` with no run | strengthen | "cancel with no run in flight does nothing" |
| run-controller.ts:141 | Logical / Conditional | connected `&&` capabilities known | strengthen | "%s is NOT_CONNECTED" (two states) |
| run-controller.ts:168-169 (no coverage) | Block / String | `TransportUnavailableError` mapped to NOT_CONNECTED | strengthen | "a link that is gone when the run starts is NOT_CONNECTED" |
| run-controller.ts:174-178 | Conditional / Method | skipped checks appended after an early stop; cancel from outcomes | strengthen | "keeps the skipped check only for a run that went through", "does not keep the skipped check when fewer checks ran", "a cancelled check in the outcomes…" |
| run-controller.ts:159 | String | `"CAPABILITY_MISSING"` preflight → `""` | equivalent | an empty preflight falls through to the normal classification, which gives the same UNSUPPORTED/CAPABILITY_MISSING for the same single check. The test now also asserts the stored check |
| run-controller.ts:186 | String | `"UNEXPECTED_ERROR"` preflight → `""` | equivalent | the same fall-through gives NOT_TESTED/UNEXPECTED_ERROR for no checks |
| run-controller.ts:220 | Boolean | `cancelled: false` → `true` in `finishPreflight` | equivalent | `classifyRun` tests the preflight before `cancelled` |
| run-controller.ts:212 | Object / String | fallback companion when not connected | strengthen | "without a connection…" asserts the empty companion |
| run-controller.ts:231 | Conditional | stored run keeps `id` only when saved | strengthen | "keeps the result when it cannot be saved" asserts `id` is undefined |
| run-controller.ts:261, 296 | Conditional | `repository === null` guard | equivalent | with a null repository the next call throws a `TypeError` that the surrounding `catch` turns into the same `storage: "error"` state |
| run-controller.ts:299 | String | `storage: "ok"` after a good read | equivalent | the state is already `"ok"` unless the store failed, and then `load` returns before reaching this line |
| run-controller.ts:268-281 (no coverage) | Block | open and read failures | strengthen | "reports a storage that cannot open…", "reports a failing read of the newest runs" |
| mesh-client.ts:54 | ArrayDeclaration | login reply codes `[]` | strengthen | "fails a login check on a truncated 85/86 push" |
| mesh-client.ts:270 | Arithmetic | `now() + startedAt` | strengthen | "measures the duration of a check…" |
| mesh-client.ts:289, 296 | String | result of a failed write, link-lost result | strengthen | the write-failure and late-drop tests now assert `result` too |
| mesh-client.ts:233-234 (no coverage) | Conditional / String | link lost between two checks | strengthen | "records a link lost between two checks as an unsent check" |
| mesh-client.ts:307 | Conditional | second `sent` frame re-arms the timer | strengthen | "does not re-arm the reply timer on a second sent frame" |
| mesh-client.ts:317-339 | Conditional | check kind and key prefix of a reply | strengthen | 12-row table "a %s check does not take %s for its reply"; the old tests only proved the later correct reply was accepted, which a wrong match also satisfied |
| mesh-client.ts:295, 297 | Conditional / String | non-abort, non-link error → UNEXPECTED_ERROR | equivalent | the pending request is rejected only with `AbortError` or `TransportUnavailableError`, so the branch is unreachable |
| mesh-client.ts:308, 252 | String | `phase` value `"reply"` / initial `"sent"` | equivalent | `phase` is only compared with `"sent"`, and `attempt()` sets it before every use |
| mesh-client.ts:350 | Conditional | `raw[0] === undefined` forced false | equivalent | `includes(undefined)` is false, so the second operand returns anyway |
| companion-session.ts:234 | Logical / Conditional | `client === null \|\| not connected` | strengthen | "is refused when not connected" and "is refused while the handshake is still running" (client set, state connecting). Checked by hand with `&&`: the second test fails with a `BusyError`. Stryker still lists the mutants as survived (see Gaps) |
| companion-session.ts:245 | CallExpression | `fetches.delete(own)` | accept | only drops an already finished controller from a set; no observable outcome |
| companion-session.ts:300 | ObjectLiteral | `{ ledger: this.ledger }` → `{}` | strengthen | "keeps the cooldown across a reconnect". The mutated code fails this test when run by hand (the second run resolves instead of being refused), but Stryker still lists it as survived; likely a coverage mapping artefact. Not chased |

Mutants in earlier changes' code (not triaged here): `mesh-client.ts` L147-149 (no-op `onFrame` and
`onDisconnect` stubs for the send-only connection), L160, L172-173 (unreachable guard in
`handshake`), L200, L372, L387, L448, L509; `companion-session.ts` L71-73, L97, L133-178 (scan
bookkeeping), L196, L212, L218, L223, L262, L265, L293-L341 (connect and drop paths). They belong
to `connect-companion` and `sync-contacts`.

## Dead-weight tests
None found. The new 12-row reply table is one parametrised test; `rules.test.ts` keeps the older
per-pair test (shape) next to the new table test (content) because they check different things.

## Gaps for the test plan
- `incremental: true` in `stryker.config.mjs` kept the old verdict for `rules.ts` after its tests
  changed (the test names did not change), and showed 62% for a file that is at 100%. Runs for this
  check used `--force`. `/test-plan` should decide whether CI keeps incremental mode for the
  `mutation-report` job.
- `companion-session.ts` is a mutation target at 82.5%, with 50 survivors from earlier changes in
  the scan and connect bookkeeping. No fast test pins them.
- Stryker lists `companion-session.ts:234` and `:300` as survived although the new tests kill the
  mutated code when it is applied by hand. Likely the same artefact; not chased.

## Proposed lessons
- A test that sends a wrong frame and then the right one cannot show the wrong one was ignored when
  the result is the same either way. Assert something the wrong frame would change (attempt count,
  result after the timeout, timer state).
- When a lower layer enforces a rule too (the client's single-flight and cooldown), test the upper
  layer's own guard against a stub that does not enforce it, or the guard looks covered while it is
  not.
