# Mutation check: connect-companion

Targets: `packages/domain/src/companion/capabilities.ts`, `packages/domain/src/companion/firmware.ts`,
`apps/mobile/src/application/connection/companion-session.ts`,
`packages/meshcore-adapter/src/client/mesh-client.ts` · Tests: Vitest via `stryker.config.mjs`
(each file run alone with `--mutate`).

Skipped as wiring or presentation: BLE platform, persistence, composition, screens, fake platform,
`fake-transport.ts`, `advertisement.ts`, `connection-state.ts` (type-only).

| File | Before | After (killed+timeout / survived / no coverage) |
|------|--------|-------|
| capabilities.ts | 100% | 100% (25 / 0 / 0) |
| firmware.ts | 92.9% | 92.9% (13 / 1 / 0) |
| companion-session.ts | 68.3% (155 / 61 / 11) | 80.2% (182 / 44 / 1) |
| mesh-client.ts | 67.4% (64 / 27 / 4) | 75.8% (72 / 19 / 4) |

## Mutants
| File:line | Mutator | Change | Decision | Note / test added |
|-----------|---------|--------|----------|-------------------|
| firmware.ts:4 | Regex | `(\d+)` major → `(\d)` | equivalent | a multi-digit major never equals a tested line |
| session: requestPermission/openSettings/permission-gated connect/dedupe/dispose/malformed (114-119, 138, 165-166, 260) | no coverage | block emptied | strengthen | tests for permission request, denied connect, duplicate advert, dispose, `HANDSHAKE_MALFORMED` |
| session:51,52,59 | StringLiteral/Boolean | initial state values | strengthen | initial-state test |
| session:100 | ArrowFunction | `load().catch` fallback | strengthen | failing store test |
| session:124 | Conditional/Logical | scan re-entry guard | strengthen | second `startScan` does not rescan |
| session:145 | Conditional/Call | old scan timer cleared | strengthen | old timer must not stop a newer scan |
| session:190, 203-204 | Boolean/Call | note cleared, dispose cleanup | strengthen | link-lost note and dispose tests |
| session:67-69 | abortable listener bookkeeping | accept | listener leak only; no observable state |
| session:90 | Conditional | `stopScan` on every app-state change | equivalent | `stopScan` is a no-op with no scan running |
| session:156-157 | lastTarget name fallback | accept | name only observable through the saved companion, which uses the handshake name |
| session:225, 233 | abort after link/handshake | equivalent | handshake itself rejects with `AbortError` on abort |
| session:247, 257, 267, 273 | stale-client and `ABORTED` guards | accept | outcome identical in the paths the fake can produce; needs a raced platform double |
| mesh-client:64-66 | send-only view for the library | accept | library never calls close/onFrame/onDisconnect for encoding |
| mesh-client:89-90 | unreachable kind guard | equivalent | `step` already filters by kind |
| mesh-client:101,107,111-114,152,157-159 | busy guard, unsubscribe, close, abort listener | strengthen | close, unsubscribe, listener-release and guard tests; abort helper now respects event type |
| mesh-client:126,129 | closed fast path, swallowed rejection | accept | `write` on a closed transport raises the same error |
| mesh-client:132-133 | `send` failing with a non-transport error | accept | no transport double throws one |
| mesh-client:175,180,184 | late/foreign frames | accept | needs a fake that injects out-of-order frames; covered by decode tests |
| mesh-client:191 | `unavailable` after drop | accept | `FakeTransport.write` throws after a drop, same error |

No `bug` mutants.

## Dead-weight tests
None found.

## Gaps for the test plan
- `FakeTransport` cannot inject an unsolicited or wrong-kind frame, so the "ignore frames that are
  not the awaited one" rule in `MeshClient` is not pinned.
- No platform double that resolves a link in the same tick as an abort, so the post-link abort
  branch in `CompanionSession.link` is not reached.

## Proposed lessons
none
