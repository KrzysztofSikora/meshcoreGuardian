# feat(app-look): restyle every screen to the design reference, with dark mode

Roadmap item S-12 (NFR-09, NFR-05). Every existing screen (Dashboard, Connect, Node with its run panel, Run result, Settings placeholder) now follows `docs/design/mockup/`: IBM Plex Sans/Mono bundled in the APK, the mockup palette with light and dark values that pass a 4.5:1 contrast test, rounded cards, status chips with icon + word for every status, primary/secondary/danger buttons, a segmented Dashboard / All contacts filter and a bottom navigation bar. The app follows the system light/dark setting. Tokens live in one module (`apps/mobile/src/theme/`) for S-05 … S-09 to build on. No `en.json` string, presenter behaviour or stored data changed.
Closes #20

> **Status:** Ready for review

## ⚠ Needs your decision
- **D-1 (costly):** icons drawn with `react-native-svg` (new native dependency in a look-only slice) → chose **A: SVG paths copied from the mockup into `components/ui/icons.tsx`**. Alternatives: B: Unicode glyphs in `Text` (no dependency, but inconsistent shapes and emoji fallback); C: Material Symbols icon font (different shapes). Switching costs: one file (`icons.tsx`) plus `package.json`/lockfile; every icon sits behind `<Icon name=…>`.
- **D-2 (costly):** fonts as ~1.2 MB TTF binaries committed under `apps/mobile/assets/fonts/` and embedded via the `expo-font` plugin → chose **embedded TTFs**. Alternatives: B: `@expo-google-fonts/*` + runtime `useFonts` (no binaries in git, but async load and splash wait); C: one family per weight. Switching costs: `app.json`, `package.json`, `assets/fonts/`, font family names in the theme.
- **D-3 (costly):** dark mode follows the system via `userInterfaceStyle: "automatic"` + `expo-system-ui` → chose **system-follow only**. Alternatives: B: light only; C: in-app switch (needs Settings text, S-09). Switching costs: `app.json`, `package.json`.
- **D-10:** the dark palette is agent-derived because the mockup has no dark artboards. Only the human checks below judge whether it looks right (contrast is unit-tested).
- **D-5:** a custom `BottomNav` inside the existing Stack, not expo-router `Tabs`. S-09 and later slices inherit it. Alternative: `Tabs` in a `(tabs)` group (idiomatic, but moves route files and changes Android back from Connect). Switching costs: route files and several e2e flows.

Reply in a review comment, e.g. `D-3: take B`, `drop the lessons commit`, then run `.claude/workflow/address-pr <PR number>`.

## Human checks
Evidence page with light, dark and mockup side by side: [`evidence/look.md`](context/changes/app-look/evidence/look.md).
- [ ] (Phase 2) Dashboard light/dark next to the mockup: spacing, type, chips, node cards, nearest card, segmented filter, bottom nav. Run `EXPO_PUBLIC_TRANSPORT=fake pnpm --filter mobile android` on the `guardian` emulator, compare with `docs/design/mockup/preview/Main.html`. Evidence: [`evidence/look.md`](context/changes/app-look/evidence/look.md)
- [ ] (Phase 3) Connect (idle, connected with capabilities, failure) and Settings light/dark next to the mockup. Run as above, compare with `docs/design/mockup/preview/Connect.html`. Evidence: [`evidence/look.md`](context/changes/app-look/evidence/look.md)
- [ ] (Phase 4) Node, run-in-progress (airtime notice, progress, Cancel) and Result light/dark next to the mockup. Run as above, open a node and run a diagnostic, compare with `Node.html`, `Run.html`, `Result.html` in `docs/design/mockup/preview/`. Evidence: [`evidence/look.md`](context/changes/app-look/evidence/look.md)
- [ ] (Phase 5) Every row of `evidence/look.md` (light, dark, mockup): spacing, type, colours, chips, nav read as the mockup. Run: open [`evidence/look.md`](context/changes/app-look/evidence/look.md)
- [ ] (Phase 5) On the CI APK (`android-apk` artifact) on a real phone: switch system dark mode on and off with the app open; the app follows. Evidence: none
- [ ] (Phase 5) On the CI APK with system font size at maximum: Dashboard, Connect, Node, Result readable, no clipped button text, nav labels visible (Settings > Display > Font size). Evidence: none
- [ ] (Phase 5) TalkBack on the Dashboard (CI APK): node cards read name, role, status words, last heard; nav reads "<name>, tab, selected"; icons silent. Evidence: none

## Other decisions made by the agent (cheap to change)
| ID | Question | Chosen | Alternatives |
|----|----------|--------|--------------|
| D-4 | How components read the theme | `ThemeProvider` context + `useTheme()` + memoised `useStyles` | Zustand theme store; two static style sheets per file |
| D-6 | Duplicated titles | Top-level screens hide the native header and keep an in-content title; Node and Result keep the themed native header | Draw own back button (needs a new `en.json` string); keep both titles |
| D-7 | Mockup "Run" artboard | The in-progress part of `RunPanel` on the Node screen; `/run/[id]` is the "Result" artboard | New `/run/active` route (logic change) |
| D-8 | Dark screenshots in e2e | Fake-build-only deep link `guardian://debug/theme/<light\|dark\|system>`; BLE builds redirect to `/` | `adb shell cmd uimode` between two passes; no dark screenshots |
| D-9 | Tone and icon per status | Pure data `statusLook`/`connectionLook` in `presenter.ts` | Tones in components; one neutral tone |
| D-11 | Contrast check | `TEXT_PAIRS` per scheme + `contrast.test.ts` (WCAG ≥ 4.5) | ESLint rule for hex; manual audit |
| D-12 | Side-by-side evidence | `evidence/look.md` with mockup PNGs from headless Chrome (`scripts/mockup-shots.sh`) | Link preview HTML only; Playwright |
| D-13 | One look flow or screenshots in existing flows | One new flow `e2e/app-look.yaml` (18 flows) | Screenshots inside existing flows |

## Quality
- Gates: typecheck ok, lint ok, unit tests ok (63 files, 1152 tests), e2e ok (18/18 flows, 8m 18s). Plan invariants hold: `en.json` diff empty, no hex literals in `.tsx`, evidence images ≤ 300 KB.
- Review: APPROVE, round 2. Round 1 had 4 findings: fixed 4, deferred 0, rejected 0 (R1 bottom nav grew the back stack on every tab tap (major); R2 warn notes used the info look; R3 pressed secondary button pair missing from `TEXT_PAIRS`; R4 status words asserted on too few screens).
- Plan review: READY WITH NOTES, 7 findings (1 major, 6 minor), incorporated in the plan.
- Mutation: `presenter.ts` 88.3% → 88.3%; `contrast.ts` 86.1% → 94.4%; `bug` mutants: none. Gaps noted: `statusOf` has no direct test; neither file is in the test-plan *Mutation targets* table.
- Proposed lessons: "When you build navigation with expo-router `navigate`, check the resulting back stack in an e2e flow" (commit `0d6cef0`; drop it to reject).

## Follow-ups
- [FOLLOW-UP] Licences screen listing IBM Plex (OFL) and meshcore.js (MIT): S-10 pilot release.
- [FOLLOW-UP] In-app theme choice (system / light / dark) on the Settings screen: S-09.
- [minor] The e2e suite is now 18 flows against the test-plan guideline of ~15 (D-13); about two more minutes of runtime.
- Add `presenter.ts` and `contrast.ts` to the test-plan *Mutation targets* and a direct test for `statusOf` (from mutation).

## Commits
```
35042db docs(app-look): review
eac8c12 docs(app-look): triage review round 1
0d6cef0 docs(app-look): propose lessons
1b6ddd4 fix(app-look): warn notes, pressed-button contrast pair, status-word asserts (R2, R3, R4)
c804c5e fix(app-look): bottom nav keeps the stack at [index, tab] (R1)
cb997a8 docs(app-look): review
572a77e docs(app-look): mutation
b34b08b test(app-look): strengthen assertions from mutation check
96ecf2f feat(app-look): look flow and side-by-side evidence
a1263f4 feat(app-look): restyled Node, run panel and Run result
a9e6e53 feat(app-look): restyled Connect and Settings with bottom navigation
3257163 feat(app-look): shared UI components and the restyled Dashboard
9201828 feat(app-look): theme tokens, bundled IBM Plex fonts and dark mode
2bbca07 docs(app-look): plan-review
4eedbc6 docs(app-look): plan
```

<details><summary>Run</summary>

Branch `change/app-look`, base `main`, started 2026-10-13 13:28. No failed step, no draft reason.

| Step | Attempts | Model | Cost |
|------|----------|-------|------|
| plan | 1 | opus | $1.78 |
| plan-review | 1 | opus | $0.84 |
| implement (5 phases) | 1 each | sonnet | $0.46, $0.49, $0.34, $0.38, $0.31 |
| mutation | 1 | sonnet | $0.21 |
| review round 1 | 1 | opus | $2.83 |
| fix-review | 1 | sonnet | $0.22 |
| review round 2 | 1 | opus | $0.63 |

Total about $8.49. Phases ticked 5/5.
</details>
