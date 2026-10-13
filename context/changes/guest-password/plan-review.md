# Plan review: guest-password

Verdict: READY WITH NOTES

| # | Severity | Check | Finding | Suggested change |
|---|----------|-------|---------|------------------|
| 1 | major | Grounding / Design (D-9) | The plan says "a lint `no-restricted-imports` entry forbids it outside `*.test.ts`". But `apps/mobile/**` already forbids every deep import, `^@guardian/[^/]+/.+` (`eslint.config.mjs:17-19`, `:96`), so `@guardian/storage/testing` is already blocked in the mobile test files too, and the leak test fails `pnpm lint` as planned. Flat config replaces the options of earlier blocks (`eslint.config.mjs:11-12`), so a narrower block has to restate the full list. | Rewrite D-9: add a block for `apps/mobile/**/*.test.ts` with `[deepImport-except-/testing, meshcoreJs, nodeSqlite]` that allows only `@guardian/storage/testing`, and keep the general deep-import ban for app code. Add the two cases (test file allowed, app file rejected) to `tooling/lint/layer-rules.test.ts`. |
| 2 | major | Failure paths / test validity | Leak test: "Close the DB, then read `path`, `path-wal`, `path-shm` (those that exist)". `TestDb.close()` closes the DB and also deletes the temp dir (`packages/storage/test/helpers/open-test-db.ts:41-45`), so nothing would exist and the test would pass without scanning anything. | Close with `testDb.db.close()`, scan the files, and only then call `testDb.close()`. Assert that the main DB file exists and holds the synced node's public key, so the scan is known to cover real data. |
| 3 | minor | Phasing / e2e (D-11) | After `stopApp`/`launchApp`, the app has lost both the connection and the debug scenario. The shared `lib/connect-diag.yaml` starts with `launchApp: clearState: true` (`apps/mobile/e2e/lib/connect-diag.yaml:5-6`), which would wipe the saved secret. | In the flow, reconnect inline after the restart (open the scenario link, scan, connect, without clearState), or run the diagnostic before the restart and check only persistence after it. |
| 4 | minor | Traceability | Phase 2 claims "FR-05 AC2 end to end with a saved password (e2e)". `FakeTransport` matches writes by command code only (`packages/meshcore-adapter/src/transport/fake-transport.ts:101`), so "Responded" looks the same with an empty password. | Make the integration frame-bytes test the proof of FR-05 AC2, and describe the e2e step as a smoke check that a run still works with a password saved. |
| 5 | minor | Design (D-12) | With a single promise chain, one rejected operation can poison every later one unless each link catches its error. No test covers this. | In Phase 1, add a test where a failing `set` is followed by a successful `save`, and `password` reads the stored value. |
| 6 | minor | Grounding (D-10) | `configureAndroidBackup` already defaults to `true` (docs.expo.dev/versions/latest/sdk/securestore, *Configurable properties*), so the plugin entry only makes the default explicit. Its purpose is to exclude SecureStore prefs from auto-backup, because restored values cannot be decrypted. | Keep the line but change the reason to "explicit default". Alternative B is then not a real alternative. |
| 7 | minor | Failure paths (D-2) | The plan does not say what happens when `guest-password.index` is unparsable or not an array of strings: `save`, `remove` and `clearAll` will each have to handle it. | Treat a bad index as `STORAGE_ERROR` (save/remove) and as a throw (`clearAll`), and test it with `InMemorySecretStore`. |

## Decisions the PR reviewer should look at
- D-2: a persisted index of public keys inside secure storage. It is the costly shape that S-09's `clearAll` depends on.
- D-3: FR-14 AC3 is proved only at the use-case level until S-09 (roadmap conflict, logged as `[REVIEW]`).
- D-4: the 15-**byte** limit (the capture tool uses 15 characters), UNVERIFIED on hardware.

## What is good
- All cited code is real and correct: `GuestPasswordSource` (`ports.ts:15`), `password: async () => ""` (`composition/index.ts:44`), the password read inside `runChecks` with an `UNEXPECTED_ERROR` → `NOT_TESTED` fallback (`run-controller.ts:172,186`; `classify.ts:28`), the meshcore.js login frame layout, `normalizeLabel`, and `FakeTransport.writtenFrames`.
- The costly decisions (D-1, D-2) are isolated in one tested file. The Expo wrapper stays thin, which matches tech-stack's `SecretStore` port.
- The leak test drives the real controllers into a real SQLite file. Its sanity assertion (the canary was really sent) prevents a vacuous pass on the radio side.
- The `[REVIEW]` deviations for the roadmap conflicts and the S-09 `[FOLLOW-UP]` follow the lessons.
