# feat(app-look): restyle every screen to the design mockup, with light and dark themes

Roadmap S-12 (`app-look`, NFR-09, NFR-05). Every existing screen (Dashboard, Connect, Node with its run panel, Run result, Settings placeholder) now follows `docs/design/mockup/`: bundled IBM Plex Sans/Mono, one token module, status chips with icon + word (never colour alone), primary/secondary/danger buttons, a segmented Dashboard / All contacts filter and a bottom navigation bar. The app follows the system light/dark setting, and a unit test checks WCAG contrast ≥ 4.5:1 for every declared text-on-background pair in both schemes. No `en.json` string and no logic changes. A new e2e flow `app-look.yaml` captures each screen in light and dark next to the mockup artboard.
Closes #20

> **Status:** Ready for review

## ⚠ Needs your decision
- **D-1 (costly):** icons drawn with `react-native-svg` (new native dependency in a look-only slice), all behind `<Icon>` in `components/ui/icons.tsx`. Alternatives: B: Unicode glyphs (no dependency, inconsistent shapes/emoji fallback); C: icon font (different shapes). Switching costs: one file (`icons.tsx`) plus `package.json`/lockfile.
- **D-2 (costly):** IBM Plex TTFs (~1.2 MB) committed under `apps/mobile/assets/fonts/` and embedded via the `expo-font` plugin. Alternatives: B: `@expo-google-fonts/*` + runtime `useFonts` (no binaries, async load and splash wait); C: one family per weight. Switching costs: `app.json`, `package.json`, the font folder. The OFL text ships with the fonts; the in-app licence screen is a follow-up (S-10).
- **D-3 (costly):** `userInterfaceStyle: "automatic"` + `expo-system-ui` (new dependency) so the app follows the system. Alternatives: B: light only; C: in-app theme switch (needs Settings text, S-09). Switching costs: `app.json`, `package.json`.
- **D-10:** the dark palette is agent-derived (the mockup has no dark artboards). Only the human check judges whether it looks right; contrast is proven by unit test. Alternatives: B: inverted light palette; C: Material dark baseline.
- **D-5:** custom `BottomNav` inside the existing Stack instead of expo-router `Tabs`. It keeps routes, deep links and back behaviour; S-09 and later slices inherit it. Alternative: B: `Tabs` in a `(tabs)` group (moves route files, changes back from Connect).
- **Review leftovers:** none open (R1–R5 fixed). Mutation notes `statusOf` in `diagnostics/presenter.ts` has no direct test, and two new modules are not in the test-plan *Mutation targets* table (see Follow-ups).

Reply in a review comment, e.g. `D-3: take B`, `R4: fix it`, `drop the lessons commit`,
then run `.claude/workflow/address-pr <PR number>`.

## Human checks
- [ ] (Phase 2) Dashboard light/dark next to the mockup: spacing, type, chips, node cards, nearest card, segmented filter, bottom nav. Run: `EXPO_PUBLIC_TRANSPORT=fake pnpm --filter mobile android` on the `guardian` emulator, compare with `docs/design/mockup/preview/Main.html`. Evidence: [`evidence/look.md`](context/changes/app-look/evidence/look.md)
- [ ] (Phase 3) Connect (idle, connected with capabilities, failure) and Settings light/dark next to the mockup. Run: same command, compare with `preview/Connect.html`. Evidence: [`evidence/look.md`](context/changes/app-look/evidence/look.md)
- [ ] (Phase 4) Node, run-in-progress (airtime notice, progress, Cancel) and Result light/dark next to the mockup. Run: same command, open a node and run a diagnostic, compare with `preview/Node.html`, `Run.html`, `Result.html`. Evidence: [`evidence/look.md`](context/changes/app-look/evidence/look.md)
- [ ] (Phase 5) Every row of `evidence/look.md` (light, dark, mockup): spacing, type, colours, chips, nav read as the mockup. Run: open [`evidence/look.md`](context/changes/app-look/evidence/look.md). Evidence: same file
- [ ] (Phase 5) On the CI APK (`android-apk` artifact) on a real phone: switch system dark mode on and off with the app open; the app follows. Evidence: none
- [ ] (Phase 5) On the CI APK with system font size at maximum: Dashboard, Connect, Node, Result readable, no clipped button text, nav labels visible. Run: Settings > Display > Font size. Evidence: none
- [ ] (Phase 5) TalkBack on the Dashboard: node cards read name, role, status words, last heard; nav reads "<name>, tab, selected"; icons silent. Run: enable TalkBack on the CI APK. Evidence: none

## Other decisions made by the agent (cheap to change)
| ID | Question | Chosen | Alternatives |
|----|----------|--------|--------------|
| D-4 | How do components read the theme? | `ThemeProvider` context + `useTheme()` / `useStyles()` | B: Zustand theme store; C: two static style sheets per file |
| D-6 | Duplicated titles | Top-level screens hide the native header and keep an in-content title; Node and Result keep the themed native header and drop the in-content title | B: custom back button (needs new `en.json` text); C: keep both |
| D-7 | Mockup's "Run" artboard | The in-progress part of `RunPanel` on the Node screen; `/run/[id]` is the "Result" artboard | B: new `/run/active` route (logic change) |
| D-8 | Dark screenshots in e2e | Fake-build-only deep link `guardian://debug/theme/<light\|dark\|system>`; BLE builds redirect to `/` | B: `adb shell cmd uimode night`; C: no dark screenshots |
| D-9 | Tone and icon per status | Pure data `statusLook` / `connectionLook` in the presenter | B: tones in components; C: one neutral tone |
| D-11 | Contrast check | `TEXT_PAIRS` per scheme + `contrast.test.ts` (WCAG ≥ 4.5) | B: ESLint rule for hex; C: manual audit |
| D-12 | Evidence format | `evidence/look.md` with e2e screenshots next to mockup PNGs from headless Chrome (`scripts/mockup-shots.sh`) | B: link preview HTML; C: Playwright |
| D-13 | Look flow | One new flow `e2e/app-look.yaml` (18 flows total) | B: screenshots inside existing flows |

## Quality
- Gates: typecheck ok, lint ok, unit tests ok (63 files, 1152 tests), e2e ok (18/18 flows, 8m 25s). Invariants hold: `en.json` diff empty, no hex literals in `.tsx` outside the theme, evidence images ≤ 300 KB.
- Review: APPROVE, round 3: 5 findings fixed (R1 major: bottom nav pushed a screen on every tab tap; R2–R5 minor: warn notes, pressed-button contrast pair, status-word asserts, vacuous Node scroll step), 0 deferred, 0 rejected. Round 3 also covers the PR #21 comment (Node and Run result could not scroll; fixed with `flexGrow: 1`).
- Mutation: `presenter.ts` 88.3% → 88.3%; `contrast.ts` 86.1% → 94.4%; `bug` mutants: none (survivors were equivalent or on lines this change did not touch; three regex/message mutants killed by new tests).
- Plan review: READY WITH NOTES (1 major, 6 minor, all addressed in the plan).
- Proposed lessons: "navigation with expo-router `navigate` must be checked via the back button in e2e" (R1) and "an e2e scroll step must run where the target is below the fold" (R5). To reject, drop commits `0d6cef0` and `32fb0d9` (`docs(app-look): propose lessons`).

## Follow-ups
- [FOLLOW-UP] Licences screen listing IBM Plex (OFL) and meshcore.js (MIT): S-10 pilot release.
- [FOLLOW-UP] In-app theme choice (system / light / dark) on the Settings screen: S-09.
- Test-plan gaps from mutation: add `apps/mobile/src/application/diagnostics/presenter.ts` and `apps/mobile/src/theme/contrast.ts` to *Mutation targets*; `statusOf` has no direct test.
- [minor] e2e suite is now 18 flows against the test-plan guideline of ~15 (D-13).

## Commits
```
0ab4927 docs(app-look): triage review round 3
32fb0d9 docs(app-look): propose lessons
c2be50e fix(app-look): run the Node scroll step after the run, when the screen overflows (R5)
e5d8a33 docs(app-look): review
97e2d41 fix(app-look): let Node and Run result scroll, assert it in e2e (PR #21 review)
01a3da9 docs(app-look): pr-body
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

Latest run: `address-pr #21` (1 new comment) → review round 1 (APPROVE, 1 open finding) → fix-review → pr-body. Costs recorded: address-pr $0.26 (22 turns), review $0.87, fix-review $0.14 (8 turns). All steps succeeded; failed step: none; draft reason: none; phases ticked 5/5.
</details>
