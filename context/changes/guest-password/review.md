# Review: guest-password

Verdict: APPROVE
Gates: typecheck ok, lint ok, unit tests ok (68 files, 1223 tests), e2e E2E_RESULT · Round: 2

Round 2 re-reviews the R1–R3 fixes and the PR #22 changes (`b8dd64f`, `51a284f`: admin-session
password drop, session role, `passwordSent`, D-13 to D-16).

## Plan vs diff
| File | Status | Note |
|------|--------|------|
| `packages/domain/src/secrets/secret-store.ts` | done | Three-call port, `null` = absent (D-1) |
| `packages/domain/src/nodes/guest-password.ts` + `.test.ts` | done | 15-byte UTF-8 limit, no trim; byte count by code point (logged `[minor]`) |
| `packages/domain/src/index.ts` | done | Exports port, validator, constant; plus `sessionRole`, `loginEvidence` (D-15) |
| `apps/mobile/src/application/nodes/guest-passwords.ts` | done | D-1, D-2, D-12; `discardAdminPassword` and `adminDiscarded` state (D-13) |
| `apps/mobile/src/application/nodes/guest-passwords.int.test.ts` | done | Planned cases plus discard/notice cases (D-13) |
| `apps/mobile/src/application/diagnostics/ports.ts` | done | Comment, plus `AdminPasswordHandler` port (D-13) |
| `apps/mobile/src/application/diagnostics/run-controller.ts` | done | `dropAdminPassword` after the checks, failure swallowed so the run is still stored (D-13) |
| `apps/mobile/src/application/diagnostics/run-controller.int.test.ts` | done | Frame bytes, failing store, *admin sessions* block (D-13, D-14) |
| `apps/mobile/src/platform/fake/in-memory.ts` | done | `InMemorySecretStore` |
| `apps/mobile/src/platform/secure-store.ts` | done | Thin wrapper |
| `apps/mobile/package.json`, `pnpm-lock.yaml` | done | `expo-secure-store ~57.0.4` |
| `apps/mobile/app.json` | done | Plugin entry (D-10, reworded: R3 fixed) |
| `apps/mobile/src/composition/index.ts` | done | `passwords`, password source and admin handler wired |
| `packages/storage/package.json` | done | `./testing` subpath (D-9) |
| `packages/storage/test/helpers/index.ts` | absent | Planned "if needed"; not needed |
| `eslint.config.mjs` | done | `forbid.nodeSqlite` restated in the mobile test-file block (R2 fixed) |
| `tooling/lint/layer-rules.test.ts` | done | `[mobileTestFile, "node:sqlite"]` rejected case added (R2) |
| `apps/mobile/src/application/nodes/guest-password-leak.int.test.ts` | done | File-backed DB and log scan; admin handler wired |
| `apps/mobile/src/app/node/[id].tsx` | done | Remove offered on `"error"` (R1 fixed); admin notice on the card, admin limitation on the run panel (D-13) |
| `apps/mobile/src/application/nodes/presenter.ts` + `.test.ts` | done | Status/error text, `adminDiscardedText` |
| `apps/mobile/src/i18n/en.json` | done | `password.*`, `password.admin.*`, `diagnostic.limitation.adminSession.*`, `diagnostic.evidence.login.role.*` |
| `apps/mobile/e2e/guest-password.yaml` | done | Moved to `diag-guest` (logged `[minor]`) |
| `context/test-plan.md` | done | TR-09, TR-21, mutation target, 20 flows |
| `context/changes/guest-password/evidence/*.png` | done | Card none/saved, light only (logged); no admin-notice shot (R5) |
| `packages/domain/src/diagnostics/session-role.ts` + `.test.ts` | unplanned | Not in a phase file list; covered by D-15 |
| `packages/domain/src/diagnostics/check.ts` | unplanned | Optional `passwordSent` (D-16) |
| `packages/storage/src/diagnostics/run-repository.ts` | unplanned | `passwordSent: z.boolean().optional()` (D-16, additive) |
| `packages/meshcore-adapter/src/client/mesh-client.ts` + adapter test | unplanned | `passwordSent: request.password !== ""` (D-16) |
| `packages/meshcore-adapter/src/transport/remote-script.ts` | unplanned | `loginSession` override for fake scripts (logged `[minor]`) |
| `apps/mobile/src/debug/scenarios.ts` | unplanned | `diag-guest` scenario (logged `[minor]`) |
| `apps/mobile/src/application/diagnostics/presenter.ts` + `.test.ts` | unplanned | Session role evidence and `adminSessionLimitation` (D-13, D-15) |
| `apps/mobile/src/application/diagnostics/no-write-path.test.ts` | unplanned | Pins the `MeshClient` command surface (D-14) |
| `apps/mobile/e2e/guest-password-admin.yaml` | unplanned | New flow (logged `[minor]`, 20 flows) |
| `docs/compatibility.md` | unplanned | Empty-password login is an ACL admin session; PR #22 runs (D-14, D-15) |
| `apps/mobile/tsconfig.json` | unplanned | `"types": ["node"]`, logged `[minor]` |
| `context/roadmap.md`, `context/lessons.md` | unplanned | Status bookkeeping; R2 lesson proposed |
| `context/changes/guest-password/{plan,plan-review,mutation,pr-body}.md` | unplanned | Workflow artifacts |

## Areas
| Area | Result | One-line reason |
|------|--------|-----------------|
| Correctness | concern | R1–R3 fixed; the admin drop removes whatever is stored when the run ends, not the password that was sent (R4) |
| Design | ok | Role mapping in domain, drop decision in the controller behind a port, key logic still only in `guest-passwords.ts` |
| Safety | ok | Password never in state, errors, logs or SQLite; `passwordSent` stores only a boolean; no write command added |
| Tests | ok | Behavioural, cover guest/admin/ACL/failing-removal paths; reviewer re-ran mutation: new lines in `guest-passwords.ts` and `run-controller.ts` all killed |
| Simplicity | ok | Small functions; `adminSessionLimitation` reused by run details and the node panel |
| Plan fidelity | concern | PR #22 records are in *Decisions* and *Deviations*, but `mutation.md` and `evidence/` were not refreshed (R5) |
| Agent decisions | ok | D-16 (costly) is one optional field, read in one presenter function; D-13 is user-decided and lives in one controller method plus one service method |

## Findings
### R1: Remove password is hidden when the stored status cannot be read
- Severity: minor
- Where: `apps/mobile/src/app/node/[id].tsx:216`
- Problem: D-7 says that when loading the card status fails, "Save/Remove still offered". The card rendered Remove only for `saved === "yes"`.
- Fix: render Remove when `saved === "yes" || saved === "error"`.
- Effort: small
- Lesson candidate: no
- Decision: fixed (60a6010)

Round 2: verified. `[id].tsx` now renders Remove for `"yes" || "error"`.

### R2: Mobile test-file lint block allows `node:sqlite`, and the deviation says it restates the full list
- Severity: minor
- Where: `eslint.config.mjs:98-107`
- Problem: the `apps/mobile/**/*.test.ts` block replaced the earlier options and dropped `forbid.nodeSqlite`.
- Fix: add `forbid.nodeSqlite` to the block and a rejected layer-rules case.
- Effort: small
- Lesson candidate: When a flat-config block narrows a restricted-imports rule, restate every entry of the broader block and add a layer-rules case for each one.
- Decision: fixed (e0c617f) + lesson proposed

Round 2: verified. The block lists `forbid.nodeSqlite`, `layer-rules.test.ts` has `[mobileTestFile, "node:sqlite"]`, and lint passes.

### R3: D-10 still gives the pre-review reason, although *Review response* says it was reworded
- Severity: minor
- Where: `context/changes/guest-password/plan.md:74`
- Problem: the D-10 row was unchanged after plan-review 6.
- Fix: reword D-10 as an explicit default.
- Effort: small
- Lesson candidate: no
- Decision: fixed (see triage commit; plan.md D-10 reworded)

Round 2: verified. D-10 now reads "explicit default", and alternative B says the behaviour is the same.

### R4: The admin-session drop deletes the password stored when the run ends, not the one that was sent
- Severity: minor
- Where: `apps/mobile/src/application/diagnostics/run-controller.ts:211-222`, `apps/mobile/src/application/nodes/guest-passwords.ts` (`discardAdminPassword`)
- Problem: `execute` reads the password at run start. `dropAdminPassword` runs after the checks and calls `ports.adminPassword(publicKey)` → `discardAdminPassword(publicKey)` → `remove(publicKey)`, with no link to the value that was sent. The password card stays editable while a run is active (`GuestPasswordCard` has no `running` gate). Scenario: the user saves the admin password and taps Run. During the login/status/telemetry wait (seconds to tens of seconds) the user notices and saves the guest password. `save` clears the admin notice and stores the guest value. The run then ends with an admin session, and the guest password is deleted. The card says "The last password you saved gives administrator rights", which is false for the password it just removed. This is the pattern of the run-diagnostic lesson: capture the context a stored record needs when the operation starts, never read it from live state after an await.
- Fix: pass what was sent to the handler, e.g. `AdminPasswordHandler = (publicKey, sentPassword) => Promise<void>`. `discardAdminPassword(publicKey, sent)` reads the stored value inside the serial chain and removes it and sets the notice only when the value still equals `sent`. Add a controller test that saves a different password while the run is in flight (the fake script awaits timers) and asserts that the new password survives.
- Effort: small
- Lesson candidate: no (covered by the run-diagnostic R1 lesson)
- Decision: open

### R5: PR #22 code changes are not reflected in `mutation.md` or in `evidence/`
- Severity: minor
- Where: `context/changes/guest-password/mutation.md`, `context/changes/guest-password/evidence/`
- Problem: `b8dd64f` changed three test-plan mutation targets (`guest-passwords.ts`, `run-controller.ts`, `mesh-client.ts`) after the mutation record was written. `mutation.md` still says the `run-controller.ts` changes "were already covered" and lists the survivor at `guest-passwords.ts:103` (now line 126). The reviewer re-ran `pnpm mutation` on `guest-passwords.ts` (87 killed, 1 survived: the accepted error-message literal) and `run-controller.ts` (211 killed, 7 survivors, all on lines this change did not touch, so no gap). The record is stale, but the tests are not weak. Separately, the new user-visible text (admin notice on the card, admin-session limitation, "Session role: …") has no screenshot in `evidence/`. `guest-password-admin.yaml` already takes `guest-password-admin`, but that file was not copied in. The PR reviewer therefore sees this wording only through the hardware human check.
- Fix: add a "PR #22 re-run" line to `mutation.md` with the scores above and the moved line number. Copy the `guest-password-admin` screenshot (under 300 KB) into `evidence/` and reference it from the PR #22 human check.
- Effort: small
- Lesson candidate: no (covered by the proposed nearest-repeater R6 and connect-companion R5 lessons)
- Decision: open
