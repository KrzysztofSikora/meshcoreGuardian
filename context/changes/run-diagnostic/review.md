# Review: run-diagnostic

Verdict: CHANGES REQUESTED
Gates: typecheck ok, lint ok, unit tests ok (946/946), e2e ok (15/15) · Round: 1

## Plan vs diff
| File | Status | Note |
|------|--------|------|
| `packages/domain/src/diagnostics/reason-code.ts` (+ test) | done | D-1 vocabulary, `isReasonFor` |
| `packages/domain/src/diagnostics/check.ts` (+ test) | done | `planChecks`, `continuesAfter` (D-2) |
| `packages/domain/src/diagnostics/classify.ts` (+ test) | done | order as planned; cancel wins (D-3) |
| `packages/domain/src/diagnostics/rules.ts` (+ test) | done | mapped type makes a missing pair a type error |
| `packages/domain/src/diagnostics/run.ts` | done | |
| `packages/domain/src/diagnostics/status.ts` (+ test) | done | D-15 |
| `packages/domain/src/policy/timeout.ts`, `retry.ts`, `cooldown.ts` (+ tests) | done | D-4, D-6, D-7, D-18 |
| `packages/domain/src/index.ts` | done | |
| `packages/storage/migrations/0002_diagnostics.sql`, `src/migrations/generated.ts` | done | D-8 |
| `packages/storage/src/diagnostics/run-repository.ts`, `src/index.ts` | done | |
| `packages/storage/test/run-repository.int.test.ts`, `test/migrate.int.test.ts` | done | |
| `packages/meshcore-adapter/src/client/errors.ts`, `request-ledger.ts` | done | `BusyError` keeps message "busy" |
| `packages/meshcore-adapter/src/client/mesh-client.ts` | done | `RangeError` before any write logged as `[minor]` |
| `packages/meshcore-adapter/src/transport/remote-script.ts`, `src/index.ts` | done | D-17 |
| `packages/meshcore-adapter/test/mesh-client-diagnostics.int.test.ts`, `remote-script.int.test.ts` | done | |
| `apps/mobile/src/application/connection/companion-session.ts` | done | shared ledger, abort on disconnect |
| `apps/mobile/src/application/diagnostics/ports.ts` | done | adds `appState` (plan-review #3) |
| `apps/mobile/src/application/diagnostics/run-controller.ts` (+ int test) | diverged | stores an empty companion identity when the link drops (R1) |
| `apps/mobile/src/application/diagnostics/presenter.ts` (+ test) | diverged | the run's own limitations are not shown (R5) |
| `apps/mobile/src/platform/airtime-notice-store.ts` | done | D-14 |
| `apps/mobile/src/composition/index.ts` | done | shared DB promise |
| `apps/mobile/src/i18n/en.json`, `catalog.test.ts` | done | forbidden-words test covers new keys |
| `apps/mobile/src/app/node/[id].tsx`, `app/run/[id].tsx`, `app/index.tsx` | done | |
| `apps/mobile/src/components/run-status.tsx`, `node-row.tsx` | done | glyph hidden from a11y, label carries the meaning |
| `apps/mobile/src/platform/fake/fake-ble-platform.ts`, `debug/scenarios.ts` | done | `diag-drop`/`diag-malformed` changes logged as `[minor]` |
| `apps/mobile/e2e/diag-*.yaml` (6 flows) | done | |
| `context/test-plan.md`, `stryker.targets` | done | |
| `apps/mobile/e2e/lib/connect-diag.yaml` | unplanned | logged `[minor]` |
| `apps/mobile/e2e/contacts-label-restart.yaml` | unplanned | logged `[minor]` (scroll) |
| `apps/mobile/src/components/use-now.ts` | unplanned | logged `[minor]` |
| `apps/mobile/src/platform/fake/in-memory.ts` | unplanned | `InMemoryAirtimeNoticeStore` test double |
| `apps/mobile/src/application/connection/companion-session.int.test.ts` | unplanned | tests for `runChecks` on the session |
| `context/changes/run-diagnostic/{plan-review,mutation}.md`, `evidence/`, `context/roadmap.md` | unplanned | workflow artifacts |

## Areas
| Area | Result | One-line reason |
|------|--------|-----------------|
| Correctness | fail | a run that loses the link is stored with an empty companion identity (FR-05 AC4) |
| Design | ok | layers respected: classification and policy in domain, orchestration in `MeshClient`, storage behind a port |
| Safety | ok | password only passed through, never stored or logged; stored rows parsed with Zod |
| Tests | concern | the drop test asserts result/reason but not the stored companion; busy-contacts test pins a misleading text |
| Simplicity | ok | small focused modules; `run.limitations` is computed and stored but unused (R5) |
| Plan fidelity | concern | plan-review #2 and #4 were not acted on; PRD FR-06 AC2 conflict not raised as `[REVIEW]` |
| Agent decisions | ok | D-1 lives in `REASONS_BY_RESULT`, D-8 in one migration; both swappable as claimed. Mutation `equivalent`/`accept` decisions checked and plausible |

## Findings
### R1: A run that loses the link is stored with an empty companion identity
- Severity: blocker
- Where: `apps/mobile/src/application/diagnostics/run-controller.ts:208-212`
- Problem: `finish()` reads the companion from the live session state after `runChecks` resolves.
  On a link drop, `MeshClient.onTransportDisconnect` calls `CompanionSession.onLinkDropped`
  synchronously, which sets `connection: { kind: "disconnected" }` before the run's continuation
  runs. The run is then saved with `{ publicKey: "", name: "", firmwareVersion: "" }`. Checked by
  adding `expect(runs.saved[0]!.companion.name).not.toBe("")` to the existing test "a dropped link
  is stored as TRANSPORT_UNAVAILABLE…": it fails with `expected '' not to be ''`. FR-05 AC4
  requires the companion identity on every run, and the transport-error runs are exactly the ones
  where the user needs to know which companion was used. The run screen's "Companion" fact shows
  blanks for them.
- Fix: capture `session.connection.companion` in `execute()` before the run starts (it is
  connected at that point) and pass it to `finish()`; use the empty fallback only for the
  `NOT_CONNECTED` preflight. Add the companion assertion to the drop test (and to a cancel-by-
  disconnect case).
- Effort: small
- Lesson candidate: Capture the context a record needs (companion, session facts) when the operation starts; never read it from live state after an await that can span a disconnect.
- Decision: fixed (ed4a1bb) + lesson proposed

### R2: PRD FR-06 AC2 and the roadmap's best-evidence rule are overridden without a `[REVIEW]` deviation
- Severity: major
- Where: `packages/domain/src/diagnostics/classify.ts:158,171-175`; `context/changes/run-diagnostic/plan.md` (Decisions, Deviations)
- Problem: a link lost after the login replied is classified `RESPONDED`/`PARTIAL_REPLY`, while PRD
  FR-06 AC2 says a disconnect "during the run" is `TRANSPORT_UNAVAILABLE`. This has no Decisions
  row (only the error-model table, l.251). D-3 goes the other way and overrides the user-decided
  roadmap rule ("`RESPONDED` if the node replied to any check"): a cancel after a reply is
  `NOT_TESTED`. Plan-review #2 asked for a D-row and pre-logged `[REVIEW]` deviations for both;
  the *Review response* section is empty and Deviations has only `[minor]` entries. CLAUDE.md:
  "If code and an artifact disagree, raise it (… a `[REVIEW]` deviation)". The PR would not show
  the person that two artifacts were overruled.
- Fix: add a D-row "link lost after a reply" (chosen: `RESPONDED` + `LINK_LOST` limitation;
  alternative: `TRANSPORT_UNAVAILABLE` per AC2), and log `[REVIEW]` deviations for it and for D-3
  so `/pr-body` lists them for a decision. No code change unless the person picks the alternative
  (one branch in `classifyRun` each).
- Effort: small
- Lesson candidate: Every plan-review finding gets a line in *Review response*; a PRD/roadmap conflict is always a `[REVIEW]` deviation, not only an error-model row.
- Decision: fixed (docs: D-19 and two [REVIEW] deviations in plan.md; no code change) + lesson proposed

### R3: A contact sync and a run refuse each other with wrong texts
- Severity: minor
- Where: `apps/mobile/src/application/diagnostics/run-controller.ts:166`; `apps/mobile/src/application/nodes/nodes-controller.ts:49-56`; `apps/mobile/src/application/diagnostics/presenter.ts:23-50`
- Problem: every `BusyError` maps to "A check is already running", including
  `BusyError("contacts")` (the test "a client that is busy elsewhere…" pins this). Tapping Run
  during the automatic sync right after connect therefore claims a check is running. In the other
  direction, Sync on the Dashboard while a run is in flight gets `BusyError("diagnostic")`, which
  `failureFor` maps to "Contact sync failed (unexpected error)." `runButton` does not know about
  sync state, and `syncButton` does not know about runs. Plan-review #4 raised this; it was not
  addressed.
- Fix: map `BusyError.activity` in both controllers ("Contacts are syncing; try again in a
  moment" / "A diagnostic is running; sync after it ends"), or disable each button while the other
  activity runs. Add one test per direction.
- Effort: small
- Lesson candidate: no
- Decision: fixed (e42376e)

### R4: A run keeps sending retries and later checks after the app goes to the background
- Severity: minor
- Where: `apps/mobile/src/application/diagnostics/run-controller.ts:94-121,133-185`
- Problem: `appState` is checked only in `start`/`confirmNotice`. Neither `RunController`,
  `CompanionSession` (which only stops the scan on background) nor `MeshClient` reacts to a move to
  the background during a run, so retry writes and the status/telemetry requests still go out
  (bounded: up to 3 checks × 2 attempts × 30 s). NFR-07 says no BLE activity is started while
  backgrounded, and `test-plan.md` TR-18 now says "none in the background", which the tests do
  not show for a run already in flight. Plan-review #3 asked to define this behaviour; the plan
  does not.
- Fix: either cancel the active run on `appState` → `background` (subscribe in `RunController`;
  stored as `CANCELLED`) with a test, or record the decision ("a started run finishes in the
  background") as a D-row and narrow the TR-18 wording.
- Effort: small
- Lesson candidate: no
- Decision: fixed (2cf816b)

### R5: The run's own limitations are stored but never shown
- Severity: minor
- Where: `apps/mobile/src/application/diagnostics/presenter.ts:193`
- Problem: `classifyRun` computes `limitations` (each check that did not reply, including skipped
  telemetry), the repository stores it in `limitations_json`, but `runDetails` builds the
  Limitations section only from the rule's static keys; `run.limitations` is read nowhere in the
  app. For `RESPONDED`/`ALL_CHECKS_REPLIED` with telemetry unsupported, the Limitations section is
  empty (the skipped check is visible only in the checks list). The roadmap says "each failed
  check listed under limitations", and FR-11 AC1 cites "Unsupported telemetry".
- Fix: add one line per `run.limitations` entry (e.g. `diagnostic.limitation` with check name and
  outcome text) before the rule's generic limitations, with a presenter test; or drop the field
  from the model if the checks list is meant to carry it, and say so in the plan.
- Effort: small
- Lesson candidate: no
- Decision: fixed (80926fd)
