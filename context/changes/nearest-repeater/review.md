# Review: nearest-repeater

Verdict: APPROVE WITH FOLLOW-UPS
Gates: typecheck ok, lint ok, unit tests ok, e2e ok (17/17), mutation `nearest.ts` ok (84.5 %, 71 killed / 13 survived, all on lines 22/49/59 as decided in `mutation.md`; the changed candidate filter on line 40 has no survivor) · Round: 3

Round 1 (gates then: e2e 16/17): R1 blocker, R2 major, R3 minor. Round 2 re-checked those fixes and the new `path_companion_key` design (R4, R5). Round 3 reviews 945f395, which applies the PR #19 decision on D-3 (room servers are candidates, the card shows the role, heading "Nearest node").

## Round 3 re-check (945f395, PR #19 D-3)
| Asked at PR #19 | Implemented | Verified |
|-----------------|-------------|----------|
| Candidates: effective role repeater or room server | `nearest.ts:40` | yes: domain tests "keeps contact repeaters and room servers only", "ranks a room server by the same rules"; user role override test still passes |
| Same ranking rules | unchanged sort | yes |
| Card shows the node's role | `CandidateModel.role` via `roleText(effectiveRole(node))`, rendered in `Candidate` | yes in unit tests (presenter, catalog); not shown in any e2e flow or screenshot (R6) |
| Heading fits both roles | `nearest.heading` "Nearest node", `nearest.empty` "No repeater or room server …" | yes; e2e flows updated and pass. Evidence, PRD, plan text and PR body still say "Nearest repeater" (R6, R7) |
| D-1, D-2, rest unchanged | | yes. One unrequested addition: the nearest candidate became a link (R8) |

## Round 2 re-check
| Finding | Fix | Verified |
|---------|-----|----------|
| R1 | 981e981: `scrollUntilVisible` for "Responded just now" | yes: `diag-responded` passes, e2e 17/17 |
| R2 | d75247f: nullable `devices.path_companion_key` in unreleased `0003`, written by `applyContactSync`, Zod-checked on read; `rankRepeaters` filters on `pathCompanionKey === origin.companionPublicKey` | yes: domain, presenter and storage tests cover a same-companion partial sync and keep the other-companion case; the card no longer says "No repeater" while the companion still lists repeaters. Side effect in R4 |
| R3 | 78f2358: `useNow(useIsFocused(), COUNTDOWN_TICK_MS)` | yes |

## Plan vs diff
| File | Status | Note |
|------|--------|------|
| `packages/domain/src/geo/geo.ts` (+ test) | done | haversine, bearing, 8-point compass, 0,0 / out-of-range → `null` |
| `packages/domain/src/nodes/nearest.ts` (+ test) | done | ranking per D-3/D-4; filter now on `pathCompanionKey` (R2 `[REVIEW]` deviation) |
| `packages/domain/src/nodes/node.ts`, `companion/companion.ts`, `index.ts` | done | required nullable fields and exports |
| `packages/domain/src/nodes/ports.ts` | done | `SyncOrigin`, `applySync` `origin`, `syncOrigin()` |
| `packages/meshcore-adapter/src/client/mesh-client.ts` | done | hops and position from the contact frame, position from self info |
| `packages/meshcore-adapter/test/mesh-client{,-contacts}.int.test.ts`, `test/support/frames.ts` | done | frames.ts builders take lat/lon (logged as minor deviation) |
| `packages/meshcore-adapter/src/transport/nearest-script.ts` (+ test), `src/index.ts` | done | |
| `packages/storage/migrations/0003_nearest.sql`, `src/migrations/generated.ts` | done | D-1, D-2 schema plus `path_companion_key` (R2 deviation, logged); D-1 row not updated (R5) |
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
| `context/lessons.md` | unplanned | two lessons proposed from R1 and R2 |
| `apps/mobile/e2e/diag-responded.yaml` | unplanned | R1 fix |
| D-3 change (945f395): `nearest.ts`, `nearest-presenter.ts`, card, `en.json`, catalog/domain/presenter tests, both `nearest-*.yaml` | done | matches the PR #19 decision and the updated D-3 row |
| `context/changes/nearest-repeater/evidence/*.png` (round 3) | diverged | not re-taken after 945f395: show "Nearest repeater" and no role line (R6) |
| `apps/mobile/src/components/nearest-repeater-card.tsx:79-83` | unplanned | nearest candidate wrapped in a `Link` to `/node/[id]`; not asked at PR #19, not logged (R8) |

## Areas
| Area | Result | One-line reason |
|------|--------|-----------------|
| Correctness | ok | R2, R4 fixed; round 3 D-3 change is correct and tested at domain and presenter level |
| Design | ok | layers respected: domain is import-free, card reads stored state only, no extra radio request |
| Safety | ok | positions validated at decode (`advertisedPosition`), by SQL CHECKs and by Zod on read; no secrets; privacy export risk logged as `[FOLLOW-UP]` for S-08 |
| Tests | concern | round 3: no e2e flow or scenario contains a ranked room server, so the role line is only unit-tested (R6). Round 2: e2e 17/17; same-companion partial-sync tests added at domain, presenter and storage level. Round 1: behaviour-level ranking, presenter, storage and controller tests, the disconnect-during-fetch lesson test and the AC6 frame assertion are good. Mutation re-run on `nearest.ts`: 13 survivors as recorded; the table says line 49 "x6" but there are 7, all the same redundant-guard equivalence, so the decision holds |
| Simplicity | ok | small, cohesive modules |
| Plan fidelity | concern | evidence screenshots, PRD FR-21, plan Goal/Design and PR body describe the pre-PR-#19 card (R6, R7); unlogged link on the nearest candidate (R8) |
| Agent decisions | ok | D-1 updated (R5); D-3 row records the user's PR #19 choice and is implemented in one place (`rankRepeaters` filter) |

## Findings
### R1: `diag-responded` e2e flow fails because the card pushes Room K's status below the fold
- Severity: blocker
- Where: `apps/mobile/e2e/diag-responded.yaml:27`
- Problem: `pnpm e2e` ends `1/17 Flow Failed`: `diag-responded` fails on its last step, `assertVisible: "Responded just now"` after `back` to the Dashboard. In the failure hierarchy (`~/.maestro/tests/2026-10-12_214645/diag-responded/screen-hierarchy/`), the Room K row sits at the bottom edge of the screen (bounds `[63,2246][1017,2337]`). Only the name is on screen; the status line is below it. The card, now the `ListHeaderComponent`, adds height above the rows. Phase 4 gave `diag-cancel`, `diag-no-response` and `contacts-sync` a `scrollUntilVisible` for this reason but missed this flow. The other 16 flows pass, including both new `nearest-*` flows.
- Fix: replace the last `assertVisible` with `scrollUntilVisible: { element: "Responded just now" }`, as in `diag-cancel.yaml`. Then run `pnpm e2e` again.
- Effort: small
- Lesson candidate: When a change adds height above a shared list, grep every e2e flow for assertions on that list's rows and run the full suite before the commit
- Decision: fixed (981e981) + lesson proposed

### R2: A partial sync hides repeaters that are still in the contacts, and can claim there are none
- Severity: major
- Where: `packages/domain/src/nodes/nearest.ts:41`, `apps/mobile/src/application/nodes/nearest-presenter.ts:70`
- Problem: `rankRepeaters` keeps only nodes with `syncedAt === origin.at`. A partial sync (`complete = false`, e.g. the contacts stream times out) updates `synced_at` only for the contacts it received, but rewrites the origin time. So after a partial sync **from the same companion**, every repeater it did not receive drops off the card, although its stored path belongs to that companion and it is still `in_contacts`. If the partial batch has no repeater, the card says "No repeater in the companion's contacts." while the list below shows repeaters. Reproduced: repeater `a` (direct, synced at 10) + partial sync at 20 that reported only chat node `b` → `nearestRepeaters(nodes, null, 20)` returns `{"nearest":null,"others":[]}`. The storage test "keeps the path of a node a partial sync from another companion did not report" covers only the other-companion case. Partial syncs are an expected outcome (`sync.partial` in the presenter), so this is a reachable path, and the empty text is a false statement on the Dashboard.
- Fix: A (honest, plan-review's alternative): store the companion per node (`path_companion_key`, nullable, in `0003_nearest.sql` since it is not released) written by `applyContactSync`, and filter `node.pathCompanionKey === origin.companionPublicKey` instead of `syncedAt === origin.at`. B (cheaper, no schema): keep the filter but only when the last sync was partial **and** from a different companion than the rows (needs the previous companion key anyway), or: when the filter leaves nothing but unfiltered contact repeaters exist, show a different empty text ("The last contact sync was incomplete. Use Sync contacts to update the list.") instead of "No repeater in the companion's contacts". Add a domain/presenter test for a same-companion partial sync either way.
- Effort: medium
- Lesson candidate: When a filter narrows data to "the last operation", test the case where the last operation was partial and the same source, not only a different source
- Decision: fixed (d75247f) + lesson proposed

### R3: The card's one-second clock keeps running while the Dashboard is not focused
- Severity: minor
- Where: `apps/mobile/src/components/nearest-repeater-card.tsx:46`
- Problem: `useNow(true, COUNTDOWN_TICK_MS)` re-renders the card every second for as long as the Dashboard is mounted, including while the user is on the node screen or elsewhere in the stack. The Dashboard itself gates its clock with `useNow(useIsFocused(), STATUS_REFRESH_MS)` (`apps/mobile/src/app/index.tsx:31`), and the tick is only needed for the cooldown reason under the button.
- Fix: `useNow(useIsFocused(), COUNTDOWN_TICK_MS)` like the screen it sits on.
- Effort: small
- Lesson candidate: no
- Decision: fixed (78f2358)

### R4: The "As of the last contact sync" time is wrong for repeaters kept from an earlier partial sync
- Severity: minor
- Where: `apps/mobile/src/application/nodes/nearest-presenter.ts:89-92`
- Problem: after the R2 fix the card can rank repeaters whose hops and position come from an earlier sync of the same companion (`node.syncedAt < origin.at`). `asOf` still prints `formatTime(origin.at)`, the time of the latest (partial) sync. So the line under the nearest repeater says "As of the last contact sync, <latest time>" for data that is older. The new presenter test "keeps repeaters an earlier partial sync from the same companion reported (R2)" builds exactly this case (`syncedAt: SYNCED - 10`, `origin.at = SYNCED`) and does not check `asOf`. FR-21 AC4 asks for honest labelling. This is minor: the companion is the same and "last contact sync" stays true in spirit, but the time shown is not.
- Fix: use the shown node's own sync time, `formatTime(nearest.node.syncedAt)`, for `asOf` (keep `null` when `origin` is `null`), and assert it in the R2 presenter test. Alternative: keep `origin.at` and change the text to "Path as of the last contact sync that reported it".
- Effort: small
- Lesson candidate: no
- Decision: fixed (63fe281)

### R5: Decision D-1 does not mention the new `path_companion_key` column
- Severity: minor
- Where: `context/changes/nearest-repeater/plan.md:71`
- Problem: D-1 (costly, the storage shape) still lists only `path_hops`, `adv_lat` and `adv_lon`. The R2 `[REVIEW]` deviation (line 285) says it "extends D-1's shape", but the Decisions row a reader checks at the PR, and that `/address-pr` acts on, is out of date with `0003_nearest.sql`. The superseded plan-review-1 deviation (line 284) and the plan-review note (line 297) still describe the `syncedAt` filter as the design.
- Fix: add `path_companion_key TEXT` (nullable, 64 hex, the companion that gave `path_hops`, filter key for the ranking) to D-1's chosen option. Mark line 297 as superseded by R2.
- Effort: small
- Lesson candidate: no
- Decision: fixed (plan.md D-1 row and superseded note updated, no code)

### R6: Evidence screenshots and the fake scenario predate the PR #19 change, so the human check reviews a card that no longer exists
- Severity: major
- Where: `context/changes/nearest-repeater/evidence/nearest-with-positions.png`, `nearest-without-positions.png`, `nearest-empty.png`; `packages/meshcore-adapter/src/transport/nearest-script.ts:79-87`
- Problem: the evidence PNGs were last committed in 16ab227; 945f395 did not touch them. `nearest-with-positions.png` shows the heading "Nearest repeater" and no role line under the name. The plan's first human check ("wording reads as last known/advertised … the card does not crowd the list") points the person at these files, so they would approve old wording and a card one line shorter per candidate than the shipped one. Also, the `nearest` scenario edits only seven repeaters; no room server gets a path or position, so neither the e2e flows nor any screenshot ever show a room server ranked on the card or its "Room server" role, which is the behaviour the PR #19 decision asked for ("must never call a room server a repeater"). `nearest-positions.yaml` asserts only `"Repeater"`.
- Fix: add one recorded room server (e.g. Room K) to `NEAREST_CONTACT_EDITS` with a known path so it ranks inside the first six (update `nearest-script.int.test.ts`), assert its name and "Room server" in `nearest-positions.yaml` (inside "Other nearby" or as nearest), run `pnpm e2e`, and copy the three new screenshots into `evidence/` (< 300 KB each).
- Effort: small
- Lesson candidate: When a PR decision changes visible text or layout, re-take every evidence screenshot that shows it in the same commit
- Decision: open

### R7: PRD FR-21, the plan's Goal/Design and the PR body still describe a repeaters-only "Nearest repeater" card
- Severity: minor
- Where: `context/prd.md:163-168`, `context/changes/nearest-repeater/plan.md:4-10,146,149`, `context/changes/nearest-repeater/pr-body.md:1-3`
- Problem: after 945f395 the code ranks room servers and the heading is "Nearest node", but FR-21 AC1 still requires a "Nearest repeater" card naming one repeater and AC5 says "no repeater"; the plan Goal and Design (`nearest.empty` "No repeater in the companion's contacts.", header "Nearest repeater") and the PR body title and summary say the same. The D-3 row is updated and the user made the decision, but no `[REVIEW]` deviation records that the PRD text is now overruled (lesson "log a PRD or roadmap conflict as a `[REVIEW]` deviation"), so the artifacts and the code disagree.
- Fix: update FR-21 (title "Nearest node", AC1/AC2/AC5 "repeater or room server", role shown) citing PR #19, or log a `[REVIEW]` deviation pointing at D-3; update the plan Goal/Design texts and regenerate the PR body.
- Effort: small
- Lesson candidate: no
- Decision: open

### R8: The nearest candidate became a link to the node screen without a request, deviation or test
- Severity: minor
- Where: `apps/mobile/src/components/nearest-repeater-card.tsx:79-83`
- Problem: 945f395 wraps the nearest `Candidate` in `<Link …><Pressable accessibilityRole="button">`. PR #19 asked only for room servers, the role line and the heading; D-6/D-9 give links only to "Other nearby" entries. The change is not logged under *Deviations*, and no flow taps it. It is harmless (same target as the Run diagnostic navigation), but it is unplanned behaviour the person did not see in the plan.
- Fix: log it as a `[minor]` deviation (and optionally tap the name in `nearest-positions.yaml` and assert the node screen), or remove the wrapper.
- Effort: small
- Lesson candidate: no
- Decision: open
