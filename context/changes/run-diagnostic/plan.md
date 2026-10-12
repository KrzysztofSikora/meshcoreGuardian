# Plan: run-diagnostic (S-04)

## Goal and end state
A user starts a check on a node, can cancel it, and gets an honest, explained result that is
stored. Specifically:

- On the node screen, **Run diagnostic** starts a run: guest login (empty password until S-05),
  then status, then telemetry when the capability exists. While it runs the screen shows the
  current step, "Attempt n of m" and **Cancel** (FR-05 AC1). Cancel aborts the request in flight.
  No further attempt is written, and the run is stored as `NOT_TESTED` / `CANCELLED` (FR-05 AC3).
- Every finished run is stored in `diagnostic_runs`, and each of its checks in
  `diagnostic_checks`. A run stores start, end, duration, companion identity, node, attempts,
  result, reason and limitations. A check stores its outcome, attempts, timeout and its source,
  duration and decoded evidence (FR-05 AC4).
- The result follows the best-evidence rule from the roadmap and the FR-06 taxonomy (AC1–AC5).
  A node with no runs reads "Not tested" (AC6). No response is "No response — cause unknown".
  The words "offline", "down" and "dead" never appear in the catalog (a test checks this).
- The run screen `/run/[id]` lists the checks performed, each outcome, the evidence, the
  limitations, the possible causes and the next steps. All of it comes from a typed rule table
  with one entry per result × reason (FR-09 AC1–AC3).
- Radio hygiene (FR-10): a second run while one is in flight is refused with "A check is already
  running" (AC1). A node whose last run finished less than 60 s ago gets a disabled button with a
  visible countdown (AC2). The attempt timeout is the companion estimate × margin, capped at
  30 s, or 15 s without an estimate, or a 5–60 s override (AC3). At most the configured number of
  attempts is sent: default 2, range 1–3 (AC4). The first run shows a shared-airtime notice that
  can be dismissed and is remembered (AC5). Nothing is sent without a tap (AC6).
- Dashboard rows and the node screen show the last run as relative, historical status text with
  an icon glyph and a text label ("Responded 2 min ago", "No reply in last test", "Not tested"),
  never a persistent "Online" (FR-11 AC1–AC2).

## Scope
- In:
  - Domain: reason codes, check model and sequence, `classifyRun`, the rule table, last-run
    status, and the timeout, retry and cooldown policies.
  - Storage: migration `0002`, `SqliteDiagnosticRunRepository`, and the v1 → v2 migration test.
  - Adapter: `MeshClient.runChecks` (login/status/telemetry with timeout, retry, abort,
    single-flight, cooldown guard and correlation), `BusyError` and `CooldownError`, and fake
    remote scripts derived from `remote.json`.
  - App: `CompanionSession.runChecks`, `RunController` (use case + Zustand store), the airtime
    notice flag, composition, catalog texts, node-screen run panel, run screen and Dashboard
    status.
  - e2e flows for responded, no response, transport drop, unsupported, malformed and cancel.
  - Updates to the `test-plan.md` risk register and mutation targets.
- Out:
  - Guest password entry and secure storage (S-05). The login sends `""`, the same value as the
    S-01 capture.
  - Telemetry samples table, units/provenance presentation, recent-runs list and voltage chart
    on node details (S-06). S-04 keeps decoded telemetry in the check's `evidence_json`.
  - Settings UI for the timeout override and attempts (S-09). S-04 uses defaults from one
    constant.
  - Trace (P1), multi-attempt success ratio (P1), and deleting history (S-09).

## Findings
- **Request frames, verified (S-01):** login `0x1a` + 32-byte public key + password bytes;
  status `0x1b` + key; telemetry `0x27 00 00 00` + key. meshcore.js 1.15.0 encodes them with
  `sendCommandSendLogin(publicKey, password)`, `sendCommandSendStatusReq(publicKey)` and
  `sendCommandSendTelemetryReq(publicKey)`
  (`node_modules/@liamcottle/meshcore.js/src/connection/connection.js:230-253`). They are already
  typed in `packages/meshcore-adapter/src/types/meshcore-js.d.ts:25-27`. We use only these
  encoders. The library's `login`/`getStatus`/`getTelemetry` use `estTimeout + 1000 ms`
  uncapped and reject with bare strings (`connection.js:1660-1826`), as the tech stack says.
- **Reply sequence, verified** (`fixtures/v1.17.1-d929643/remote.json` frames 362–378,
  `docs/compatibility.md` "Remote requests"): each request gets `0x06 sent`
  `[flood, tag u32, est_timeout u32]` within ~100–200 ms, then a push: `0x85` login success,
  `0x87` status, or `0x8b` telemetry. Pushes carry the 6-byte key prefix (`7c73a8cd01d9`). The
  status and telemetry pushes have no tag, and the login tag differs from the SENT tag, so
  correlation is by key prefix with one request in flight. Observed `estTimeout` was 3678 /
  2694 / 2694 ms and latency 2875 / 1324 / 1088 ms, all direct path (`flood` = 0). No flood
  sample exists. `0x86` login fail was never seen; it is decoded from firmware source
  (`decode-frame.ts:212-215`).
- **Decoder:** `decodeFrame` already returns `sent`, `err`, `loginSuccess`, `loginFail`,
  `statusResponse` (`RemoteStats` + `extraHex`) and `telemetryResponse` (LPP values + `lppHex`),
  and throws `MalformedFrameError` on short frames
  (`packages/meshcore-adapter/src/decode/decode-frame.ts:18-63,146-228`). S-04 adds no decoder
  code.
- **MeshClient:** one `pending` request, a `busy` flag shared by `handshake` and `getContacts`
  (`throw new Error("busy")`, `mesh-client.ts:105,140`), abort through `AbortSignalLike`,
  `failPending` on transport disconnect, and malformed frames failing whatever is pending
  (`mesh-client.ts:294-306`). Timers use `setTimeout`, and tests use `vi.useFakeTimers()`
  (`test/mesh-client.int.test.ts:41`).
- **Session:** `CompanionSession` owns the only `MeshClient`. It exposes the narrow
  `fetchContacts({ signal })` and aborts those fetches on user disconnect
  (`apps/mobile/src/application/connection/companion-session.ts:206-235`). The connected state
  carries `companion: CompanionInfo` (public key, name, firmware) and `capabilities`.
  `NodesController` shows the controller pattern: a vanilla Zustand store, a lazy repository
  promise, and an error mapper whose default is neutral (`nodes-controller.ts:51-58`, lesson).
- **Storage:** `0001_init.sql` creates `devices` only. Migrations are generated from
  `migrations/NNNN_name.sql` by `scripts/gen-migrations.mjs` (numbered without gaps; a staleness
  test exists). `openGuardianDb` turns on `PRAGMA foreign_keys`
  (`apps/mobile/src/platform/sqlite/open-guardian-db.ts`).
- **Capabilities:** login, status and contacts have minimum ver code 1 and telemetry 5
  (`packages/domain/src/companion/capabilities.ts:10-16`). In practice only telemetry can be
  missing (the `unsupported-capability` scenario uses ver code 4).
- **Fake build:** `FakeBlePlatform.connect` replays `HANDSHAKE_FRAMES` + `CONTACTS_FRAMES` ×2
  (`apps/mobile/src/platform/fake/fake-ble-platform.ts:104-121`). `FakeTransport` matches a write
  to the first unconsumed recorded tx frame with the same code. Delays are relative to that
  write, and it supports `silence(code)`, `corrupt(rxSeq)`, `dropAfterWrites(n)` and `drop()`.
  Room K is **not** among the 31 fake contacts; its contact frame is `remote.json` seq 219
  (type 3, "Room K").
- **Catalog:** `apps/mobile/src/i18n/catalog.test.ts:66` already forbids
  `/\b(offline|down|dead)\b/i` in every value of `en.json`. e2e has 9 flows; the test plan's
  budget is ~15.
- **Kv store:** `expo-sqlite/kv-store` is already used for the last companion
  (`apps/mobile/src/platform/last-companion-store.ts`).

## Decisions
| ID | Question | Chosen | Alternatives (and what they would buy) | Why | Reversal | Decided by |
|----|----------|--------|----------------------------------------|-----|----------|------------|
| D-1 | Reason codes, per result (stored values) | `RESPONDED`: `ALL_CHECKS_REPLIED`, `PARTIAL_REPLY`, `LOGIN_REJECTED`. `NO_RESPONSE`: `NO_REPLY`. `TRANSPORT_UNAVAILABLE`: `NOT_CONNECTED`, `LINK_LOST`, `COMPANION_NO_ACK`. `UNSUPPORTED`: `CAPABILITY_MISSING`, `COMMAND_REJECTED`, `MALFORMED_RESPONSE`. `NOT_TESTED`: `CANCELLED`, `UNEXPECTED_ERROR`. The same vocabulary is used for each check row. One typed constant `REASONS_BY_RESULT` in domain; SQL constrains only `result`, not `reason` | B: one flat reason list with no result binding. Fewer types, but the rule table could not be checked for completeness. C: a SQL `CHECK` on reason too. Stricter DB, but every new reason would need a SQLite table rebuild | PRD names `LOGIN_REJECTED`, `CANCELLED` and `MALFORMED_RESPONSE`; the rest split FR-06 cases the user acts on differently (reconnect vs. update firmware). Zod checks reasons on read, so new ones are additive | costly | agent / prd |
| D-2 | Check sequence and when a run stops | `planChecks(capabilities)` → `login` (if supported) → `status` → `telemetry` (if supported; otherwise a stored check `UNSUPPORTED`/`CAPABILITY_MISSING` with 0 attempts). The run **stops at the first check that did not reply**: no reply, rejected login, link lost, no ack, err frame, malformed reply or cancel. Later checks are not stored. If `status` itself is unsupported, the run is `UNSUPPORTED`/`CAPABILITY_MISSING` and nothing is written | B: try every check whatever happened. More evidence (status may work without a session), but after a silent login it spends up to 2×2 more timeouts of airtime on a path that just failed. C: stop only after login fails | Radio fairness (FR-10, US-08) and PRD FR-05 AC2 ("a rejected login ends the run"). Telemetry after a status timeout would add airtime for little | cheap | agent |
| D-3 | Cancel after the node already replied (e.g. login OK, cancel during status) | Always `NOT_TESTED`/`CANCELLED`, as FR-05 AC3 says. The check that replied is still stored with its evidence and shown on the run screen | B: best evidence wins (`RESPONDED` with a `CANCELLED` limitation). Matches the roadmap rule, but contradicts the literal AC3 | AC3 is unconditional, and the roadmap rule lists only FR-06 cases. One branch in `classifyRun` changes it | cheap | prd |
| D-4 | Timeout margin and bounds (D-06 left the margin open) | `attemptTimeout({ estimateMs, overrideMs })`: an override (5–60 s) wins → `override`. Otherwise an estimate > 0 → `clamp(estimate × 2, 5 000, 30 000)` → `estimate`. Otherwise 15 000 → `default`. The timer starts when `sent` arrives (the estimate is not known before). An out-of-range override throws `RangeError`: S-09 validates input | B: × 1.5. Shorter waits, but login latency was 78 % of its estimate on a one-hop direct path, so a busier path would come close to a false `NO_RESPONSE`. C: estimate + 1 s (library). Too tight on slow paths | False `NO_RESPONSE` is the main honesty risk (R-04, TR-01). The 5 s floor matches the Settings minimum and keeps a tiny estimate from timing out at once. Constants live in `policy/timeout.ts` | cheap | agent |
| D-5 | The companion never confirms the send (`sent` missing) | Wait `SENT_TIMEOUT_MS` = 5 000 for `sent` (or `err`) after each write. On silence the check ends as `TRANSPORT_UNAVAILABLE`/`COMPANION_NO_ACK` with no retry, and the run stops | B: one timer from the write, so a missing ack becomes `NO_RESPONSE`. Simpler, but it blames the remote path when the request may never have been sent. C: retry the write. More traffic on a link that is already misbehaving | `sent` came in ≤ 200 ms in every capture. Without it the problem is between the phone and the companion, and the advice is to reconnect | cheap | agent |
| D-6 | Which outcomes are retried | Only an attempt that got `sent` and then no correlated reply before the timeout (`NO_REPLY`). A rejected login, err, malformed reply, no ack, link loss and cancel are never retried | B: also retry malformed replies. Could save a run hit by one bad frame, but it repeats airtime for a decoding problem that will probably recur | FR-10 AC4 is about timeouts; any other outcome is evidence already | cheap | agent |
| D-7 | Cooldown: which runs count and who enforces it | A run that wrote at least one request (`attemptsUsed > 0`) starts a 60 s per-node cooldown from its `finishedAt`. The UI computes it from the stored latest run, so it survives restarts and shows the countdown. `MeshClient` also refuses with `CooldownError` using an in-memory `RemoteRequestLedger` that `CompanionSession` creates once and passes to every client, so a reconnect cannot bypass it | B: every stored run counts. Locks the user out for 60 s after a run that never reached the radio. C: only the UI enforces it. Breaks the roadmap rule that cooldown lives in `MeshClient` | The cooldown exists to protect airtime. Runs that sent nothing used none | cheap | agent / user (roadmap) |
| D-8 | Schema of runs and checks | `0002_diagnostics.sql`: `diagnostic_runs(id PK, device_id → devices ON DELETE CASCADE, companion_public_key, companion_name, companion_firmware, started_at, finished_at, duration_ms, attempts_used, attempts_per_check, result CHECK(5 codes), reason, limitations_json DEFAULT '[]')` and index `(device_id, finished_at)`. `diagnostic_checks(run_id → runs ON DELETE CASCADE, seq, kind CHECK(login/status/telemetry), result CHECK, reason, attempts, timeout_ms NULL, timeout_source NULL CHECK(estimate/default/override), started_at NULL, duration_ms NULL, evidence_json NULL, PK(run_id, seq))`. Timeouts live per check, because each check has its own estimate. The raw summary of a malformed reply goes into that check's `evidence_json`. Last tested is derived (`MAX(finished_at)`), not a `devices` column | B: one `diagnostic_runs` row with a JSON array of checks. One table, but the roadmap fixes a `diagnostic_checks` table. C: a run-level `raw_summary_json` and timeout columns as in the PRD sketch. Duplicates per-check data that differs between checks | The roadmap fixes the two tables and their key columns. Nullable columns and JSON for evidence keep S-06/S-08 additive | costly | agent / user (roadmap) |
| D-9 | Correlating replies | A reply counts only when its `keyPrefix` (12 hex) equals the first 12 hex of the target key and its kind fits the current check (`loginSuccess`/`loginFail` for login, `statusResponse` for status, `telemetryResponse` for telemetry). `sent`/`err` count only between the write and the first `sent`. A late reply from an earlier attempt of the same check is accepted (the node did reply). A frame with no pending check is ignored. A `MalformedFrameError` fails the check only when the frame's code byte is one the check is waiting for; other malformed pushes are ignored | B: fail on any malformed frame (today's handshake behaviour). An unrelated corrupt advert would then turn a run into `MALFORMED_RESPONSE` | Verified correlation is by key prefix with one request in flight (compatibility record). TR-08 | cheap | research |
| D-10 | `MeshClient` diagnostic API | `runChecks({ publicKey, checks, password, policy: { attempts, overrideMs }, signal, onProgress }) → Promise<CheckOutcome[]>`. It resolves with one outcome per executed check and throws only `BusyError` (anything in flight, including a contact sync), `CooldownError(remainingMs)` or `TransportUnavailableError` (client closed before start). It holds the busy flag for the whole run, so nothing interleaves. `onProgress({ check, attempt, of })` fires before each write. The existing `Error("busy")` becomes `BusyError` (a subclass of `Error`, so callers keep working) | B: one call per check, with the application sequencing them. Then single-flight would be needed across calls and another request could slip in between. C: return the classified run. Classification would then live in the adapter instead of the domain | The tech stack puts orchestration in `MeshClient` and rules in the domain. The stop rule (D-2) is a domain function the client calls | cheap | agent / tech-stack |
| D-11 | Unknown errors during a run | `NOT_TESTED`/`UNEXPECTED_ERROR` ("The check could not be completed"). Never a link-loss or no-response text | B: `TRANSPORT_UNAVAILABLE`. Claims a cause nobody observed | Lesson "unknown errors get a neutral reason" | cheap | lesson |
| D-12 | Where progress and result appear | The node screen hosts the run panel (Run, progress "Step: Status · Attempt 1 of 2", Cancel, the notice). After the run it shows a result card (status line + "View details"). `/run/[id]` shows the full explanation. No automatic navigation | B: navigate to `/run/active` on start. A screen for a transient state that has no DB id yet. C: everything on the node screen. Crowds S-06's details screen | Uses the five planned routes (`/run/[id]` exists as a placeholder) and keeps one obvious place to cancel | cheap | agent |
| D-13 | When is Run disabled, and what does it say? | `runButton()` presenter, in priority order: not connected → "Connect a companion to run a diagnostic"; another run in flight → "A check is already running"; node not in companion contacts → "This node is not in the companion's contacts"; `status` unsupported → the capability text with the firmware version; cooldown → "Available again in {n} s" (ticking). If a run is started anyway (race), the use case stores `TRANSPORT_UNAVAILABLE`/`NOT_CONNECTED` or `UNSUPPORTED`/`CAPABILITY_MISSING`, and refuses a busy client with "A check is already running" | B: keep Run enabled when disconnected and store a `TRANSPORT_UNAVAILABLE` run. Shows AC2 "before" more literally, but fills history with runs that never reached the radio | Same pattern as the Sync button (`syncButton`). A companion returns an error for a key it does not know, so a run against a missing contact is futile | cheap | agent |
| D-14 | Airtime notice (FR-10 AC5) | The first tap on Run, while the flag is unset, shows an inline notice ("Checks use shared LoRa airtime…") with **Run diagnostic** and **Not now**. Confirming stores `notice.airtime.seen` in `expo-sqlite/kv-store` behind an `AirtimeNoticeStore` port and starts the run. Once seen, it is not shown again | B: once per app session, not persisted. Reads "first diagnostic of a session" literally, but contradicts "remembered". C: a Settings row. S-09 | "Dismissible, remembered" says it outlives the session. S-09 may move the flag into its settings store; that is one port | cheap | agent |
| D-15 | Status line and relative time (FR-11) | `lastRunStatus(run \| null, now)` in domain → `{ kind: "not_tested" \| "responded" \| "no_reply" \| "transport_error" \| "unsupported" \| "cancelled" \| "incomplete", ageMs }`. Text: "Responded {age} ago", "No reply in last test", "Not tested", "Transport error in last test", "Unsupported in last test", "Last test cancelled", "Last test incomplete". Age buckets: < 1 min "just now", then minutes, hours and days through i18next plurals (no `Intl.RelativeTimeFormat`, whose Hermes support is not verified). Each status has a text glyph icon (✓ ? ⚠ ✕ –) marked `accessibilityElementsHidden`, so the label carries the meaning. The Dashboard re-renders its ages every 30 s while focused (display only, no radio) | B: absolute timestamps. Simpler, but AC1 asks for relative text. C: an icon library. A new dependency for five glyphs | PRD strings are used verbatim. The glyphs keep FR-11 AC2 (icon + text, not colour) without a dependency | cheap | prd / agent |
| D-16 | Login password until S-05 | `RunController` takes a `GuestPasswordSource` port (`(publicKey) => Promise<string>`); S-04 wires `async () => ""`. The password goes only to `runChecks` and is never stored or logged | B: hard-code `""` in `MeshClient`. S-05 would have to change the adapter | S-05 swaps one composition line | cheap | agent |
| D-17 | Fake remote replies for app tests and e2e | `packages/meshcore-adapter/src/transport/remote-script.ts`: `REMOTE_FRAMES` = `remote.json` tx/rx of login (362, 363, 365), status (368, 369, 371) and telemetry (375, 376, 378), byte for byte. `DIAG_CONTACTS_FRAMES` = `CONTACTS_FRAMES` plus Room K's contact (seq 219), with count 32. Variants are built by `remoteScript({ login, status, telemetry })` where each step is `"ok" \| "no-reply" \| "err" \| "malformed"`. `no-reply` keeps `sent` and drops the push; `err` replaces `sent` with `01 02`; `malformed` truncates the push to 2 bytes. A test checks the recorded frames against the fixture and each derived edit. Diagnostic scenarios replay `HANDSHAKE + DIAG_CONTACTS ×2 + remoteScript(...) ×3` | B: give the S-03 `CONTACTS_FRAMES` Room K. Changes the count in `contacts-sync.yaml` and S-03 tests for no gain. C: hand-written frames. Loses the real encoding | Same pattern as `HANDSHAKE_FRAMES` and `CONTACTS_FRAMES` (S-02 D-3, S-03 D-12) | cheap | agent |
| D-18 | Policy values before S-09 | `DEFAULT_DIAGNOSTIC_POLICY = { attempts: 2, overrideMs: null }` in `packages/domain/src/policy/retry.ts`; `RunController` reads it through a `policy: () => DiagnosticPolicy` port | B: read from the kv store now. Settings UI and validation belong to S-09 | One port for S-09 to replace | cheap | user (roadmap) |

## Design

### Data flow
```
NodeScreen ─tap Run─▶ RunController.start(publicKey)
   │                    ├─ airtime notice? (AirtimeNoticeStore) ─▶ store.notice = publicKey
   │                    ├─ preconditions (session state, latest run → cooldown, running flag)
   │                    ├─ checks = planChecks(capabilities)       [domain]
   │                    ├─ session.runChecks({ publicKey, checks, password, policy, signal, onProgress })
   │                    │      └─ MeshClient.runChecks: busy + ledger cooldown, per check:
   │                    │           write → wait sent (5 s) → wait push (attemptTimeout) → retry on NO_REPLY
   │                    ├─ classifyRun(outcomes, { cancelled, preflight })   [domain]
   │                    └─ repository.save(run) ─▶ store.last = { runId, status }, latest map refresh
RunScreen(/run/[id]) ─▶ repository.get(id) ─▶ rule = RULES[result][reason] ─▶ texts via t()
Dashboard rows ─▶ RunController.store.latest[publicKey] ─▶ lastRunStatus(run, now)
```

### Domain (`packages/domain/src/`)
- `diagnostics/reason-code.ts`: `REASONS_BY_RESULT` (D-1), `ReasonCode`, `isReasonFor(result, reason)`.
- `diagnostics/check.ts`: `CHECK_KINDS = ["login","status","telemetry"]`; `CheckOutcome { kind;
  result; reason; attempts; timeoutMs: number|null; timeoutSource: TimeoutSource|null;
  startedAt: number|null; durationMs: number|null; evidence: CheckEvidence|null }`;
  `CheckEvidence` union: `login { permissions; aclPermissions|null; firmwareLevel|null }`,
  `status { …RemoteStats fields by the same names }`, `telemetry { values; lppHex }`,
  `malformed { code; length; hex (≤ 64 bytes) }`. The adapter's decoded types satisfy these
  shapes structurally; the domain imports nothing. `planChecks(capabilities) → { run: CheckKind[];
  skipped: CheckOutcome[] } | { unsupported: CheckOutcome }` and `continuesAfter(outcome): boolean`
  (true only for `RESPONDED` that is not `LOGIN_REJECTED`) (D-2).
- `diagnostics/classify.ts`: `classifyRun(outcomes, { cancelled: boolean; preflight?:
  "NOT_CONNECTED" | "CAPABILITY_MISSING" | "UNEXPECTED_ERROR" }) → { result; reason;
  limitations: Limitation[] }`, with `Limitation = { check: CheckKind; result; reason }`. Order:
  preflight → cancelled (`NOT_TESTED`/`CANCELLED`, D-3) → login rejected (`RESPONDED`/
  `LOGIN_REJECTED`) → any reply (`RESPONDED`; `ALL_CHECKS_REPLIED` when every planned check
  replied, else `PARTIAL_REPLY`) → link lost or no ack (`TRANSPORT_UNAVAILABLE`, the check's
  reason) → err, malformed or capability (`UNSUPPORTED`, the check's reason) → `NO_RESPONSE`/
  `NO_REPLY` → otherwise `NOT_TESTED`/`UNEXPECTED_ERROR`. Limitations = every stored check that
  is not `RESPONDED`, including skipped telemetry.
- `diagnostics/rules.ts`: `RULES: { [R in ResultCode]: { [K in ReasonsOf<R>]: Rule } }` with
  `Rule = { summary: Key; explanation: Key; causes: Key[]; nextSteps: Key[]; limitations: Key[] }`
  and keys `diagnostic.rule.<RESULT>.<REASON>.<field>[.n]`. The mapped type makes a missing pair a
  type error. `NO_RESPONSE`/`NO_REPLY` causes: route, radio congestion and device, under a
  heading that says none is confirmed (FR-09 AC3). `ruleFor(result, reason)`.
- `diagnostics/run.ts`: `DiagnosticRun { id?; nodePublicKey; companion: { publicKey; name;
  firmwareVersion } ; startedAt; finishedAt; durationMs; attemptsUsed; attemptsPerCheck; result;
  reason; limitations; checks: CheckOutcome[] }`; port `DiagnosticRunRepository { save(run) →
  id; get(id) → run|null; latestPerNode() → Map<publicKey, DiagnosticRun> (checks omitted) }`.
- `diagnostics/status.ts`: `lastRunStatus(run, now)` and `ageBucket(ms)` (D-15).
- `policy/timeout.ts`: `TIMEOUT_CAP_MS = 30_000`, `TIMEOUT_FLOOR_MS = 5_000`,
  `TIMEOUT_DEFAULT_MS = 15_000`, `TIMEOUT_MARGIN = 2`, `OVERRIDE_RANGE_MS = [5_000, 60_000]`,
  `attemptTimeout({ estimateMs, overrideMs }) → { ms; source }` (D-4).
- `policy/retry.ts`: `ATTEMPTS_RANGE = [1, 3]`, `DEFAULT_DIAGNOSTIC_POLICY`,
  `assertAttempts(n)`, `shouldRetry(outcomeReason, attemptsUsed, allowed)` (D-6, D-18).
- `policy/cooldown.ts`: `COOLDOWN_MS = 60_000`, `cooldownRemaining(lastRun | null, now)` (only
  `attemptsUsed > 0` counts) and `cooldownRemainingAt(lastRequestAt | null, now)` for the ledger
  (D-7).

### Storage (`packages/storage/`)
- `migrations/0002_diagnostics.sql` (D-8) and the regenerated `src/migrations/generated.ts`.
- `src/diagnostics/run-repository.ts`: `SqliteDiagnosticRunRepository`. `save` inserts the run
  and its checks in one transaction, finding `device_id` by public key (`NodeNotFoundError` if
  absent). `get` and `latestPerNode` read with Zod row schemas (`result` from `RESULT_CODES`;
  `reason` checked with `isReasonFor`; JSON columns parsed). `latestPerNode` uses
  `MAX(finished_at)` per device with `id` as the tie-break.

### Adapter (`packages/meshcore-adapter/src/`)
- `client/errors.ts`: `BusyError { activity: "handshake" | "contacts" | "diagnostic" }` and
  `CooldownError { remainingMs }`.
- `client/request-ledger.ts`: `RemoteRequestLedger` (in-memory `Map<keyPrefix, lastRequestAt>`;
  `record(publicKey, at)`, `lastAt(publicKey)`).
- `client/mesh-client.ts`: options `ledger?`, `now?` (default `Date.now`) and `sentTimeoutMs?`.
  `runChecks` (D-10) per check: `onProgress`, then the request encoder, then
  `expectSent` (5 s; `err` → `COMMAND_REJECTED`, with the code in the evidence), then
  `expectReply(kind, prefix, attemptTimeout(est))`, then `shouldRetry`, and
  `continuesAfter` between checks. The ledger records the time of each write. Abort → current
  check `NOT_TESTED`/`CANCELLED`, and the loop ends. Transport loss → `TRANSPORT_UNAVAILABLE`/
  `LINK_LOST`. Malformed handling and correlation as in D-9. Decoded frames are mapped to
  `CheckEvidence`.
- `transport/remote-script.ts` (D-17); exports added to `index.ts`.

### Application (`apps/mobile/src/application/diagnostics/`)
- `ports.ts`: `AirtimeNoticeStore { seen(): Promise<boolean>; markSeen(): Promise<void> }`,
  `GuestPasswordSource`, `DiagnosticPolicy` getter.
- `run-controller.ts`: `RunController` with a store `{ latest: Record<publicKey, DiagnosticRun>;
  loaded; active: { publicKey; step: CheckKind; attempt; of; startedAt } | null; notice:
  publicKey | null; last: { publicKey; runId; result; reason } | null; refusal: Text | null;
  storage: "ok" | "error" }`. Methods: `load()` (idempotent, lesson), `start(publicKey)`,
  `confirmNotice()`, `dismissNotice()`, `cancel()`, `get(id)`. Errors map to D-11/D-13: `BusyError`
  → refusal "A check is already running" (nothing stored); `CooldownError` → refusal with the
  countdown (nothing stored); `TransportUnavailableError` before start → stored
  `NOT_CONNECTED`; anything else → stored `UNEXPECTED_ERROR`. A save failure → `storage: "error"`
  and the result card still shows the result marked "not saved".
- `presenter.ts`: `runButton(...)` (D-13), `progressText(active)`, `statusText(lastRunStatus)`
  (D-15), and `runDetails(run) → { summary; explanation; checks: { kind; outcome; evidence lines };
  limitations; causes; nextSteps }` as catalog `Text` items.
- `CompanionSession.runChecks(request)`: delegates to the current client, throws
  `TransportUnavailableError` when not connected, and aborts on user disconnect (the
  `fetchContacts` pattern). The session creates one `RemoteRequestLedger` and passes it to each
  `MeshClient`.

### Platform, composition, UI
- `platform/airtime-notice-store.ts`: kv-store key `notice.airtime.seen`; fake build uses the same
  real kv store (as `KvLastCompanionStore`).
- `composition/index.ts`: `runs: new RunController({ session, nodes, repository, clock: Date.now,
  password: async () => "", policy: () => DEFAULT_DIAGNOSTIC_POLICY, notice })`, sharing the
  SQLite driver promise with the node repository.
- `app/node/[id].tsx`: status line, run panel, notice, result card. `app/run/[id].tsx`: details.
  `components/node-row.tsx`: status line with glyph. `components/run-status.tsx`: glyph + text.
- `debug/scenarios.ts` + `fake-ble-platform.ts`: `Attempt` gains `{ diagnostic: RemoteScriptSpec;
  firmware?; dropAfterWrites? }`; new scenarios `diag-ok`, `diag-no-reply`, `diag-drop`
  (drop right after the status write), `diag-unsupported` (firmware v1.4.0 + login `err`) and
  `diag-malformed` (status push truncated). Cancel uses `diag-no-reply`.

### Error model
| Where | Signal | Stored result / reason | User sees |
|-------|--------|------------------------|-----------|
| Before start | not connected (race) | `TRANSPORT_UNAVAILABLE`/`NOT_CONNECTED` | "Transport error" + reconnect advice |
| Before start | `status` capability missing | `UNSUPPORTED`/`CAPABILITY_MISSING` | firmware limitation |
| Before start | `BusyError` / `CooldownError` | nothing stored | "A check is already running" / countdown |
| Per check | `sent` timeout | `TRANSPORT_UNAVAILABLE`/`COMPANION_NO_ACK` | reconnect advice |
| Per check | `err` frame | `UNSUPPORTED`/`COMMAND_REJECTED` (code in evidence) | firmware/contact limitation |
| Per check | malformed awaited frame | `UNSUPPORTED`/`MALFORMED_RESPONSE` (raw summary) | "reply could not be read" |
| Per check | timeout after all attempts | check `NO_RESPONSE`/`NO_REPLY` | "No response — cause unknown" when no check replied |
| Per check | login fail push | check `RESPONDED`/`LOGIN_REJECTED` | "The node answered and rejected the guest login" |
| Any time | transport drop | `TRANSPORT_UNAVAILABLE`/`LINK_LOST` (or `RESPONDED` + limitation if a check replied) | reconnect advice |
| Any time | Cancel | `NOT_TESTED`/`CANCELLED` | "Check cancelled" |
| Any time | unknown error | `NOT_TESTED`/`UNEXPECTED_ERROR` | "The check could not be completed" |

## Phases

### Phase 1: Domain codes, check model and radio policies
- Files:
  - `packages/domain/src/diagnostics/reason-code.ts` (+ test): D-1. Contract: `REASONS_BY_RESULT`, `ReasonCode`, `isReasonFor`.
  - `packages/domain/src/diagnostics/check.ts` (+ test): check kinds, `CheckOutcome`, `CheckEvidence`, `planChecks`, `continuesAfter` (D-2).
  - `packages/domain/src/policy/timeout.ts`, `retry.ts`, `cooldown.ts` (+ tests): D-4, D-6, D-7, D-18.
  - `packages/domain/src/index.ts`: exports.
- Proves: FR-10 AC3, AC4 (unit, boundaries from TR-03: estimate none, 0, 1, 2 499, 2 500, 14 999, 15 000, 15 001; override 4 999/5 000/60 000/60 001; attempts 0/1/3/4); FR-10 AC2 rule (unit: 59 999 / 60 000 ms, `attemptsUsed` 0); D-2 planning (unit: telemetry unsupported → skipped outcome; status unsupported → unsupported).
- Agent checks: `pnpm vitest run packages/domain`, `pnpm typecheck`, `pnpm lint`.
- Human checks: none.

### Phase 2: Classification, rule table and status line
- Files:
  - `packages/domain/src/diagnostics/classify.ts` (+ test): `classifyRun` (D-3, D-11).
  - `packages/domain/src/diagnostics/rules.ts` (+ test): `RULES`, `ruleFor`, key scheme.
  - `packages/domain/src/diagnostics/run.ts`: `DiagnosticRun`, `DiagnosticRunRepository`.
  - `packages/domain/src/diagnostics/status.ts` (+ test): `lastRunStatus`, `ageBucket` (D-15).
  - `packages/domain/src/index.ts`: exports.
- Proves: TR-02 / FR-06 AC1–AC5 (unit, table-driven over check-outcome combinations: all replied, login only, login rejected, login reply then link lost, no reply everywhere, malformed first, err first, no ack, cancel after a reply, preflight cases, empty outcomes → `UNEXPECTED_ERROR`); FR-09 AC1 (unit: every `REASONS_BY_RESULT` pair has a rule with non-empty summary, explanation and next steps; no rule for an invalid pair); FR-09 AC3 (unit: the `NO_RESPONSE`/`NO_REPLY` causes include route, congestion and device keys); FR-06 AC6 + FR-11 AC1 (unit: `lastRunStatus(null)` → `not_tested`; each result → its kind; age bucket edges 59 s / 60 s / 59 min / 60 min / 23 h / 24 h).
- Agent checks: `pnpm vitest run packages/domain`, `pnpm typecheck`, `pnpm lint`.
- Human checks: none.

### Phase 3: Storage for runs and checks
- Files:
  - `packages/storage/migrations/0002_diagnostics.sql`: D-8. Contract: table and column names, CHECKs, cascade deletes.
  - `packages/storage/src/migrations/generated.ts`: regenerated with `pnpm --filter @guardian/storage gen:migrations`.
  - `packages/storage/src/diagnostics/run-repository.ts`: `SqliteDiagnosticRunRepository implements DiagnosticRunRepository`.
  - `packages/storage/src/index.ts`: export.
  - `packages/storage/test/run-repository.int.test.ts`: round trip on a file-backed DB (re-opened = restart), latest per node with ties, unknown node → `NodeNotFoundError`, invalid stored reason → parse error, cascade on device delete.
  - `packages/storage/test/migrate.int.test.ts`: v1 DB seeded with devices → `migrateToLatest` → devices intact, tables exist, `user_version` 2.
- Proves: FR-05 AC4 (integration: every listed field persists); TR-11 (migration v1 → v2 keeps rows).
- Agent checks: `pnpm vitest run packages/storage`, `pnpm typecheck`, `pnpm lint`.
- Human checks: none.

### Phase 4: `MeshClient.runChecks` and remote scripts
- Files:
  - `packages/meshcore-adapter/src/client/errors.ts`: `BusyError`, `CooldownError`.
  - `packages/meshcore-adapter/src/client/request-ledger.ts`: `RemoteRequestLedger`.
  - `packages/meshcore-adapter/src/client/mesh-client.ts`: `runChecks` (D-5, D-6, D-9, D-10); `Error("busy")` → `BusyError`.
  - `packages/meshcore-adapter/src/transport/remote-script.ts`: `REMOTE_FRAMES`, `DIAG_CONTACTS_FRAMES`, `remoteScript()` (D-17).
  - `packages/meshcore-adapter/src/index.ts`: exports.
  - `packages/meshcore-adapter/test/remote-script.int.test.ts`: recorded frames equal the fixture; each derived edit, field by field.
  - `packages/meshcore-adapter/test/mesh-client-diagnostics.int.test.ts`: fake timers with `FakeTransport` and, where the fake cannot reach a path, a minimal transport double (lesson).
- Proves: FR-05 AC2 (login frame first, carries the given password; `loginFail` → `LOGIN_REJECTED`, no status written); FR-05 AC3 / TR-05 (abort during attempt 1 → no attempt-2 frame, a late reply after abort changes nothing, all listeners and timers released); FR-10 AC1 / TR-04 (concurrent `runChecks`, or during `getContacts` → `BusyError`; request within 60 s on a new client with the same ledger → `CooldownError`; after 60 s allowed); FR-10 AC3/AC4 (timeout armed from `sent` with estimate × 2; no estimate → 15 s; override; exactly `attempts` writes on silence); TR-08 (a push with another node's prefix is ignored; interleaved adverts and RX-log pushes are ignored); D-5 (no `sent` → `COMPANION_NO_ACK` after 5 s, no retry); D-9 (malformed awaited push → `MALFORMED_RESPONSE` with raw summary; malformed unrelated push ignored); transport drop mid-check → `LINK_LOST`; replay of `REMOTE_FRAMES` → three `RESPONDED` outcomes with evidence equal to the fixture's decoded values. All integration level.
- Agent checks: `pnpm vitest run packages/meshcore-adapter`, `pnpm typecheck`, `pnpm lint`.
- Human checks: none.

### Phase 5: Application use case, catalog and composition
- Files:
  - `apps/mobile/src/application/connection/companion-session.ts`: `runChecks` delegate, shared ledger, abort on disconnect.
  - `apps/mobile/src/application/diagnostics/ports.ts`, `run-controller.ts`, `presenter.ts` (+ `run-controller.int.test.ts`, `presenter.test.ts`).
  - `apps/mobile/src/platform/airtime-notice-store.ts`: kv-backed `AirtimeNoticeStore` (D-14).
  - `apps/mobile/src/composition/index.ts`: wire `runs` (D-16, D-18); share the DB promise.
  - `apps/mobile/src/i18n/en.json`: `diagnostic.*` (rules, checks, evidence labels, progress, refusals, notice, status lines, age buckets). PRD strings verbatim: "Run diagnostic", "Cancel", "No response — cause unknown", "Transport error", "A check is already running", "Not tested", "No reply in last test".
  - `apps/mobile/src/i18n/catalog.test.ts`: every `RULES` key exists; every status kind and age bucket resolves; the forbidden-words test now also covers the new keys (it scans all values).
- Proves: FR-05 AC1 (integration: progress step/attempt published before each write; cancel stores `NOT_TESTED`/`CANCELLED`); FR-05 AC4 (integration: the stored run has the companion identity from the session and timestamps from the fake clock); FR-06 AC2 (integration: drop mid-run → stored `TRANSPORT_UNAVAILABLE`); FR-10 AC1 (unit + integration: second `start` while active → refusal text, nothing stored); FR-10 AC2 (presenter: countdown from the stored latest run); FR-10 AC5 (integration: first `start` sets `notice`, `confirmNotice` marks seen and runs, next `start` runs directly); FR-10 AC6 / TR-18 request side (integration: no write without `start`; app-state background → `start` refused, no write); TR-01 (catalog: forbidden words; `NO_RESPONSE` summary text equals "No response — cause unknown"); D-11 (an unknown error → `UNEXPECTED_ERROR`, not link loss); FR-09 AC2 (presenter: `runDetails` lists checks, outcome, evidence, limitations, next steps).
- Agent checks: `pnpm vitest run apps/mobile`, `pnpm test`, `pnpm typecheck`, `pnpm lint`.
- Human checks: none.

### Phase 6: Screens, fake scenarios, e2e and docs
- Files:
  - `apps/mobile/src/app/node/[id].tsx`: status line, run panel (button + reason, progress, Cancel, notice), result card with "View details".
  - `apps/mobile/src/app/run/[id].tsx`: full details from `runDetails`.
  - `apps/mobile/src/components/run-status.tsx` (glyph + label), `components/node-row.tsx` (status line in the row and its accessibility label), `app/index.tsx` (30 s age refresh while focused).
  - `apps/mobile/src/platform/fake/fake-ble-platform.ts`, `apps/mobile/src/debug/scenarios.ts`: diagnostic attempts and scenarios (D-17).
  - `apps/mobile/e2e/diag-responded.yaml` (run on Room K: notice → progress → "Responded" card → details show three checks, battery 3.35 V, "last hop" RSSI → back: countdown visible, button disabled → Dashboard row "Responded just now"), `diag-no-response.yaml` ("No response — cause unknown", possible causes, no "offline"), `diag-transport-drop.yaml` ("Transport error", reconnect advice), `diag-unsupported.yaml` (firmware v1.4.0, login `err` → "Unsupported"; details list telemetry as not supported by v1.4.0), `diag-malformed.yaml` ("reply could not be read"), `diag-cancel.yaml` (Cancel during attempt 1 → "Check cancelled", Dashboard "Last test cancelled"). The suite grows to 15 flows.
  - `context/test-plan.md`: TR-01…TR-05, TR-08 → covered (S-04); TR-14 S-04 part (unit `runButton`, e2e unsupported details); TR-18 request side; TR-19 S-04 part (Maestro asserts status labels); list the new e2e flows; add `apps/mobile/src/application/diagnostics/run-controller.ts` and `packages/domain/src/diagnostics/check.ts` to *Mutation targets* and `stryker.targets`.
  - `stryker.targets`: the same two lines.
- Proves: FR-05 AC1, AC3; FR-06 AC1–AC6; FR-09 AC2; FR-10 AC2, AC5; FR-11 AC1–AC2 (e2e on the fake build, asserting text and accessibility labels).
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm e2e` (all flows; evidence: Maestro output and one screenshot per diag flow under `context/changes/run-diagnostic/evidence/`).
- Human checks:
  - On a phone with the CI APK (`android-apk` artifact), connected to the real companion: open a repeater or room server, tap **Run diagnostic**, accept the airtime notice, and check that it ends "Responded" with a battery voltage that matches the node. Note the per-check timeouts shown on the run screen (`docs/compatibility.md` gets the observed estimates).
  - Same phone: start a run and tap **Cancel** during "Attempt 1 of 2". The result reads "Check cancelled", and the button counts down to re-enable.
  - Read the run screen texts for `RESPONDED` and `NO_RESPONSE` (screenshots in evidence): are the explanation, possible causes and next steps clear, and do they avoid claiming a cause?
  - With TalkBack on, the Dashboard row reads the status words (e.g. "Responded 2 minutes ago"), not only the glyph.

## Risks and unknowns
- **Flood paths:** every sample was a direct path. `estTimeout` on flood may be large, and the
  30 s cap may then produce a false `NO_RESPONSE`. Mitigation: the "cause unknown" wording, the
  per-check timeout and its source shown on the run screen, and a human check that records real
  estimates.
- **Login fail push (`0x86`)** was never observed; `LOGIN_REJECTED` follows the firmware source.
- **Status without a session** (a guest login rejected or unsupported, then status) was not
  exercised. D-2 stops after a rejected login, so it is never sent.
- **Companion `err` codes:** the meaning of the code (for example, contact not found) is not
  verified. We store the code and show a generic limitation.
- **Late replies:** if attempt 1's push arrives after attempt 2 was written, the run accepts it
  (D-9). The second request still went out. That is airtime, but not a wrong result.
- **e2e budget:** 15 flows is the test plan's limit. Later slices must merge flows or push
  detail down to integration tests.
- **Phase 4 size** may exceed ~400 lines with tests. If it does, `/implement` may split the
  script into its own commit within the phase and log it as `[minor]`.

## Progress
<!-- One line per phase. /implement ticks it in the phase's own commit. -->
- [x] Phase 1: Domain codes, check model and radio policies
- [ ] Phase 2: Classification, rule table and status line
- [ ] Phase 3: Storage for runs and checks
- [ ] Phase 4: `MeshClient.runChecks` and remote scripts
- [ ] Phase 5: Application use case, catalog and composition
- [ ] Phase 6: Screens, fake scenarios, e2e and docs

## Human checks
<!-- Filled by /implement: one open checkbox per human check, with how to run it and evidence. -->

## Deviations
<!-- [minor] / [REVIEW] / [FOLLOW-UP] / [STUCK] entries, see autonomy.md section 3 -->

## Review response
<!-- revise mode only: one line per plan-review finding and what changed -->
