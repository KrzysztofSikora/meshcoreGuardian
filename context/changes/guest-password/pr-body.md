# feat(guest-password): store a per-node guest password in secure storage and use it in the diagnostic login

Roadmap S-05. The node details screen has a Guest password card: the user can save a password for a node (Keystore-backed expo-secure-store only) and remove it. A diagnostic run reads the stored password and sends it in the guest login; with none stored it sends an empty one (open guest login). `GuestPasswords.remove` / `clearAll` leave no secret behind, ready for S-09. A leak test scans the SQLite files and console output for a canary password. After the PR #22 review, a login that opens an **administrator** session makes the app drop the stored password, and the run shows a "Session role" instead of "Permissions". Covers FR-14 AC1, AC2, AC3 (use-case level only, see below) and FR-05 AC2.
Closes #6

> **Status:** Ready for review

## ⚠ Needs your decision
- **[REVIEW] FR-14 AC3 / roadmap S-05:** the roadmap says "deleting a node or clearing data deletes its secret", but neither a node delete nor "clear all data" exists before S-09. S-05 proves AC3 at the use-case level (`GuestPasswords.remove` / `clearAll`); S-09 wires it into its flows ([D-3](context/changes/guest-password/plan.md#decisions)). Alternative: build both deletion features here.
- **[REVIEW] Roadmap S-05 acceptance "a test scans the SQLite file and export output":** there is no export until S-08. S-05 scans the SQLite files and the log output; the export scan stays with S-08 (FR-13 AC4, D-8).
- **D-1 (costly):** port and key scheme in secure storage → chose **generic `SecretStore { get, set, delete }` with keys `guest-password.<publicKey>`**. Alternatives: B: port shaped around passwords (`getPassword(publicKey)`), so every implementation carries the key scheme; C: hash the public key in the key (hides nothing). Switching costs: persisted key format, so a migration of stored secrets.
- **D-2 (costly):** how "clear all" finds every secret (expo-secure-store cannot list keys) → chose **an index entry `guest-password.index` (JSON array of public keys) in the same store**. Alternatives: B: no index, `clearAll(publicKeys)` from `NodeRepository.listAll()` (misses secrets if the row is gone first); C: index in SQLite/KV (splits one invariant over two stores). Switching costs: persisted shape, `guest-passwords.ts` and its tests.
- **D-16 (costly):** how a run knows a password was sent → chose **optional `passwordSent: boolean` in the login evidence** (additive in the stored JSON). Alternative: B: infer it from the password store at render time (wrong after the password is removed). Switching costs: persisted run shape, one presenter function.
- **D-13 (costly, decided by you on PR #22):** a login with a stored password that returns an admin session → the app removes the stored password and tells the user on the card and on the run; the run stays `RESPONDED` with a limitation. Alternative: B: keep the password and only warn (leaves an admin credential in the app, against the PRD out of scope). Switching costs: `run-controller.ts`, `guest-passwords.ts`, tests.
- **Human checks below** cover the UNVERIFIED 15-byte limit, the login behaviour and the admin-session wording on real hardware (PRD §8). The wrong-password "Login rejected" check is still pending.

Reply in a review comment, e.g. `D-2: take B`, `drop the lessons commit`, then run `.claude/workflow/address-pr <PR number>`.

## Human checks
- [ ] (Phase 2) Real hardware, Room K, guest password: save the real password, Run diagnostic, login step responded; then save a deliberately wrong password, wait for the cooldown, run, expect "Login rejected"; then Remove password. Confirms the 15-byte limit (D-4) and the UNVERIFIED login behaviour. Run: install the CI APK (`android-apk` artifact), connect the companion, open Room K. Evidence: the run details screen (none yet).
- [ ] (PR #22) Real hardware, CI APK: save the node's admin password as the guest password, run: expect "Responded", "Session role: administrator", the limitation text, and the password card saying the password was removed (Remove password gone). Then save the guest password, run: expect "Session role: guest" and the password kept. Emulator reference: [guest-password-admin](context/changes/guest-password/evidence/guest-password-admin.png).
- [ ] (Phase 2) Card wording and look in light and dark: status reads clearly, the stored password is never shown, Remove appears only when a password is saved. Run: open any node on the CI APK or the emulator build, toggle the theme. Evidence: [saved](context/changes/guest-password/evidence/guest-password-saved.png), [none](context/changes/guest-password/evidence/guest-password-none.png) (light theme only; dark not captured).

## Other decisions made by the agent (cheap to change)
Full table with reasons: [plan.md#decisions](context/changes/guest-password/plan.md#decisions).

| ID | Question | Chosen | Alternatives |
|----|----------|--------|--------------|
| D-4 | Password validation | Kept as typed (no trim); empty → `EMPTY`; more than 15 UTF-8 bytes → `TOO_LONG` | 15 characters (multi-byte input cut by firmware); no limit |
| D-5 | Card behaviour | Field empty, `secureTextEntry`, never pre-filled, cleared after save; status in words; Remove only when saved | "empty save removes"; eye toggle (needs a read path into the UI) |
| D-6 | Secret store in e2e builds | Real `ExpoSecretStore` in both modes; in-memory only in Vitest | in-memory in fake mode |
| D-7 | Secure storage fails | Run at start: `NOT_TESTED` / `UNEXPECTED_ERROR`, nothing sent; card shows alert text | run with an empty password |
| D-8 | Export scan before S-08 | SQLite files and log only (see `[REVIEW]` above) | throwaway export stub |
| D-9 | File-backed SQLite in mobile tests | Test-only `@guardian/storage/testing` export, lint-restricted to test files | relative cross-package import; test in `packages/storage` |
| D-10 | Android backup | Explicit `configureAndroidBackup: true` plugin entry (the default) | no entry |
| D-11 | e2e coverage | New flow `guest-password.yaml` | append to `contacts-label-restart.yaml` |
| D-12 | Concurrent save/remove | Secure-store operations run one at a time (promise chain) | no serialisation |
| D-14 | Admin session without any password (ACL admits the companion key) | Cannot be prevented, so shown as role "administrator" plus a limitation; no logout (not in the pinned codec, unverified); `no-write-path.test.ts` pins the command surface (decided by you on PR #22) | send a logout after the run |
| D-15 | Label for the login reply | "Session role: guest / read-only / read-write / administrator / unknown" from `aclPermissions`; mapping `UNVERIFIED` except ACL 3 = admin (decided by you on PR #22) | keep "Permissions: n" |

## Quality
- Gates: typecheck ok, lint ok, unit tests ok (68 files, 1223 tests), e2e ok (20 flows)
- Review: APPROVE, round 2: fixed 5 (R1 Remove offered when status unreadable, R2 `node:sqlite` forbidden in mobile test files, R3 D-10 wording, R4 admin drop removes the password that was sent, R5 `mutation.md` and evidence refreshed), deferred 0, rejected 0
- Mutation: 96.2% → 98.8% (99.07% after the PR #22 re-run); `bug` mutants: none. One accepted survivor: an internal error-message literal in `guest-passwords.ts`
- Proposed lessons: restate every entry of the broader block when a flat-config block narrows a restricted-imports rule (commit `73d0a9f`; drop it to reject)

## Follow-ups
- **[FOLLOW-UP]** S-09: its delete-node-history and clear-all-data flows must call `container.passwords.remove(publicKey)` / `clearAll()` and test that the `SecretStore` is empty afterwards (TR-21).
- **[FOLLOW-UP]** The wrong-password "Login rejected" human check is still pending (PR #22).
- Minor deviations (all in [plan.md#deviations](context/changes/guest-password/plan.md#deviations)): the card sits at the bottom of the node screen, not below the role card (added height broke `contacts-sync`); only light-theme screenshots; `diag-guest` scenario and `guest-password-admin.yaml` added.

## Commits
```
1eb6021 docs(guest-password): triage review round 2
cbc5f15 fix(guest-password): drop the admin password that was sent, not whatever is stored (R4)
d255de0 docs(guest-password): review
51a284f docs(guest-password): record admin-session decisions D-13 to D-16, compatibility evidence and human check (PR #22 review)
b8dd64f fix(guest-password): drop a stored password that opens an admin session and show the session role (PR #22 review)
d8b63b3 docs(guest-password): pr-body
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

Latest run: address-pr #22 (1 new comment), branch `change/guest-password`.

- address-pr (sonnet, attempt 1): $1.18, success
- review (opus, attempt 1): $1.03, success; round 2: APPROVE, 2 open findings
- fix-review (sonnet, attempt 1): $0.28, success
- Failed step: none. Draft reason: none. Plan review: READY WITH NOTES. Review: APPROVE (0 open findings). Phases ticked: 2/2.
</details>
