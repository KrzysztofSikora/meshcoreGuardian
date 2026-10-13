# feat(nearest-repeater): Dashboard card naming the nearest node with Run diagnostic

Roadmap S-11. The Dashboard now opens with a "Nearest node" card: the repeater or room server (its role is shown) from the companion's contacts with the fewest known hops, then the shortest distance from the companion, then the most recently heard. It shows the last known path, advertised distance and 8-point compass direction, last heard time and a Run diagnostic button, plus up to 5 "Other nearby" candidates. Missing data reads as words ("Path unknown", "Position not advertised", "Companion position not set"), and every value is labelled "as of the last contact sync". It uses only contact-sync data and the companion's self info: no location permission, no extra radio request. Covers PRD FR-21 AC1–AC6 (as amended, see R7 below).
Closes #18

> **Status:** Ready for review

## ⚠ Needs your decision
- **D-1 (costly):** per-node storage shape → chose **migration `0003_nearest.sql` with nullable `devices.path_hops`, `adv_lat`, `adv_lon`, `path_companion_key`**. Alternatives: B: store the raw `out_path_len` byte (re-decodable without a resync if the `UNVERIFIED` encoding is wrong); C: a separate `node_paths` table. Switching costs: new migration (or edit of the unreleased `0003`), `packages/storage/src/sync/contacts.ts`, `node-repository.ts`, `mesh-client.ts` mapping, storage tests. A wrong decode today is fixed by one Sync contacts tap.
- **D-2 (costly):** where the companion's position lives → chose **new single-row table `contact_sync_origin`** (companion key, lat/lon, `synced_at`), written in the sync transaction. This table is not in the PRD data model. Alternatives: B: only the live session's position (no storage, but no distance at app start or while disconnected); C: a field in the last-companion key-value store (not atomic with the paths). Switching costs: the same migration, `SyncOrigin` port, controller and presenter.
- **[REVIEW] R7 (PRD overruled):** your PR #19 decision on D-3 (room servers are candidates, heading "Nearest node", role shown) overrules the repeaters-only wording of PRD FR-21 AC1/AC2/AC5. `context/prd.md` FR-21 was updated to match. Alternative: keep FR-21 as written and drop room servers. ([plan.md#deviations](plan.md#deviations))
- **[REVIEW] R2:** the plan-review-1 `syncedAt` filter was replaced by `path_companion_key`: the ranking keeps repeaters whose path came from the companion of the last sync, so a partial sync from the same companion no longer hides repeaters. Extends D-1 additively in the unreleased migration.
- **[minor] R8 (unrequested):** the nearest candidate is also a link to `/node/[id]` (like "Other nearby" entries); it was not asked at PR #19. Alternative: remove the `Link` wrapper in `apps/mobile/src/components/nearest-repeater-card.tsx`.
- **[FOLLOW-UP]** with a privacy angle: this change stores the companion's own position (usually the operator's home or site) and node positions in SQLite. Allowed today (local data only), but S-08 export must leave them out or redact them by default.

Reply in a review comment, e.g. `D-1: take B`, `D-2: take B`, `R8: remove the link`, `drop the lessons commit`, then run `.claude/workflow/address-pr <PR number>`.

## Human checks
- [ ] (Phase 4) Wording reads as "last known"/"advertised", nothing suggests live reachability, the card does not crowd the list. Run: open the screenshots (re-taken after PR #19, R6; they show the "Nearest node" heading and a ranked room server's role). Evidence: [with positions](evidence/nearest-with-positions.png), [without positions](evidence/nearest-without-positions.png), [empty](evidence/nearest-empty.png)
- [ ] (Phase 4) Real hardware with the CI APK (`android-apk` artifact, test-plan *Install a PR build*): connect, let the sync finish, compare the card's node, hop line and distance with the MeshCore app's contact details for the same node (`out_path_len` and positions are `UNVERIFIED`); note whether the companion position shows as set. Evidence: none yet

## Other decisions made by the agent (cheap to change)
| ID | Question | Chosen | Alternatives |
|----|----------|--------|--------------|
| D-3 | Which nodes are candidates (decided by you at PR #19) | in contacts and effective role repeater or room server (user override counts); role shown; heading "Nearest node" | repeaters only; reported role only |
| D-4 | Final tie-break | public key ascending; unknown last heard sorts last | display name |
| D-5 | Text when neither side has a position | "Companion position not set" | "Position not advertised" |
| D-6 | Run diagnostic on the card | `runButton` state; tap starts the run and opens `/node/[id]` (airtime notice, progress, Cancel) | render `RunPanel` inside the card |
| D-7 | Distance units | metric: 10 m under 1 km, one decimal under 10 km, whole km above | imperial (needs S-09) |
| D-8 | Compass words | full words ("north-east") | abbreviations |
| D-9 | "Other nearby" | collapsed toggle inside the card, entries link to the node | always expanded; separate screen |
| D-10 | Card placement | `FlatList` `ListHeaderComponent` | fixed view above the filters |
| D-11 | Mutation targets | `geo.ts` and `nearest.ts` added to test-plan and `stryker.targets` | leave the table alone |

## Quality
- Gates: typecheck ok, lint ok, unit tests ok, e2e ok (17/17), mutation `nearest.ts` ok (84.5 %; 13 survivors on lines 22/49/59, all equivalent) ([review.md](review.md))
- Review: APPROVE WITH FOLLOW-UPS, round 3 (0 open). Round 1: R1 blocker, R2 major, R3 minor, fixed. Round 2: R4, R5 minor, fixed. Round 3 (PR #19 change): R6 major (stale evidence / no room server in the scenario), R7, R8 minor, all fixed. Deferred 0, rejected 0.
- Mutation: 93.3 % → 93.6 % across four files ([mutation.md](mutation.md)); `geo.ts` 98.5 → 100 %, `nearest.ts` 82.3 → 83.5 %. `bug` mutants: none; survivors are equivalent or accepted older code in `mesh-client.ts` (none on a line this change touched).
- Plan review: READY WITH NOTES, 6 findings (1 major), all answered in *Review response* ([plan-review.md](plan-review.md)).
- Proposed lessons: "When a filter narrows data to the last operation, test a partial last operation from the same source", "When a change adds height above a shared list, grep every e2e flow …", "When a PR decision changes visible text or layout, re-take every evidence screenshot that shows it in the same commit". Drop commit `d8e5843 docs(nearest-repeater): propose lessons` and `c3df046` to reject them.

## Follow-ups
- **[FOLLOW-UP]** S-08 export: leave out or redact the companion position (`contact_sync_origin`) and node positions by default, and list them in the preview.
- Showing path and position on the node details screen is left to S-06.

## Commits
```
205e87a docs(nearest-repeater): triage review round 3
d8e5843 docs(nearest-repeater): propose lessons
cfca90b docs(nearest-repeater): align FR-21, plan and PR body with the PR #19 nearest-node decision (R7, R8)
c04c661 fix(nearest-repeater): show a ranked room server in the nearest scenario and re-take evidence (R6)
347f892 docs(nearest-repeater): review
945f395 feat(nearest-repeater): nearest node includes room servers and shows its role (PR #19 review)
d3189cc docs(nearest-repeater): pr-body
8e99302 docs(nearest-repeater): triage review round 2
63fe281 fix(nearest-repeater): label the card with the shown repeater's own sync time (R4)
97d4d2a docs(nearest-repeater): review
ab5ec91 docs(nearest-repeater): triage review round 1
c3df046 docs(nearest-repeater): propose lessons
d75247f fix(nearest-repeater): rank by the companion that gave the path, not the last sync time (R2)
78f2358 fix(nearest-repeater): stop the card clock while the Dashboard is unfocused (R3)
981e981 fix(nearest-repeater): scroll to the dashboard status in diag-responded (R1)
6b34080 docs(nearest-repeater): review
3a0fadf test(nearest-repeater): strengthen assertions from mutation check
16ab227 feat(nearest-repeater): fake nearest scenario and e2e flows with screenshots
7298b83 feat(nearest-repeater): show the nearest repeater card on the Dashboard
3ba6619 feat(nearest-repeater): decode, store and load contact paths, positions and sync origin
6519b9a feat(nearest-repeater): rank contact repeaters by hops, distance and last heard
44276a7 docs(nearest-repeater): plan-review
9ca59d1 docs(nearest-repeater): plan
```

<details><summary>Run</summary>

Branch `change/nearest-repeater`, base `main`. Initial run started 2026-10-12 21:03.

| Step | Result | Cost |
|------|--------|------|
| plan | success | $1.62 |
| plan-review | READY WITH NOTES | $0.73 |
| implement (4 phases) | success | $0.50, $0.78, $0.40, $0.63 |
| mutation | success | $0.34 |
| review round 1 | CHANGES REQUESTED (3 findings) | $3.01 |
| fix-review | success | $0.38 |
| review round 2 | APPROVE (2 minor findings) | $0.87 |
| fix-review | success | $0.14 |
| address-pr #19 (1 comment) | success | $0.39 |
| review round 3 | APPROVE WITH FOLLOW-UPS (3 findings) | $1.19 |
| fix-review | success | $0.30 |

Failed step: none. Draft reason: none. Phases ticked: 4/4. Emulator/Gradle processes left by sessions were stopped by the runner after implement phase 4, the reviews and address-pr.
</details>
