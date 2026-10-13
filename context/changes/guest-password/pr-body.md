# feat(guest-password): store a per-node guest password in secure storage and use it in the diagnostic login

Roadmap S-05. The node details screen has a Guest password card: the user can save a password for a node (Keystore-backed expo-secure-store only) and remove it. A diagnostic run reads the stored password and sends it in the guest login; with none stored it sends an empty one (open guest login). `GuestPasswords.remove` / `clearAll` leave no secret behind, ready for S-09. A leak test scans the SQLite files and console output for a canary password. Covers FR-14 AC1, AC2, AC3 (use-case level only, see below) and FR-05 AC2.
Closes #6

> **Status:** Ready for review

## ⚠ Needs your decision
- **[REVIEW] FR-14 AC3 / roadmap S-05:** the roadmap says "deleting a node or clearing data deletes its secret", but neither a node delete nor "clear all data" exists before S-09. S-05 proves AC3 at the use-case level (`GuestPasswords.remove` / `clearAll`); S-09 wires it into its flows (D-3). Alternative: build both deletion features here.
- **[REVIEW] Roadmap S-05 acceptance "a test scans the SQLite file and export output":** there is no export until S-08. S-05 scans the SQLite files and the log output; the export scan stays with S-08 (FR-13 AC4, D-8).
- **D-1 (costly):** port and key scheme in secure storage → chose **generic `SecretStore { get, set, delete }` with keys `guest-password.<publicKey>`**. Alternatives: B: port shaped around passwords (`getPassword(publicKey)`), so every implementation carries the key scheme; C: hash the public key in the key (hides nothing). Switching costs: persisted key format, so a migration of stored secrets.
- **D-2 (costly):** how "clear all" finds every secret (expo-secure-store cannot list keys) → chose **an index entry `guest-password.index` (JSON array of public keys) in the same store**. Alternatives: B: no index, `clearAll(publicKeys)` from `NodeRepository.listAll()` (misses secrets if the row is gone first); C: index in SQLite/KV (splits one invariant over two stores). Switching costs: persisted shape, `guest-passwords.ts` and its tests.
- **Human checks below** cover the UNVERIFIED 15-byte limit and the login behaviour on real hardware (PRD §8).

Reply in a review comment, e.g. `D-2: take B`, `drop the lessons commit`, then run `.claude/workflow/address-pr <PR number>`.

## Human checks
- [ ] (Phase 2) Real hardware, Room K, guest password: save the real password, Run diagnostic, login step responded; then save a deliberately wrong password, wait for the cooldown, run, expect "Login rejected"; then Remove password. Confirms the 15-byte limit (D-4) and the UNVERIFIED login behaviour. Run: install the CI APK (`android-apk` artifact), connect the companion, open Room K. Evidence: the run details screen (none yet).
- [ ] (PR #22) Real hardware, CI APK: save the node's admin password as the guest password, run: expect "Responded", "Session role: administrator", the limitation, and the password card saying the password was removed. Then save the guest password, run: expect "Session role: guest" and the password kept. The wrong-password "Login rejected" check above is still pending.
- [ ] (Phase 2) Card wording and look in light and dark: status reads clearly, the stored password is never shown, Remove appears only when a password is saved. Run: open any node on the CI APK or the emulator build, toggle the theme. Evidence: [saved](evidence/guest-password-saved.png), [none](evidence/guest-password-none.png) (light theme only; dark not captured).

## Other decisions made by the agent (cheap to change)
Full text with reasons: [plan.md#decisions](plan.md#decisions).

| ID | Question | Chosen | Alternatives |
|----|----------|--------|--------------|
| D-3 | FR-14 AC3 before delete/clear features exist | `remove` / `clearAll` in S-05, S-09 calls them (see REVIEW above) | B: build delete and clear now; C: move AC3 to S-09 |
| D-4 | Password validation | Domain `validateGuestPassword`: no trim, empty → `EMPTY`, over 15 UTF-8 bytes → `TOO_LONG` | B: 15 characters; C: no limit |
| D-5 | Card behaviour and wording | Empty `secureTextEntry` field, never pre-filled, cleared after save; Save disabled when empty; Remove only when saved; status in words | B: empty save removes; C: eye toggle showing the password |
| D-6 | Secret store in fake (e2e) builds | Real `ExpoSecretStore` in both modes; in-memory only in Vitest | B: in-memory in fake mode |
| D-7 | Secure storage fails | Run: `NOT_TESTED` / `UNEXPECTED_ERROR`, nothing sent; card: alert texts, Save/Remove still offered | B: run with an empty password on read failure |
| D-8 | Export scan when no export exists | SQLite files + console scan now, export scan in S-08 (see REVIEW above) | B: throwaway export stub |
| D-9 | File-backed SQLite in a mobile test | Test-only subpath `@guardian/storage/testing`, lint-restricted to test files | B: relative cross-package import; C: leak test in `packages/storage` |
| D-10 | Android backup of secure-store data | Plugin `expo-secure-store` with `configureAndroidBackup: true` as an explicit default | B: no plugin entry (same behaviour) |
| D-11 | e2e coverage | New flow `guest-password.yaml` (19 flows) | B: append to `contacts-label-restart.yaml` |
| D-12 | Concurrent save/remove on the index | Serial promise chain inside `GuestPasswords` | B: no serialisation |

## Quality
- Gates: typecheck ok, lint ok, unit tests ok (66 files, 1204 tests), e2e ok (19/19 flows) ([review.md](review.md))
- Review: APPROVE, round 1: fixed 2 (R1 Remove hidden after a failed status read; R2 mobile test-file lint block lost the `node:sqlite` ban), plan record corrected 1 (R3 D-10 wording), deferred 0, rejected 0. See [review.md](review.md). Plan review: READY WITH NOTES ([plan-review.md](plan-review.md)), all 7 notes handled (see *Review response* in the plan).
- Mutation: 96.2% → 98.8% (guest-passwords.ts 96.2 → 98.7, guest-password.ts 87.5 → 100); `bug` mutants: none; 1 survivor accepted (internal error message wording) ([mutation.md](mutation.md))
- Proposed lessons: "When a flat-config block narrows a restricted-imports rule, restate every entry of the broader block and add a layer-rules case for each one" (commit `73d0a9f docs(guest-password): propose lessons`; drop that commit to reject)

## Follow-ups
- **[FOLLOW-UP]** S-09: its delete-node-history and clear-all-data flows must call `container.passwords.remove(publicKey)` / `clearAll()` and test that the `SecretStore` is empty afterwards (TR-21).
- Minor deviations (see [plan.md#deviations](plan.md#deviations)): Guest password card sits at the bottom of the node screen, after "Add to dashboard", not below the role card (added height broke `contacts-sync`); domain counts UTF-8 bytes by code point (no `TextEncoder` type); `apps/mobile/tsconfig.json` gained `"types": ["node"]`; e2e runs the diagnostic before the restart and checks only persistence after it; only light-theme screenshots.

## Commits
```
6ee9ba1 docs(guest-password): triage review round 1
73d0a9f docs(guest-password): propose lessons
e0c617f fix(guest-password): keep node:sqlite forbidden in mobile test files (R2)
60a6010 fix(guest-password): offer Remove when the stored status cannot be read (R1)
d5f7454 docs(guest-password): review
5db5db2 docs(guest-password): mutation
f9f5e26 test(guest-password): strengthen assertions from mutation check
a76d296 feat(guest-password): add the guest password card with e2e flow and docs
737391c feat(guest-password): store guest passwords in secure storage and send them in the run login
c070a33 docs(guest-password): plan-review
2077a6b docs(guest-password): plan
```

<details><summary>Run</summary>

Branch change/guest-password, base main. No failed step, no draft reason.

| Step | Model | Cost | Result |
|------|-------|------|--------|
| plan | opus | $1.44 | success |
| plan-review | opus | $0.68 | READY WITH NOTES |
| implement (phase 1) | sonnet | $0.57 | success |
| implement (phase 2) | sonnet | $0.57 | success |
| mutation | sonnet | $0.27 | success |
| review | opus | $1.33 | APPROVE |
| fix-review | sonnet | $0.16 | success |

Phases ticked: 2/2. The runner stopped leftover emulator/Gradle processes after implement and review.
</details>
