# feat(repo-skeleton): pnpm workspace, Expo app shell and all quality gates

Roadmap item F-01 *Repository skeleton*: a pnpm workspace (`apps/mobile`, `packages/domain`, `packages/meshcore-adapter`, `packages/storage`, TypeScript 6.0.3 strict, `nodeLinker: hoisted`) in which every gate in `CLAUDE.md` exists and passes on an empty app: `pnpm typecheck`, `pnpm lint` (ESLint layer rules, with a test proving forbidden imports fail), `pnpm test`, `pnpm e2e` (release APK with fake transport, Maestro smoke flow on the headless AVD `guardian`) and `pnpm mutation`. It also adds an Expo SDK 57 dev-build app with expo-router, five empty routes, an i18next `en.json` catalog, the ble-plx config plugin and `minSdkVersion` 31, plus the `EXPO_PUBLIC_TRANSPORT` switch, the `openTestDb` helper, CI (`checks` + report-only `mutation-report`) and `.env.example`. No PRD functional AC is covered. It covers constraints C-02, C-03 and C-09, and the tooling side of TR-22.
Closes #1

> **Status:** Ready for review

## Added after the autonomous run (by request)
- **Phone guard.** Agents never touch a physical Android device: `scripts/e2e.sh` refuses any non-emulator serial; the runner (`.claude/workflow/lib.sh`) refuses to start and stops before each step while a phone is attached; the PreToolUse hook (`wf.py`) denies `adb`/`maestro`/`expo run:android` aimed at a non-emulator, any `adb connect`/`pair`, and all device commands while a phone is attached. Rule in `CLAUDE.md`.
- **CI job `android-apk`.** Release APK (`arm64-v8a`, real BLE, debug-signed) as a PR artifact for testing on a phone without USB debugging. Recipe in `context/test-plan.md` (*Install a PR build on a phone*).

## ⚠ Needs your decision
- **D-10 (costly):** Android application id and URL scheme → chose **`io.github.krzysztofsikora.guardian`, scheme `guardian`**. Alternatives: B: `com.meshcoreguardian.app` (nicer, but implies a domain nobody owns); C: decide at S-10 (but the id is already baked into every build and into the e2e `appId`). Switching costs: cheap until the first Play upload in S-10, permanent after it. Today it is one value in `apps/mobile/app.json` and in `apps/mobile/e2e/*.yaml`.
- **[REVIEW] D-11, e2e build type contradicts artifacts:** `context/test-plan.md` (*Gates*, `pnpm e2e` line) says the script installs the fake-transport **debug** build, and `context/tech-stack.md` (*Local development*) says Maestro runs "against the running fake-transport build". `scripts/e2e.sh` builds and installs a **release** APK (JS embedded, no Metro), as D-11 decided. Alternative: a debug build plus a Metro process that the script starts. If you confirm, the artifacts need updating (see Follow-ups). This is plan-review finding #1 (major).
- **[REVIEW] D-18, pnpm peer handling:** the install auto-added optional peers (reanimated 4.7.1, worklets 0.13.0, gesture-handler, react-dom 19.3.0) that Expo autolinking would compile into the APK, and worklets was outside `expo-modules-core`'s range. The run set `autoInstallPeers: false`, regenerated `pnpm-lock.yaml` and added `vite@8.3.4` to the root devDependencies. Consequence: later slices must declare native peers explicitly. Alternative: keep auto-install and add the template versions of those native modules (D-18 C).
- **[REVIEW] D-19, patched Stryker runner:** with Stryker 10 on Vitest 5 every mutant run ran 0 tests (0 %). The cause is test-name format: the runner sends `"suite test"`, but Vitest 5 matches `"suite > test"`. The run applied a two-line `pnpm patch` to `@stryker-mutator/vitest-runner@10.0.0` (`patches/`, `patchedDependencies`). Alternatives: Vitest 4.x, or a 0 % gate until upstream fixes it.
- **D-1 (cheap, but contradicts the tech-stack sketch):** native wrappers (`BleTransport`, `ExpoSqlDriver`, `ExpoSecretStore`) go in `apps/mobile/src/platform/`, and lint forbids Expo/RN imports in every `packages/*`. This decides where S-02 puts `BleTransport`. Alternatives: B: inside `packages/meshcore-adapter` / `packages/storage` with per-file lint exceptions; C: a separate `packages/native`.
- **Proposed lesson:** "In a shell cleanup trap, signal a started child by PID before you `wait` on it" (from R1), in `context/lessons.md`. Drop commit `698088d` to reject it.
- **Plan review / review leftovers:** None unresolved. Review R4 (minor) was deferred to S-04; see Follow-ups.

Reply in a review comment, e.g. `D-3: take B`, `R4: fix it`, `drop the lessons commit`,
then run `.claude/workflow/address-pr <PR number>`.

## Human checks
- [ ] (Phase 2) The CI APK installs on a real Android phone and opens on the Dashboard title. The Settings screen shows "Transport: BLE". App info → Permissions lists no location permission. Run: download the `android-apk` artifact of this PR and install it (test-plan cookbook *Install a PR build on a phone*; no USB debugging). Evidence: [`evidence/phase-2-manifest.txt`](context/changes/repo-skeleton/evidence/phase-2-manifest.txt) (generated manifest: `BLUETOOTH_SCAN` with `neverForLocation`, location permissions capped at `maxSdkVersion 30`, `android.minSdkVersion=31`).
- [ ] (Phase 3) CI workflow `ci` is green on this PR: job `checks` passes, and job `mutation-report` shows "No mutation target files changed" in its summary. Its Stryker path stays unverified on CI until S-04 adds a target (plan-review #9). Run: open the PR's Checks tab. Evidence: [`evidence/phase-3-mutation-changed.txt`](context/changes/repo-skeleton/evidence/phase-3-mutation-changed.txt) (local run of the same script, both paths).
- [ ] (Added) Job `android-apk` is green and its artifact downloads as `meshcore-guardian-pr13-<sha>.apk`.
- [ ] (Phase 3) Optional re-run of the e2e gate on the laptop. Run: `pnpm e2e` (it runs only on an emulator and refuses any other `ANDROID_SERIAL`); `E2E_SKIP_BUILD=1 pnpm e2e` reuses the APK. Evidence: [`evidence/phase-3-e2e.txt`](context/changes/repo-skeleton/evidence/phase-3-e2e.txt) (agent run: smoke flow passed).

## Other decisions made by the agent (cheap to change)
Full table with rationale: [`plan.md#decisions`](context/changes/repo-skeleton/plan.md#decisions).

| ID | Question | Chosen | Alternatives |
|----|----------|--------|--------------|
| D-2 | Package names | `@guardian/domain`, `@guardian/meshcore-adapter`, `@guardian/storage`; app `mobile` | `@meshcore-guardian/*` |
| D-3 | How packages expose code | Source-only `exports` → `./src/index.ts`, `tsc --noEmit` | TS project references + `dist/` |
| D-4 | Proving a forbidden import fails lint | Vitest test running ESLint `lintText` on virtual paths | Excluded fixture file + expect-fail script; custom rule tester |
| D-5 | ESLint major | ESLint 10.12 with explicit `settings.react.version` (plugins declare peer `^9`, workaround verified) | ESLint 9.39; drop eslint-config-expo |
| D-6 | pnpm version | `pnpm@12.9.1` (installed); settings in `pnpm-workspace.yaml` | Pin pnpm 10.x via Corepack |
| D-7 | Stryker smoke target | `packages/domain/src/diagnostics/result-code.ts` (FR-06 codes + `isResultCode`) | Throwaway `sum()`; `timeout.ts` |
| D-8 | Stub transport before S-01 | `parseTransportMode` + `createTransport(mode)` stubs; no `MeshTransport` interface yet | Draft `MeshTransport` now |
| D-9 | `EXPO_PUBLIC_TRANSPORT` parsing | unset/empty/`ble` → `ble`, `fake` → `fake`, anything else throws at startup | Unknown → `ble` silently |
| D-12 | Commit `android/`? | No (CNG, gitignored) | Commit it |
| D-13 | CI `mutation-report` scope | Changed files matching `stryker.targets` | All of `packages/domain/src`; no job until S-04 |
| D-14 | `expo-localization` now? | No; `lng: "en"` | Install and detect device locale |
| D-15 | `expo-dev-client`? | No | Install it |
| D-16 | Layer-rule pattern syntax | `regex` patterns, one block per package glob | Gitignore-style `group` globs |
| D-17 | typescript-eslint preset | `recommended` (not type-aware) | `recommendedTypeChecked` |
| D-20 | e2e device without `ANDROID_SERIAL` | First running emulator, else boot `guardian`; never a phone implicitly | Any attached device |

## Quality
- Gates: typecheck ok, lint ok, unit tests ok (75/75), e2e ok (smoke flow passed on headless AVD `guardian`), mutation ok (`result-code.ts` 85.71 %, survivor triaged equivalent).
- Review: APPROVE, round 2: fixed 3 (R1 major: `pnpm e2e` hung forever on emulator boot timeout; R2: domain rule missed bare Node built-ins; R3: `.env*.local` not gitignored), deferred 1 (R4, see Follow-ups), rejected 0.
- Plan review: READY WITH NOTES (1 major, 8 minor). All were addressed in the implementation and logged under [Deviations](context/changes/repo-skeleton/plan.md#deviations).
- Mutation: 96.43 % → 96.43 % (27 killed / 1 survived) on `result-code.ts` (85.71 %) and `transport-mode.ts` (100 %). `bug` mutants: none. The one survivor (`typeof value === "string"` → `true`) is equivalent.
- Proposed lessons: "In a shell cleanup trap, signal a started child by PID before you `wait` on it". Drop commit `698088d` to reject it.

## Follow-ups
- `context/tech-stack.md` says pnpm 10.x, but this change uses pnpm 12.9.1 (D-6). Update the row.
- `context/tech-stack.md` *Architecture sketch* places the native wrappers inside packages. Update it once D-1 is confirmed.
- Update the `pnpm e2e` lines in `context/test-plan.md` and `context/tech-stack.md` to the release build (D-11) and the device rule (D-20), once confirmed.
- `context/tech-stack.md` lists `expo-localization`, but D-14 leaves it out until a second locale exists. Update the row, or install it with the second locale.
- The generated manifest includes Expo's default `INTERNET`, `SYSTEM_ALERT_WINDOW`, `VIBRATE` and `READ/WRITE_EXTERNAL_STORAGE` permissions. Remove the unneeded ones (`android.blockedPermissions`) before the pilot release (S-10, NFR-07).
- Drop `patches/@stryker-mutator__vitest-runner@10.0.0.patch` once an upstream runner release supports Vitest 5 test names (report upstream).
- Review R4 (deferred): `react/jsx-no-literals` uses `ignoreProps: true`, so literal `accessibilityLabel`/`title`/screen `options` strings pass lint even though C-09 covers them. With S-04's status UI, switch to `noAttributeStrings` plus an allow-list, and add an `accessibilityLabel` row to `tooling/lint/layer-rules.test.ts`.
- Mutation gap: `apps/mobile/src/config/transport-mode.ts` is outside the default `mutate` glob and `stryker.targets`, so CI never mutates it. Add it to test-plan *Mutation targets* if app-side config parsing grows.
- Pins held back by pnpm's minimum-release-age policy: `prettier@3.9.9` (latest 3.9.10) and `i18next@26.4.2` (latest 26.4.3). Bump them later.

## Commits
- d456175 docs(repo-skeleton): review
- 79d6ac5 docs(repo-skeleton): triage review round 1
- 698088d docs(repo-skeleton): propose lessons
- 2ab69a0 docs(repo-skeleton): narrow the C-09 lint comment to JSX children (R4)
- fba48bb fix(repo-skeleton): gitignore local Expo env files (R3)
- bc8b8c6 fix(repo-skeleton): forbid bare Node built-in imports in domain (R2)
- f48b3a0 fix(repo-skeleton): stop the started emulator by PID when boot times out (R1)
- 3e793d9 docs(repo-skeleton): review
- 63bf35e docs(repo-skeleton): mutation
- e2eba65 feat(repo-skeleton): mutation gate, emulator e2e smoke flow and CI workflow
- 58d1bd6 feat(repo-skeleton): Expo app shell with routes, i18n catalog and transport switch
- 92454b2 feat(repo-skeleton): pnpm workspace, packages and quality tooling
- 598ba53 docs(repo-skeleton): plan-review
- 3c590e4 docs(repo-skeleton): plan

<details><summary>Run</summary>

`ship repo-skeleton` (F-01), base `main`, branch `change/repo-skeleton`, started 2026-10-10 22:56.

| Step | Result | Cost |
|------|--------|------|
| plan | success, 19 turns | $1.43 |
| plan-review | READY WITH NOTES | $0.61 |
| implement phase 1 | success, 28 turns | $1.18 |
| implement phase 2 | success, 47 turns | $1.71 |
| implement phase 3 | success, 70 turns | $2.86 |
| mutation | success, 11 turns | $0.40 |
| review round 1 | APPROVE WITH FOLLOW-UPS, 4 open findings | $1.07 |
| fix-review | success, 13 turns | $0.54 |
| review round 2 | APPROVE, 0 open findings | $0.56 |

Every step succeeded on its first attempt. Failed step: none. Draft reason: none. Phases ticked: 3/3. Total before pr-body: $10.36.
</details>
