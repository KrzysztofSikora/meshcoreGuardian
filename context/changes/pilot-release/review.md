# Review: pilot-release

Verdict: APPROVE
Gates: typecheck ok, lint ok, unit tests ok (91 files, 1558 tests), e2e ok (27/27 flows, emulator `guardian`, APK built in the first attempt and reused), mutation ok (per `mutation.md`; fixes touch no mutation target, not re-run) · Round: 2

## Round 2 (re-review after `/fix-review`)

Checked each round-1 finding marked `fixed` against the code and the evidence:

| Finding | Fixed? | Evidence |
|---------|--------|----------|
| R1 | yes | `app.json` blocks `USE_BIOMETRIC`/`USE_FINGERPRINT`; `release-config.test.ts` asserts the list; re-captured `evidence/phase-1-release-permissions.txt` shows the release merged manifest with Bluetooth plus the sdk-23 location entries only; `docs/release.md` now states exactly that |
| R2 | yes | `eas.json` `production` and `preview` pin `node: "24.21.0"` (matches local `node --version` and `engines >=24`); test asserts both; `docs/release.md` says pnpm comes from `packageManager` |
| R3 | yes | `e2e/audit/screens.yaml` opens `export-open` after the stored run; `font-export.png` and `font-export-fields.png` exist (both < 300 KB) and show no clipping at 200 %; audit row, deviation and both Phase 4 human checks now include Export |
| R4 | yes | Row, script comment and output label say "time to first frame, not Dashboard ready"; Dashboard-ready time stays the Phase 5 phone check |
| R5 | yes | `test-plan.md` uses `<app.json version>-pr<N>.<sha>`; the `accent` clause is gone from the audit doc |

No new findings: the fix commits change only config, tests, an audit flow and docs, and none of
them introduces a regression or a lesson breach.

Round-1 tables and findings follow unchanged for the record.

## Plan vs diff
| File | Status | Note |
|------|--------|------|
| `apps/mobile/eas.json` | diverged | Production AAB, remote versioning, internal draft submit as planned; the Design's `node: "24"` (and pnpm) is missing and no deviation records it (R2) |
| `apps/mobile/app.json` | done | `0.1.0`, `blockedPermissions`, plugin registered; see R1 for the permissions left in |
| `apps/mobile/plugins/with-release-no-internet.js` | done | Writes only `src/release/AndroidManifest.xml` |
| `apps/mobile/src/config/release-config.test.ts` | done | |
| `docs/release.md` | done | One inaccurate claim (R1) |
| `.github/workflows/ci.yml` | done | Version from `app.json`; `workflow_dispatch` `transport`; empty value means BLE (`transport-mode.ts`) |
| `scripts/licenses.mjs`, `package.json` | done | |
| `apps/mobile/src/licenses/notices.json`, `.prettierignore` | done | 81 entries (logged `[minor]`) |
| `apps/mobile/src/licenses/notices.test.ts` | done | |
| `apps/mobile/src/application/about/licenses-presenter.ts` + test | done | |
| `apps/mobile/src/app/licenses.tsx` | done | |
| `apps/mobile/src/app/settings.tsx` | done | Two About buttons |
| `apps/mobile/src/i18n/en.json` | done | |
| `apps/mobile/e2e/licenses.yaml` | done | Checks the back stack |
| `docs/privacy-policy.md` | done | Claims checked against the code (export redaction default, delete, secure storage) |
| `apps/mobile/src/application/about/privacy.ts` + test | done | Named `privacyBlocks()` (headings plus paragraphs) instead of `privacyParagraphs()`; same intent |
| `apps/mobile/src/app/privacy.tsx` | done | |
| `apps/mobile/e2e/privacy.yaml` | done | |
| `scripts/lib/emulator.sh`, `scripts/e2e.sh` | done | Moved, not copied; PID-before-`wait` lesson kept |
| `scripts/a11y-shots.sh`, `apps/mobile/e2e/audit/screens.yaml` | done | Standalone flow (logged `[minor]`); Export not captured (R3) |
| `apps/mobile/src/theme/tokens.ts` | absent | Justified: the new screens use pairs that are already listed (`docs/accessibility-audit.md`) |
| `docs/accessibility-audit.md` | done | Export row rests on a false premise (R3) |
| `apps/mobile/src/components/ui/screen.tsx` | done | Title row wraps (logged `[minor]`) |
| `apps/mobile/src/debug/large-seed.ts` + test, `voltage-seed.ts` | done | |
| `apps/mobile/src/app/debug/seed/[name].tsx` | done | |
| `apps/mobile/e2e/perf/large-history.yaml`, `scripts/perf-trace.sh` | done | gfxinfo window differs (logged `[minor]`); cold-start measure, see R4 |
| `docs/performance.md` | done | See R4 |
| `apps/mobile/src/app/_layout.tsx` | unplanned | Registers the two new routes; required |
| `apps/mobile/src/composition/index.ts` | unplanned | `nodeRepository` for the seed (logged `[minor]`) |
| `context/roadmap.md`, `context/changes/pilot-release/*` | unplanned | Workflow artifacts and evidence |

## Areas
| Area | Result | One-line reason |
|------|--------|-----------------|
| Correctness | concern | The release manifest still requests biometric permissions the app does not use, and the runbook says "Bluetooth only" (R1) |
| Design | ok | Presenters hold the logic, screens only render; one shared emulator library; the plugin is small and easy to revert |
| Safety | ok | No credentials or service-account path committed; seed routes are gated to the fake build; policy claims match the code |
| Tests | ok | Config, notices drift, policy/catalog drift and the seed integration test assert behaviour; e2e checks the back stack |
| Simplicity | ok | No dead code; the scripts are short |
| Plan fidelity | concern | `eas.json` has no `node` field and no deviation records it (R2); Export not audited, with an incorrect reason (R3) |
| Agent decisions | ok | D-1, D-2 and D-12 (costly) each live in one place (`eas.json`, `app.json` plus plugin, catalog plus doc) and can be swapped as the plan says |

## Findings
### R1: Release manifest keeps unused biometric permissions; runbook says "Bluetooth only"
- Severity: major
- Where: `apps/mobile/app.json:12`, `docs/release.md:14`
- Problem: the plan's end state is "the release manifest asks only for the permissions the app uses". The merged release manifest the agent recorded (`evidence/phase-1-release-permissions.txt`) still has `android.permission.USE_BIOMETRIC` and `USE_FINGERPRINT`, which `expo-secure-store` adds. No code uses `requireAuthentication` or any biometric API (grep over `apps/mobile/src` and `packages`), and both permissions appear on the Play listing. `docs/release.md` also states "the release manifest asks for Bluetooth only", which is false. The list additionally contains `ACCESS_COARSE/FINE_LOCATION` (sdk-23, `maxSdkVersion=30`; they never apply because minSdk is 31). The human check "lists no network permission" will pass, so nothing else will catch this.
- Fix: add `android.permission.USE_BIOMETRIC` and `android.permission.USE_FINGERPRINT` to `blockedPermissions`, extend `release-config.test.ts`, re-run the release build and re-capture `phase-1-release-permissions.txt`. Then reword `docs/release.md` to the real list (Bluetooth, plus the location entries limited to Android ≤ 11 by ble-plx).
- Effort: small
- Lesson candidate: When a doc or test claims what a generated manifest contains, derive the claim from the captured merged manifest, not from the config you changed
- Decision: fixed (0975c99)

### R2: `eas.json` has no Node version, although the Design requires one; no deviation recorded
- Severity: major
- Where: `apps/mobile/eas.json:7-11`
- Problem: the Design says `build.production` gets `node: "24"` and the pnpm version from `packageManager` "if EAS accepts the field". EAS documents `node` as a build-profile field. The repo declares `engines.node ">=24"` and `packageManager pnpm@12.9.1`, so an EAS image left on its default Node may fail or behave differently in the first human step (FR-20 AC1). The field is missing and *Deviations* does not mention it, so the person running `eas build` has no warning.
- Fix: add `"node": "24.x"` to the `production` and `preview` profiles (and `"pnpm": "12.9.1"` if the schema accepts it), and assert it in `release-config.test.ts`. Option B: if it was left out on purpose, log a `[REVIEW]` deviation and say so in `docs/release.md`.
- Effort: small
- Lesson candidate: no
- Decision: fixed (0975c99)

### R3: Export screen not audited at 200 % font; the stated reason is wrong
- Severity: major
- Where: `apps/mobile/e2e/audit/screens.yaml:31-49`, `docs/accessibility-audit.md` (Export row)
- Problem: the plan's audit table includes Export. The deviation and the audit doc both say Export was "not captured: needs a stored run". In fact `node/[id].tsx:163` renders the `export-open` button on every node screen, whatever the history. The audit flow sits on Room K's node screen, and it also stores a run before it leaves. No human check covers Export either: the Phase 4 walkthrough is Connect → Dashboard → Node → Run → Settings. So NFR-05 at 200 % is never checked on Export, which has a dense preview with field lists and redaction lines.
- Fix: after `font-node-result`, add `scrollUntilVisible`/`tapOn` `id: export-open`, wait for "Last 30 days" and take `font-export` (scroll once more for the field list). Re-run `scripts/a11y-shots.sh`, update the Export row and the `[minor]` deviation, and add Export to the Phase 4 phone walkthrough.
- Effort: small
- Lesson candidate: Before skipping a screen in an audit or test as unreachable, confirm the precondition in the route code
- Decision: fixed (71db14c)

### R4: "Cold start" records time to first frame, not time to the Dashboard
- Severity: minor
- Where: `scripts/perf-trace.sh:58-62`, `docs/performance.md` (Results table)
- Problem: the NFR-06 target is "a cold start reaches the Dashboard in 3 s or less". The script records `am start -W` `TotalTime`, which ends at the activity's first drawn frame (the splash view, before JS loads and the Dashboard renders; the app does not call `reportFullyDrawn`). The results table shows "Cold start … median 335" with no caveat, so it reads as an NFR-06 pass on the emulator.
- Fix: measure until Dashboard content appears, for example a Maestro `launchApp` plus `extendedWaitUntil "Seed node 1"` timed by the script, or a logged JS-ready marker. Otherwise relabel the row "time to first frame (`am start -W`), not Dashboard ready".
- Effort: small
- Lesson candidate: no
- Decision: fixed (f49f2f6; relabelled as time to first frame, Dashboard-ready time stays a phone human check)

### R5: Docs left inaccurate by this change
- Severity: minor
- Where: `context/test-plan.md:160`, `docs/accessibility-audit.md` (Method, contrast)
- Problem: the test plan still tells the person that App info shows `0.0.0-pr<N>.<sha>`; CI now stamps `0.1.0-…` from `app.json`. The audit doc says the new screens use "`accent` for headings", but `privacy.tsx` draws headings in `colors.text`, so the contrast statement names a pair the screen does not use.
- Fix: change the test-plan line to `<app.json version>-pr<N>.<sha>`, and drop the `accent` clause from the audit doc.
- Effort: small
- Lesson candidate: no
- Decision: fixed (f49f2f6)
