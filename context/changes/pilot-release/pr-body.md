# feat(pilot-release): Play-internal release build, licences and privacy screens, accessibility and performance records

Roadmap S-10. A signed Play AAB can now be built with EAS (`production` profile, remote `versionCode`, internal draft submit). The release manifest asks for Bluetooth only (plus sdk-23 location entries that never apply at minSdk 31) and has no `INTERNET`. Settings → About now opens an offline privacy policy and an open-source licences list (meshcore.js MIT and IBM Plex OFL first). `docs/privacy-policy.md` carries the same text. `docs/accessibility-audit.md` records the NFR-05 audit with one fix, and `docs/performance.md` records the emulator trace with a seeded 200 nodes and 1,000 runs. `docs/release.md` is the runbook and pilot checklist. Covers PRD FR-20 AC1–AC2 (config, in-app text and tests only; the Play upload and the public URL are human checks), NFR-05 and NFR-06 (emulator only; the phone verdict is a human check).
Closes #11

> **Status:** Ready for review

## ⚠ Needs your decision
- **Plan review #1 (major), not addressed in the plan or the CI file:** the plan review found that `workflow_dispatch` only runs if the workflow file is on the default branch (GitHub docs). `main`'s `ci.yml` has no `workflow_dispatch`, so `gh workflow run ci.yml --ref change/pilot-release -f transport=fake` (the Phase 5 human check and `docs/performance.md:31`) will most likely be rejected until this PR merges. Options: (a) accept that the phone performance check is post-merge; (b) ask for a follow-up that builds the fake APK on a PR label or commit tag. Reply e.g. `plan-review 1: take b`.
- **D-1 (costly):** signing and version numbers → chose **EAS-managed upload keystore, `appVersionSource: remote` with `autoIncrement`, version `0.1.0`**. Alternatives: B own keystore on the laptop with `eas build --local`; C `versionCode` in `app.json` bumped by hand. Switching costs: signing identity of the Play app (the upload key can be reset through Play support); `eas.json`, `app.json`.
- **D-2 (costly):** release permissions → chose **block `SYSTEM_ALERT_WINDOW`, `VIBRATE`, external storage (and, after review R1, `USE_BIOMETRIC`/`USE_FINGERPRINT`); remove `INTERNET` in the release variant only** via `apps/mobile/plugins/with-release-no-internet.js`. Alternatives: B keep `INTERNET`; C block it in every variant (breaks Metro dev builds). Switching costs: one plugin file and one `app.json` entry; permissions shown on the Play listing. The e2e run on the release APK passed without `INTERNET`. Plan review #2: the sdk-23 `ACCESS_*_LOCATION`/`BLUETOOTH*` entries from ble-plx stay and are listed in `docs/release.md` and `evidence/phase-1-release-permissions.txt`; they sit next to the policy's "no location use" claim.
- **D-12 (costly):** public policy text and Data safety answers → chose **"all data stays on the device; the app makes no network requests; guest passwords only in secure storage; exports only when the user shares them, public keys redacted; no data collected / shared"**. Alternatives: B also claim "no network permission"; C a generic template. Switching costs: public legal text on Play and in the app; `docs/privacy-policy.md`, the `privacy.*` catalog block and `privacy.test.ts`.
- **[REVIEW] NFR-06 vs the 50-run caps:** the node screen loads and renders at most 50 runs (`RECENT_RUNS`, `VOLTAGE_RUNS`) and has no chart range. The seed stores 1,000 runs (801 on one node); the trace covers 200 dashboard rows, 50 history rows and 50 voltage rows, and `docs/performance.md` says so. Rendering 1,000 rows needs paging, a new change. Reply `NFR-06: open a change` if you want it.
- **Review leftovers:** none. Round 1 found R1–R5 (3 major, 2 minor), all fixed; round 2 is APPROVE.

Reply in a review comment, e.g. `D-3: take B`, `R4: fix it`, `drop the lessons commit`,
then run `.claude/workflow/address-pr <PR number>`.

## Human checks
- [ ] (Phase 1) Build and upload the AAB; the Play Console accepts it (FR-20 AC1). Run: follow `docs/release.md` (`eas init`, `eas build -p android --profile production`, manual first upload to the internal track). Evidence: none.
- [ ] (Phase 1) Install from the Play internal link; the app info screen lists no network permission. Run: Settings → Apps → MeshCore Guardian → Permissions. Evidence: [`evidence/phase-1-release-permissions.txt`](evidence/phase-1-release-permissions.txt) (merged release manifest, local build).
- [ ] (Phase 2) Open Settings → Open-source licences on the CI APK; the list starts with meshcore.js and IBM Plex, the expanded meshcore.js text is readable, the wording is acceptable. Run: install the `android-apk` artifact, Settings → Open-source licences → "Show licence text: @liamcottle/meshcore.js". Evidence: none (e2e `licenses.yaml` passes on the emulator).
- [ ] (Phase 3) Read the policy wording in the app and in [`docs/privacy-policy.md`](../../../docs/privacy-policy.md). Run: install the `android-apk` artifact, Settings → Privacy policy. Evidence: none (e2e `privacy.yaml` passes on the emulator).
- [ ] (Phase 3) Publish `docs/privacy-policy.md` at a public URL, enter it in the Play Console and in `docs/release.md`, open it in a private browser window without login (FR-20 AC2). Run: "Publish the policy" in [`docs/release.md`](../../../docs/release.md). Evidence: none.
- [ ] (Phase 3) Fill in the Data safety form so that it matches the policy ("no data collected", "no data shared"). Run: Play Console → App content → Data safety. Evidence: none.
- [ ] (Phase 4) On the phone (CI APK), set the font size to the largest and display size to large, and walk Connect → Dashboard → Node → Run → Export → Settings looking for clipped or overlapping text. Run: Settings → Display → Font size and style / Display size. Evidence: [`evidence/font-200/`](evidence/font-200/) (emulator, 200 %), [`docs/accessibility-audit.md`](../../../docs/accessibility-audit.md).
- [ ] (Phase 4) Turn TalkBack on and confirm every control on those screens is announced with a meaningful name and run status is spoken in words. Run: Settings → Accessibility → TalkBack. Evidence: none (labels listed in `docs/accessibility-audit.md`).
- [ ] (Phase 5) On the mid-range phone: run the `ci` workflow with `transport=fake`, export data, uninstall Guardian, install the `-fake` APK, open `guardian://debug/seed/large-history`, check scroll smoothness with HWUI bars and cold start ≤ 3 s, write the results into [`docs/performance.md`](../../../docs/performance.md), then reinstall the BLE APK. Run: `gh workflow run ci.yml --ref change/pilot-release -f transport=fake` (see the first decision above: may only work after merge). Evidence: [`evidence/perf-emulator.txt`](evidence/perf-emulator.txt) (emulator run; cold start there is time to first frame, not Dashboard ready).

## Other decisions made by the agent (cheap to change)
| ID | Question | Chosen | Alternatives |
|----|----------|--------|--------------|
| D-3 | Source of licence notices | `scripts/licenses.mjs` collects packages from the Android bundle's source map plus native-module deps; `notices.json` committed (81 entries) | `pnpm licenses list --prod` (~490 entries with build tools); hand-written list |
| D-4 | Licences screen shape | `/licenses` route, `FlatList`, expandable rows, meshcore.js and IBM Plex first | detail route per package; one long text |
| D-5 | Policy inside the app | `/privacy` route from the catalog; a unit test checks the doc matches verbatim | link to a public URL; render markdown (new dependency) |
| D-6 | Privacy contact | "developer contact e-mail on the Play listing"; no address in the repo | e-mail in the doc; placeholder |
| D-7 | Public policy URL (AC2) | A person publishes it; the agent publishes nothing | make the repo public; public gist |
| D-8 | Large-history seed | 200 nodes via `applySync` (`complete: false`), 1,000 runs (801 on one node) | 5 runs per node; 1,000 runs on one node |
| D-9 | Fake APK for the phone trace | `workflow_dispatch` input `transport` (`ble`/`fake`); see the first decision | build both on every PR; local USB build; application id suffix |
| D-10 | Where audits live | `docs/accessibility-audit.md`, `docs/performance.md`, `docs/release.md`; evidence in the change folder | change evidence only |
| D-11 | EAS project id | A person runs `eas init` and commits the result | `app.config.ts` reading `.env` |
| D-13 | Emulator boot for scripts | Shared `scripts/lib/emulator.sh` (moved from `e2e.sh`) | require a running emulator; copy the code |

## Quality
- Gates: typecheck ok, lint ok, unit tests ok (91 files, 1558 tests), e2e ok (27/27 flows on emulator `guardian`), mutation ok.
- Review: APPROVE, round 2 (round 1: APPROVE WITH FOLLOW-UPS): fixed 5 (R1 biometric permissions, R2 EAS Node pin, R3 Export audited at 200 %, R4 cold-start label, R5 stale docs), deferred 0, rejected 0.
- Mutation: licenses-presenter 100 % → 100 %; privacy 94.74 % → 100 %; `bug` mutants: none (one `strengthen` fixed by a test, one equivalent).
- Proposed lessons: none.

## Follow-ups
- [FOLLOW-UP] The IBM Plex row on the Licences screen reads "Version fonts" (the notice's version field is the literal "fonts").
- [FOLLOW-UP] Notices for native Android libraries (AndroidX, Hermes, OkHttp…) in the licences screen, e.g. from a Gradle licence plugin.
- [FOLLOW-UP] Paging, if 1,000 rendered history rows are wanted (NFR-06 reading above).
- [FOLLOW-UP] Dashboard-ready cold-start time is measured only on the phone (the emulator number is time to first frame).
- [FOLLOW-UP] Phone fake-APK build before merge (plan review #1), if wanted.
- Plan-review minors #3–#6 (seed status variety, origin `at` assertion, round-trip test, shared build function) were not recorded in *Review response*; the build function was moved into `scripts/lib/emulator.sh` ([minor] deviation in the plan). Whether the seed's 199 single-run nodes show status variety was not checked in this write-up.

## Commits
```
e59078b docs(pilot-release): review
c4c31af docs(pilot-release): triage review round 1
f49f2f6 fix(pilot-release): label first-frame time, correct version and contrast docs (R4, R5)
71db14c fix(pilot-release): audit the Export screen at 200 % (R3)
0975c99 fix(pilot-release): block biometric permissions, pin EAS Node version (R1, R2)
6cf3b54 docs(pilot-release): review
410ebe9 docs(pilot-release): mutation
cd3fe9c test(pilot-release): strengthen assertions from mutation check
3e77a2c feat(pilot-release): large-history seed, perf trace and performance record
21a8e4a feat(pilot-release): accessibility audit at 200 % font and title wrap fix
098558e feat(pilot-release): privacy policy in the app and in docs
32f2b23 feat(pilot-release): open-source licences screen
08affb5 feat(pilot-release): release build config for the Play internal track
d15d6be docs(pilot-release): plan-review
fde1d2b docs(pilot-release): plan
9bd58ba docs(pilot-release): plan-review
245e6bc docs(pilot-release): plan
```

<details><summary>Run</summary>

Branch `change/pilot-release`, base `main`, started 2026-10-18 21:07. Failed step: none. Draft reason: none. Plan review: round 1 NEEDS CHANGES, round 2 READY WITH NOTES. Review: round 1 APPROVE WITH FOLLOW-UPS (5 findings), round 2 APPROVE (0 open). Phases ticked: 5/5.

| Step | Attempts | Cost |
|------|----------|------|
| plan (+ revise) | 1 + 1 | $1.70 + $0.74 |
| plan-review (2 rounds) | 1 + 1 | $0.76 + $0.70 |
| implement (5 phases) | 5 × 1 | $0.39 + $0.48 + $0.40 + $1.06 + $0.67 |
| mutation | 1 | $0.18 |
| review (2 rounds) | 1 + 1 | $2.59 + $1.32 |
| fix-review | 1 | $0.33 |

Total about $11.32 (as reported by the runner, before pr-body).
</details>
