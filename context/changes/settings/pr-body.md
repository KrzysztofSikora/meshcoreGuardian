# feat(settings): preferences, about and data deletion on the Settings screen

Roadmap S-09 (FR-15). Settings now saves a timeout override (Auto or 5–60 s), attempts per check (1–3) and the export redaction default, and shows the app version and the connected companion's model, firmware and build date. Diagnostic runs and the Export screen use the saved values. "Delete history" (per node) and "Clear all data" remove runs, checks, samples, labels/roles and guest passwords after a confirmation. Covers FR-15 AC1–AC3, FR-14 AC3, FR-13 AC3 (default settings) and keeps FR-10 AC2 (60 s cooldown) intact after a deletion.
Closes #10

> **Status:** Ready for review

## ⚠ Needs your decision
- **D-1 (costly, persisted data shape):** settings stored as one versioned JSON blob under KV key `settings` (`{ version: 1, timeoutOverrideS, attempts, redactKeys }`, Zod strict) → chose **one blob in `expo-sqlite/kv-store`**. Alternatives: B: a `settings` table in a new migration 0005 (typed columns, part of "clear all"); C: one KV key per value. Switching costs: `settings.ts` + `platform/settings-store.ts`, plus a data migration for installed apps.
- **D-7 (costly, deletes data):** "Delete history" removes runs, checks, samples, label/role and guest password, but **keeps the `devices` row and `dashboard_pinned`** → check this matches FR-14 AC3 "deletes a node". Alternative B: delete the `devices` row (node vanishes from the Dashboard until the next sync, pinned chat contact lost). Switching costs: `data-eraser.ts` only.
- **D-8 (costly, deletes data):** one `DataEraser` port, one transaction per action, explicit child deletes (does not rely on `PRAGMA foreign_keys`). Alternatives: B: delete methods on each repository; C: delete the DB file. Switching costs: `packages/storage/src/data/data-eraser.ts`.
- **D-9:** "Clear all data" leaves settings, the airtime-notice flag and the remembered companion (the confirmation says so; plan review finding 7 asks you to confirm this). Alternative B: reset them too, "like a fresh install".
- **D-12:** deleting history does not lift the 60 s cooldown, including the disabled Run button (`RunState.lastRequestAt` + `cooldownMs`, used by both screens). Alternative B: let the reload of `latest` lift it (simpler, but a way around FR-10 AC2).
- **[FOLLOW-UP]** see Follow-ups: two known races/stale-UI cases left open.

Reply in a review comment, e.g. `D-7: take B`, `D-9: take B`, `drop the lessons commit`, then run `.claude/workflow/address-pr <PR number>`.

## Human checks
Run on a real phone with the CI APK (`android-apk` artifact), not over USB debugging.
- [ ] (Phase 3) Settings look in light and dark and at 200 % font size; nothing clipped, timeout field and buttons reachable — run: CI APK, open Settings — evidence: `context/changes/settings/evidence/settings.png` (emulator, light)
- [ ] (Phase 3) Connected to the real companion, About shows model, firmware and build date matching the Connect screen; timeout 10 s + attempts 1, run a diagnostic: details say "Waited 10.0 s (your setting)" and "up to 1 per check" — run: CI APK on a phone with a paired companion — evidence: none (emulator equivalent: `apps/mobile/e2e/settings-policy.yaml`)
- [ ] (Phase 4) Wording of both confirmations and of the note that settings are kept — run: CI APK, Settings → Delete history / Clear all data, read the dialogs — evidence: `context/changes/settings/evidence/settings-confirm.png` (emulator)
- [ ] (Phase 4) Delete one node's history, force-stop and reopen: its runs, label and guest password are gone, other nodes unchanged — run: CI APK on a phone with a paired companion — evidence: none (emulator equivalent: `apps/mobile/e2e/settings-delete.yaml`, screenshot `context/changes/settings/evidence/settings-data.png`)

## Other decisions made by the agent (cheap to change)
Full table: [plan.md#decisions](context/changes/settings/plan.md#decisions).
| ID | Question | Chosen | Alternatives |
|----|----------|--------|--------------|
| D-2 | Unreadable stored settings | Defaults plus a visible note until the next save | B: keep valid fields; C: delete silently |
| D-3 | Timeout input | Numeric text field, whole seconds 5–60, rejected with the range in the message | B: presets; C: decimals |
| D-4 | Attempts input | Segmented 1/2/3; schema still rejects others | B: text field |
| D-5 | When applied | Immediately on save; a run keeps the policy it started with | B: next app start |
| D-6 | Firmware info offline | "Connect a companion to see its firmware." | B: last known from stored runs |
| D-10 | Order of rows vs secret | Rows first, then secret; partial failure reported honestly | B: secret first |
| D-11 | Delete during run/sync | Refused (buttons disabled, `BUSY`) | B: allow |
| D-13 | Which nodes are listed | Nodes with stored runs, label or role | B: all nodes; C: button on Node screen |
| D-14 | Confirmation UI | Native `Alert.alert` | B: in-screen card |

## Quality
- Gates (review round 2): typecheck ok, lint ok, unit tests ok (86 files, 1530 tests), e2e ok (25/25 flows), mutation ok.
- Review: APPROVE, round 2 ([review.md](context/changes/settings/review.md)): R1 (major, a different deletion in flight got the other's result) fixed; R2 (attempts saved unvalidated), R3 (clear-all secret failure text), R4 (attempts range labelled as timeout) fixed. Deferred 0, rejected 0.
- Plan review: READY WITH NOTES ([plan-review.md](context/changes/settings/plan-review.md)); findings 1–6 handled in the plan or logged as deviations, finding 7 listed under D-9 above.
- Mutation ([mutation.md](context/changes/settings/mutation.md)): `settings.ts` 100 %, `settings-controller.ts` 97.8 → 100 %, `data-deletion.ts` 90.7 → 94.4 %, `data-eraser.ts` 100 %; `run-controller.ts` 96.1 % (9 survivors, all in pre-existing code, accepted). `bug` mutants: none.
- Proposed lessons: "When a single-flight guard shares an in-flight promise, share it only between calls for the same action and target" (commit `1177414 docs(settings): propose lessons`; drop it to reject).

## Follow-ups
- [FOLLOW-UP] A node screen that stays mounted under Settings keeps its label input text after "Delete history" and shows the old label until reopened. Sync the input from the node on change.
- [FOLLOW-UP] The reverse race (a run starting while a deletion runs) is not guarded; the Settings buttons are disabled only while a run or sync is active, and `DataDeletion` serialises deletions.
- Minor deviations (shared `Screen` now sets `keyboardShouldPersistTaps="handled"`, e2e navigation workarounds, `PlaceholderScreen` removed): [plan.md#deviations](context/changes/settings/plan.md#deviations).

## Commits
```
a7d9f45 docs(settings): triage review round 2
ac57e5d fix(settings): name the attempts field in an out-of-range message (R4)
8f6821f docs(settings): review
b60127f docs(settings): triage review round 1
1177414 docs(settings): propose lessons
ca5f2c9 fix(settings): clear-all secret failure names the right action (R3)
72688d2 fix(settings): validate attempts before saving (R2)
b064e6e fix(settings): share an in-flight deletion only with the same request (R1)
52b3092 docs(settings): review
02ea198 docs(settings): mutation
84e391c test(settings): strengthen assertions from mutation check
a706d05 feat(settings): delete node history and clear all data from Settings
14fc652 feat(settings): settings screen with preferences and about
85e5758 feat(settings): delete node history and clear all data
0253c8f feat(settings): settings model, store and policy wiring
4233141 docs(settings): pr-body
c5b9dc4 docs(settings): plan-review
2c277a5 docs(settings): plan
```

<details><summary>Run</summary>

Branch `change/settings`, base `main`. No failed step, no draft reason. Phases ticked 4/4. Plan review: READY WITH NOTES. Review: round 1 APPROVE WITH FOLLOW-UPS (3 open), round 2 APPROVE.

Steps in the final run (implement onward): implement ×4 ($0.49, $0.66, $0.96, $0.62), mutation $0.28, review round 1 $2.83, fix-review $0.28, review round 2 $0.91, fix-review $0.15. Total about $7.18 for these steps; the earlier plan and plan-review steps are not in this summary.
</details>
