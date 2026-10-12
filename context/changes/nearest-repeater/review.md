# Review: nearest-repeater

Verdict: CHANGES REQUESTED
Gates: typecheck ok, lint ok, unit tests ok, e2e fail (16/17, `diag-responded` fails, R1), mutation `nearest.ts` ok (83.5 %, 13 survivors, matches `mutation.md`) · Round: 1

## Plan vs diff
| File | Status | Note |
|------|--------|------|
| `packages/domain/src/geo/geo.ts` (+ test) | done | haversine, bearing, 8-point compass, 0,0 / out-of-range → `null` |
| `packages/domain/src/nodes/nearest.ts` (+ test) | done | ranking per D-3/D-4 plus the `syncedAt` filter from the `[REVIEW]` deviation (see R2) |
| `packages/domain/src/nodes/node.ts`, `companion/companion.ts`, `index.ts` | done | required nullable fields and exports |
| `packages/domain/src/nodes/ports.ts` | done | `SyncOrigin`, `applySync` `origin`, `syncOrigin()` |
| `packages/meshcore-adapter/src/client/mesh-client.ts` | done | hops and position from the contact frame, position from self info |
| `packages/meshcore-adapter/test/mesh-client{,-contacts}.int.test.ts`, `test/support/frames.ts` | done | frames.ts builders take lat/lon (logged as minor deviation) |
| `packages/meshcore-adapter/src/transport/nearest-script.ts` (+ test), `src/index.ts` | done | |
| `packages/storage/migrations/0003_nearest.sql`, `src/migrations/generated.ts` | done | D-1, D-2 schema as planned |
| `packages/storage/src/sync/contacts.ts` | done | columns and origin row in the sync transaction |
| `packages/storage/src/nodes/node-repository.ts` | done | Zod-checked columns, `syncOrigin()` |
| `packages/storage/test/{contact-sync,node-repository,migrate}.int.test.ts` | done | |
| `apps/mobile/src/application/nodes/nodes-controller.ts` (+ int test) | done | companion captured before the first await; ordering change logged as minor deviation |
| `apps/mobile/src/application/nodes/nearest-presenter.ts` (+ test) | done | |
| `apps/mobile/src/components/nearest-repeater-card.tsx` | done | D-6, D-9 (see R3) |
| `apps/mobile/src/app/index.tsx` | done | `ListHeaderComponent` (D-10) |
| `apps/mobile/src/i18n/en.json`, `catalog.test.ts` | done | |
| `apps/mobile/src/platform/fake/fake-ble-platform.ts`, `debug/scenarios.ts` | done | |
| `apps/mobile/e2e/nearest-positions.yaml`, `nearest-no-positions.yaml` | done | |
| `context/test-plan.md`, `stryker.targets` | done | D-11, moved to phase 1 (logged) |
| `context/changes/nearest-repeater/evidence/*.png` | done | three screenshots, each < 300 KB |
| `apps/mobile/e2e/{contacts-sync,diag-cancel,diag-no-response}.yaml` | unplanned | `scrollUntilVisible` because the card pushes rows down; logged under Deviations (phase 4); `diag-responded.yaml` needed the same and was missed (R1) |
| `apps/mobile/src/application/nodes/presenter.test.ts`, `packages/domain/src/nodes/node.test.ts` | unplanned | builder fields; logged (plan-review 3) |
| `context/roadmap.md` | unplanned | status line only |

## Areas
| Area | Result | One-line reason |
|------|--------|-----------------|
| Correctness | concern | a partial sync from the same companion hides every repeater it did not report and can show "No repeater in the companion's contacts" (R2) |
| Design | ok | layers respected: domain is import-free, card reads stored state only, no extra radio request |
| Safety | ok | positions validated at decode (`advertisedPosition`), by SQL CHECKs and by Zod on read; no secrets; privacy export risk logged as `[FOLLOW-UP]` for S-08 |
| Tests | fail | e2e gate fails: `diag-responded` lost its last assertion under the new card (R1). Otherwise behaviour-level ranking, presenter, storage and controller tests, the disconnect-during-fetch lesson test and the AC6 frame assertion are good. Mutation re-run on `nearest.ts`: 13 survivors as recorded; the table says line 49 "x6" but there are 7, all the same redundant-guard equivalence, so the decision holds |
| Simplicity | ok | small, cohesive modules |
| Plan fidelity | ok | every planned file changed; divergences logged |
| Agent decisions | concern | the `[REVIEW]` `syncedAt` filter (plan-review 1) fixed the cross-companion case but regressed the same-companion partial sync (R2); D-1/D-2 schema stays in one migration as claimed |

## Findings
### R1: `diag-responded` e2e flow fails because the card pushes Room K's status below the fold
- Severity: blocker
- Where: `apps/mobile/e2e/diag-responded.yaml:27`
- Problem: `pnpm e2e` ends `1/17 Flow Failed`: `diag-responded` fails on its last step, `assertVisible: "Responded just now"` after `back` to the Dashboard. In the failure hierarchy (`~/.maestro/tests/2026-10-12_214645/diag-responded/screen-hierarchy/`), the Room K row sits at the bottom edge of the screen (bounds `[63,2246][1017,2337]`). Only the name is on screen; the status line is below it. The card, now the `ListHeaderComponent`, adds height above the rows. Phase 4 gave `diag-cancel`, `diag-no-response` and `contacts-sync` a `scrollUntilVisible` for this reason but missed this flow. The other 16 flows pass, including both new `nearest-*` flows.
- Fix: replace the last `assertVisible` with `scrollUntilVisible: { element: "Responded just now" }`, as in `diag-cancel.yaml`. Then run `pnpm e2e` again.
- Effort: small
- Lesson candidate: When a change adds height above a shared list, grep every e2e flow for assertions on that list's rows and run the full suite before the commit
- Decision: open

### R2: A partial sync hides repeaters that are still in the contacts, and can claim there are none
- Severity: major
- Where: `packages/domain/src/nodes/nearest.ts:41`, `apps/mobile/src/application/nodes/nearest-presenter.ts:70`
- Problem: `rankRepeaters` keeps only nodes with `syncedAt === origin.at`. A partial sync (`complete = false`, e.g. the contacts stream times out) updates `synced_at` only for the contacts it received, but rewrites the origin time. So after a partial sync **from the same companion**, every repeater it did not receive drops off the card, although its stored path belongs to that companion and it is still `in_contacts`. If the partial batch has no repeater, the card says "No repeater in the companion's contacts." while the list below shows repeaters. Reproduced: repeater `a` (direct, synced at 10) + partial sync at 20 that reported only chat node `b` → `nearestRepeaters(nodes, null, 20)` returns `{"nearest":null,"others":[]}`. The storage test "keeps the path of a node a partial sync from another companion did not report" covers only the other-companion case. Partial syncs are an expected outcome (`sync.partial` in the presenter), so this is a reachable path, and the empty text is a false statement on the Dashboard.
- Fix: A (honest, plan-review's alternative): store the companion per node (`path_companion_key`, nullable, in `0003_nearest.sql` since it is not released) written by `applyContactSync`, and filter `node.pathCompanionKey === origin.companionPublicKey` instead of `syncedAt === origin.at`. B (cheaper, no schema): keep the filter but only when the last sync was partial **and** from a different companion than the rows (needs the previous companion key anyway), or: when the filter leaves nothing but unfiltered contact repeaters exist, show a different empty text ("The last contact sync was incomplete. Use Sync contacts to update the list.") instead of "No repeater in the companion's contacts". Add a domain/presenter test for a same-companion partial sync either way.
- Effort: medium
- Lesson candidate: When a filter narrows data to "the last operation", test the case where the last operation was partial and the same source, not only a different source
- Decision: open

### R3: The card's one-second clock keeps running while the Dashboard is not focused
- Severity: minor
- Where: `apps/mobile/src/components/nearest-repeater-card.tsx:46`
- Problem: `useNow(true, COUNTDOWN_TICK_MS)` re-renders the card every second for as long as the Dashboard is mounted, including while the user is on the node screen or elsewhere in the stack. The Dashboard itself gates its clock with `useNow(useIsFocused(), STATUS_REFRESH_MS)` (`apps/mobile/src/app/index.tsx:31`), and the tick is only needed for the cooldown reason under the button.
- Fix: `useNow(useIsFocused(), COUNTDOWN_TICK_MS)` like the screen it sits on.
- Effort: small
- Lesson candidate: no
- Decision: open
