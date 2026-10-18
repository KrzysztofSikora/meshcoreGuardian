# Review: settings

Verdict: APPROVE
Gates: typecheck ok, lint ok, unit tests ok (86 files, 1530 tests), e2e ok (25/25 flows), mutation (from mutation.md) ok · Round: 2

Round 2 re-checked R1-R3 against b064e6e, 72688d2 and ca5f2c9: all three are fixed, each with a test. One new minor finding (R4) comes from the R2 fix.

## Plan vs diff
| File | Status | Note |
|------|--------|------|
| `apps/mobile/src/application/settings/settings.ts` (+ test) | done | Zod strict schema, bounds derived from domain ranges, `parseTimeoutInput`, `toPolicy` |
| `apps/mobile/src/application/settings/ports.ts` | done | `SettingsStore`, `DeletionPorts` |
| `apps/mobile/src/application/settings/settings-controller.ts` (+ int test) | done | memoised load, serial writes, state only after write; whole value validated before write (R2 fixed) |
| `apps/mobile/src/platform/settings-store.ts` | done | KV key `settings` (D-1) |
| `apps/mobile/src/platform/fake/in-memory.ts` | done | `InMemorySettingsStore`, logged as [minor] deviation |
| `apps/mobile/src/composition/index.ts` | done | settings, deletion wired; controllers hoisted to consts so `DataDeletion` can refer to them |
| `apps/mobile/src/app/_layout.tsx` | done | `settings.load()` at mount |
| `apps/mobile/src/application/diagnostics/run-controller.ts` (+ int test) | done | policy read once (logged deviation), `lastRequestAt`, `cooldownMs`, `busy()`, `refreshLatest()` |
| `packages/domain/src/data/eraser.ts`, `packages/domain/src/index.ts` | done | `DataEraser` port |
| `packages/storage/src/data/data-eraser.ts`, `index.ts`, `test/data-eraser.int.test.ts` | done | explicit child deletes, one transaction, rollback test |
| `apps/mobile/src/application/settings/data-deletion.ts` (+ int test) | done | single-flight keyed by action and target, a different request gets BUSY (R1 fixed) |
| `apps/mobile/src/application/nodes/nodes-controller.ts` | done | `reload()` public |
| `apps/mobile/src/application/nodes/node-history.ts` (+ int test) | done | `forget()` |
| `apps/mobile/src/application/settings/presenter.ts` (+ test) | done | settings, data and deletion views; clear-all SECRET_ERROR has its own text (R3 fixed); OUT_OF_RANGE always shown as a timeout message (R4) |
| `apps/mobile/src/app/settings.tsx` | done | four cards, `Alert.alert` confirmations; Data buttons disabled while a deletion runs (R1 fixed) |
| `apps/mobile/src/i18n/en.json`, `i18n/catalog.test.ts` | done | placeholder key removed |
| `apps/mobile/src/components/placeholder-screen.tsx` | done | removed, no other user (logged) |
| `apps/mobile/e2e/settings.yaml`, `settings-policy.yaml`, `settings-delete.yaml`, `lib/look-screens.yaml` | done | look flow asserts "Timeout: Auto" now |
| `context/test-plan.md`, `stryker.targets` | done | TR-20/TR-21 covered, four targets added |
| `apps/mobile/src/app/node/[id].tsx`, `components/nearest-repeater-card.tsx` | done | use `cooldownMs` (D-12, plan-review finding 1, logged) |
| `apps/mobile/src/components/ui/screen.tsx` | unplanned | `keyboardShouldPersistTaps="handled"`, logged as [minor] deviation |
| `context/roadmap.md` | unplanned | status bookkeeping |
| `context/lessons.md` | unplanned | lesson proposed from R1 (review bookkeeping) |
| `context/changes/settings/evidence/*.png` | done | three screenshots, each under 300 KB |

## Areas
| Area | Result | One-line reason |
|------|--------|-----------------|
| Correctness | ok | R1-R3 fixed; a different deletion in flight now gets BUSY, verified by a test on the real eraser |
| Design | ok | layering respected: domain port, storage implementation, application use-case, screen via presenter |
| Safety | ok | deletion status honest after R1; no secrets in code or logs |
| Tests | ok | behaviour-level tests on real SQLite and real `GuestPasswords`; failure paths covered; mutation decisions plausible |
| Simplicity | concern | `save()` labels every invalid value with the attempts range, and the presenter calls it a timeout (R4, minor) |
| Plan fidelity | ok | every deviation logged; follow-ups recorded |
| Agent decisions | ok | D-1 (stored shape) lives in `settings.ts` + `settings-store.ts`; D-7/D-8 (deletion) in `data-eraser.ts` only; both swappable as claimed |

## Findings
### R1: A deletion started while another is in flight returns the other action's result
- Severity: major
- Where: `apps/mobile/src/application/settings/data-deletion.ts:47`, `apps/mobile/src/app/settings.tsx:213`
- Problem: `once()` returns `this.inFlight` for any second call, whatever the action. The Settings buttons are disabled only for a run or sync (`busy`), not while a deletion is running, so "Clear all data" confirmed while a "Delete history" is still running (Keystore deletes on a real phone are not instant) gets the node deletion's `{ ok: true }`, and the screen shows "All data cleared." Verified with a throwaway test on the real eraser and `GuestPasswords`: `Promise.all([deleteNodeHistory(A), clearAll()])` → both `{ ok: true }`, yet 2 devices, 1 run and B's guest password remain. That breaks honest status for a privacy action (FR-15 AC2, FR-14 AC3). The existing test only shares the promise between two `clearAll()` calls.
- Fix: share the in-flight promise only for the same action (key it by `"all"` / publicKey) and return `BUSY` for a different one; also disable the Data buttons while a deletion is in flight (a `deleting` flag in the screen or a small store on `DataDeletion`). Add a test for `deleteNodeHistory(A)` + `clearAll()` concurrently.
- Effort: small
- Lesson candidate: When a single-flight guard shares an in-flight promise, share it only between calls for the same action and target; a different request gets its own answer
- Decision: fixed (b064e6e) + lesson proposed

### R2: `SettingsController.setAttempts` saves out-of-range values
- Severity: minor
- Where: `apps/mobile/src/application/settings/settings-controller.ts:71`
- Problem: `setAttempts` writes any number without validation; only the read path checks the schema. Verified: `setAttempts(4)` returns `{ ok: true }`, `policy()` yields `attempts: 4` (the mesh client's `assertAttempts` would then throw, so a run ends as an unexpected error), and the next start reads the blob as unreadable and drops *all* saved settings to defaults (D-2). The UI's `Segmented` only offers 1–3, so no user path reaches it today, but TR-20 ("settings accept out-of-range values") is marked covered while the write path accepts them.
- Fix: validate `next` with the same schema in `save()` (e.g. a `validateSettings` export from `settings.ts`) and return `OUT_OF_RANGE` for attempts too; add 0/4 cases to `settings-controller.int.test.ts`.
- Effort: small
- Lesson candidate: no
- Decision: fixed (72688d2)

### R3: "Clear all data" with a secret failure says "History deleted, but the guest password could not be removed"
- Severity: minor
- Where: `apps/mobile/src/application/settings/presenter.ts:104`, `apps/mobile/src/i18n/en.json` (`settings.deleteSecretError`)
- Problem: `deletionMessage` ignores `scope` for `SECRET_ERROR`, so after a clear-all whose rows were removed but whose passwords were not, the person reads a single-node, singular message. The status is honest in substance but names the wrong action and count.
- Fix: add `settings.clearSecretError` ("All data cleared, but the guest passwords could not be removed. Try again.") and pick it when `scope === "all"`; add a presenter test.
- Effort: small
- Lesson candidate: no
- Decision: fixed (ca5f2c9)

### R4: An out-of-range attempts value is reported as a timeout error in seconds
- Severity: minor
- Where: `apps/mobile/src/application/settings/settings-controller.ts:93`, `apps/mobile/src/application/settings/presenter.ts:62`
- Problem: the R2 fix returns `{ reason: "OUT_OF_RANGE", range: ATTEMPTS_RANGE }` for any invalid value in `save()`, and `saveProblem` maps every `OUT_OF_RANGE` to `settings.timeoutRange`. So `setAttempts(4)` would show "Enter whole seconds from 1 to 3." under the timeout field. The Segmented control offers only 1-3, so no user path reaches it today; it is a latent mislabel, and the `SaveResult` cannot say which field was out of range.
- Fix: add the field to the result (`field: "timeout" | "attempts"`) and let `saveProblem` choose the message, or make `setAttempts` check `ATTEMPTS_RANGE` itself and keep `save()`'s check as an internal guard. Add a presenter test for the attempts case.
- Effort: small
- Lesson candidate: no
- Decision: open
