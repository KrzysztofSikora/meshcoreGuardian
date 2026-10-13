# Plan: app-look (S-12)

## Goal and end state
Every existing screen (Dashboard, Connect, Node with its run panel, Run result, and the Settings
placeholder) looks like the design reference in `docs/design/mockup/` (NFR-09): IBM Plex Sans and
Mono bundled in the APK, the mockup's ground/surface/accent palette, rounded cards, a status chip
with icon + word for every status (never colour alone, NFR-05), primary/secondary/danger buttons, a
segmented Dashboard / All contacts filter, and a bottom navigation bar (Dashboard, Connect,
Settings) on the three top-level screens. The app follows the system light/dark setting, with dark
values that pass the same contrast rule. All tokens (colour, type, spacing, radius) live in one
module; later slices (S-05 … S-09) build on its components.

Nothing a user reads changes: no `en.json` string is added, removed or edited, no presenter or
controller behaviour changes, no stored data changes. Every existing e2e flow passes unchanged, and
a new flow captures each screen in light and dark next to the matching mockup artboard. A unit test
checks WCAG contrast ≥ 4.5:1 for every token pair the theme declares as text-on-background.

## Scope
- In:
  - theme module (tokens light + dark, typography, spacing, radius) and a `useTheme()` hook that
    follows the system colour scheme;
  - bundled fonts (IBM Plex Sans 400/500/600/700, IBM Plex Mono 400/500) via the `expo-font`
    config plugin; `userInterfaceStyle: "automatic"` with `expo-system-ui`;
  - shared components in `apps/mobile/src/components/ui/`: icons, status chip, button
    (primary/secondary/danger), card + section heading, segmented filter, bottom navigation;
  - restyle of `ConnectionStatus`, `RunStatus`, `NodeRow` (node card), `NearestRepeaterCard`, and
    the Dashboard, Connect, Node (incl. the in-progress run panel = the mockup's "Run" artboard,
    D-7), Run result and Settings placeholder screens;
  - status → icon/tone mapping as pure data in the presenter (replaces the text glyphs, D-9);
  - contrast unit test; e2e flow `app-look.yaml` with light and dark screenshots; mockup artboard
    PNGs and a side-by-side evidence page.
- Out:
  - any mockup element that needs new text, data or behaviour: telemetry table, voltage chart,
    Export button, recent runs list, progress bar, per-step list on the run card, header subtitles
    such as "Room server · 7c73a8cd", "Heltec V3 · Connected" pill text, "Go to dashboard" button,
    "Run again in 0:42" button on the result screen (S-06, S-07, S-08 and later slices own them;
    the mockup's sample texts are not copied, roadmap *Decided up front*);
  - the real Settings screen (S-09); it only gets the theme and the bottom navigation here;
  - a theme switch in Settings (system setting only; S-09 may add one) → `[FOLLOW-UP]` candidate;
  - 200 % font-scale and TalkBack audit beyond what is listed under human checks (S-10 audits).

## Findings
- Screens use RN `Button` and unstyled `Text`; colours are hard-coded twice: filter colours
  `#1f4e8c`/`#6b7280` in `apps/mobile/src/app/index.tsx:111`, card border `#6b7280` in
  `components/nearest-repeater-card.tsx:137` and the label input `app/node/[id].tsx:203`.
- Each screen renders its own `accessibilityRole="header"` title (`app/index.tsx:47`,
  `app/connect.tsx:43`, `app/node/[id].tsx:49`, `app/run/[id].tsx:28`,
  `components/placeholder-screen.tsx:15`) **and** the Stack shows a native header with the same
  title (`app/_layout.tsx:10-16`): every title appears twice today.
- Status glyphs are text characters in `application/diagnostics/presenter.ts:73-86`
  (`statusGlyph`, used only by `components/run-status.tsx:15` and one test,
  `presenter.test.ts:114`) and `components/connection-status.tsx:5-10`.
- There is no separate "run in progress" route: progress, the airtime notice and Cancel live in
  `RunPanel` on the Node screen (`app/node/[id].tsx:139-200`); `/run/[id]` is the stored result
  (the mockup's "Result" artboard).
- E2E flows tap by text ("Run diagnostic" ×13, "Scan for companions", "Connect to …", "View
  details", "Cancel", "Other nearby \(5\)", node names) and by `testID` (`filter-all`,
  `filter-dashboard`, `label-input`; `nearest-card`). They use Android `back` from Connect to the
  Dashboard (`e2e/lib/connect-diag.yaml:22`) and from Node to the Dashboard. Taps on a `Pressable`
  that wraps `Text` already work (`Other nearby`, node rows), so custom buttons stay tappable by
  their text. Nothing asserts `enabled:`.
- Lint: `react/jsx-no-literals` (strings in JSX must come from the catalog) applies to
  `apps/mobile/src/**/*.tsx` (`eslint.config.*:112`); separators like "·" therefore cannot be added
  as literals.
- Fonts: `expo-font` 57.0.4 is already installed transitively (`pnpm-lock.yaml:2992`). Its config
  plugin embeds fonts at build time; on Android `android.fonts[].fontDefinitions` with `weight`
  registers one family with several weights, used as `{ fontFamily: "IBM Plex Sans", fontWeight:
  "600" }` (Expo docs, *Fonts*, via context7 `/expo/expo`). Without this, Android ignores
  `fontWeight` for a single-file custom family.
- Dark mode: Expo defaults `userInterfaceStyle` to `light` when absent; on Android the setting is
  ignored unless `expo-system-ui` is installed (Expo docs, *Color themes*). `app.json` has neither.
- `react-native-svg` is not installed; tech-stack already lists it (with gifted-charts) for S-07.
- Mockup (light only): ground `#F3F4F1`, surface `#FFFFFF`, text `#15201B`, muted `#55605A`,
  subtle `#4A524D`, border `#D9DDD8`, strong border `#B9BFB8`, divider `#ECEEEB`, segment track
  `#E4E7E2`, accent `#0E6B5E` (pressed `#0A4F45`); chips: ok `#E3F1E8`/`#1B6E43`, warn
  `#FBEEDC`/`#7F4500` (banner text `#6B3A00`), unsupported `#E9E7F3`/`#4B3F8A`, info
  `#E6EEF6`/`#1D3A57` (border `#9FB6CC`); danger `#A1262A`; disabled `#DCE0DA`/`#4A524D`. Radii
  8 (chip), 10 (button), 12 (segment), 14 (card); padding 16/20; title 26/700, detail title
  22/700, card name 17–18/600, section heading 12–13/600 uppercase +0.06em, body 15, small 12–13,
  mono 12–15. Bottom nav 60 px, 22 px icons, 12 px labels, active = accent.
- Tooling: `google-chrome` is installed, so the agent can render `preview/*.html` at 390×844 into
  PNGs for the side-by-side evidence. The e2e suite has 17 flows (test-plan asks for "~15").

## Decisions
| ID | Question | Chosen | Alternatives (and what they would buy) | Why | Reversal | Decided by |
|----|----------|--------|----------------------------------------|-----|----------|------------|
| D-1 | How are icons drawn? | `react-native-svg` (version pinned by `pnpm expo install`), every icon path copied from the mockup into one file `components/ui/icons.tsx` | B: Unicode glyphs in a `Text` (no dependency; inconsistent shapes and emoji fallback per device, does not look like the mockup); C: a Material Symbols icon font (one font file; different icon shapes from the mockup) | The mockup's icons are 24-px stroke SVG paths; tech-stack already chose react-native-svg for S-07 charts, so the dependency is pulled in one slice earlier, not added to the stack. Strongest case against: a native dependency in a pure-look slice; B needs nothing. All icons sit behind `<Icon name=…>` in one file, so B is a one-file swap | costly (new runtime dependency) | agent |
| D-2 | How are the fonts bundled? | TTF files committed under `apps/mobile/assets/fonts/` with the SIL OFL licence text, embedded by the `expo-font` config plugin; Android families `IBM Plex Sans` (400/500/600/700) and `IBM Plex Mono` (400/500) via `fontDefinitions`; `expo-font` added as an explicit dependency (`pnpm expo install expo-font`) | B: `@expo-google-fonts/ibm-plex-*` packages + `useFonts` at runtime (no binaries in git; adds an async load and a splash wait before first render, and a JS dependency); C: one TTF per weight as separate families (`IBMPlexSans-SemiBold`; no weight mapping; every style must name the file) | Embedded fonts need no load step (NFR-02, cold start NFR-06) and `fontWeight` keeps working. Files come from the `@expo-google-fonts/ibm-plex-sans` / `ibm-plex-mono` npm tarballs (`npm pack`, unpacked in a temp dir; OFL) or IBM's `IBM/plex` release; the source is written in `assets/fonts/README.md` | costly (new runtime dependency; ~1.2 MB binaries in git) | agent |
| D-3 | How does the app get light and dark? | `userInterfaceStyle: "automatic"` in `app.json`, `expo-system-ui` installed, `useColorScheme()` picks the token set | B: light only (mockup has no dark artboards; contradicts roadmap acceptance); C: in-app theme switch (needs Settings, new text; S-09) | Roadmap acceptance asks for light and dark values; following the system needs no new text | costly (new runtime dependency) | agent |
| D-4 | How do components read the theme? | `ThemeProvider` (React context) in `_layout.tsx`, `useTheme()` returns `{ scheme, colors, type, space, radius }`; screens build styles with a `useStyles(factory)` hook that memoises `StyleSheet.create(factory(theme))` per scheme | B: a Zustand theme store (store is for session/UI state; adds a subscription per component); C: two static style sheets per file (duplicates every style) | Context is the React convention for theming and keeps tokens out of the application layer; one hook, one place to change | cheap | agent |
| D-5 | How is the bottom navigation built? | A custom `BottomNav` component rendered by the three top-level screens inside the existing `Stack`; it calls `router.navigate` and marks the current tab with `accessibilityState.selected`; labels reuse `dashboard.title`, `connect.title`, `settings.title` | B: expo-router `Tabs` in a `(tabs)` group (idiomatic; moves route files, changes Android back from Connect, which `e2e/lib/connect-diag.yaml` relies on); C: no bottom nav, keep the "Connect companion" link (fails roadmap acceptance) | Keeps routes, deep links (`guardian://settings`, `guardian://debug/scenario/…`) and back behaviour unchanged, so existing flows stay valid; no new text | cheap | agent |
| D-6 | What happens to the duplicated titles? | Top-level screens (Dashboard, Connect, Settings) hide the native header (`headerShown: false`) and keep their in-content title, styled as the mockup's 26/700 heading. Node and Run result keep the native Stack header (back arrow, catalog title), themed (ground background, Plex 600, no shadow); their duplicated in-content title is removed and the node name becomes the large heading on the Node screen | B: hide every native header and draw our own back button (needs a new "Back" accessibility label in `en.json`, which this slice must not add); C: keep both titles (looks unlike the mockup) | The mockup's top-level screens have no back bar, the detail screens do; the native back button already has an accessible label. Each title text is still on screen exactly once | cheap | agent |
| D-7 | What is the mockup's "Run" artboard in this app? | The in-progress part of `RunPanel` on the Node screen: the airtime notice as an info note (`#E6EEF6`), the progress text in a card, Cancel as a full-width danger button. `/run/[id]` is restyled as the "Result" artboard | B: move progress to a new `/run/active` route (navigation and logic change; out of scope "no change to logic") | The roadmap forbids logic changes; the run screen in the app is the panel | cheap | agent |
| D-8 | How does the e2e flow capture dark screenshots? | A fake-build-only deep link `guardian://debug/theme/<light\|dark\|system>` (new route `app/debug/theme/[scheme].tsx`, same pattern as the scenario route, plan D-14 of run-diagnostic) sets an in-memory override in the theme provider; BLE builds ignore it and redirect to `/` | B: `adb shell cmd uimode night yes` in `scripts/e2e.sh` between two passes (tests the real system path, but doubles e2e time or needs a second script mode, and leaves the emulator in dark mode); C: no dark screenshots (fails acceptance) | Keeps the switch inside one Maestro flow; the real system path is a human check on the CI APK | cheap | agent |
| D-9 | Which tone and icon does each status use? | Pure data in `application/diagnostics/presenter.ts` replacing `GLYPHS`/`statusGlyph`: `statusLook(status) → { icon, tone }`: responded → `ok`/check; no_reply → `warn`/question-circle; transport_error → `warn`/alert-triangle; unsupported → `unsupported`/circle-slash; not_tested, cancelled, incomplete → `neutral`/dash. Connection: connected → `ok`/check, connecting → `info`/clock, failed → `warn`/alert-triangle, disconnected → `neutral`/circle. "Not in companion contacts" → `unsupported`/circle-slash and a dashed card border (as in the mockup) | B: keep tones in the components (not unit-testable without RN); C: one neutral tone for everything (loses the mockup's look; status still readable) | The mockup uses green for responded, amber for no reply, violet for not in contacts/unsupported; the word always carries the meaning (NFR-05), so tone choice is cosmetic and easy to change in one table | cheap | agent |
| D-10 | What are the dark values? | Agent-derived palette (mockup has none): ground `#101513`, surface `#1A211E`, text `#E6EBE7`, muted `#A6B0AA`, border `#2E3833`, accent `#5CC0AE` with `#0B1F1B` text on it; chip backgrounds are dark tints of the light hues with light foregrounds. Exact values may move during Phase 1 as long as the contrast test passes | B: invert the light palette (poor contrast on chips); C: Material dark baseline (does not match the accent) | Keeps the mockup's hues; the contrast test is the hard rule | cheap | agent |
| D-11 | How is "contrast ≥ 4.5:1 for every token pair used for text" checked? | `theme/tokens.ts` exports, per scheme, `TEXT_PAIRS`: every `[foreground, background]` combination a component uses for text (body on ground/surface, muted on surface/ground/segment track, chip fg on chip bg, on-accent on accent, danger on surface, disabled fg on disabled bg, nav active/inactive on surface …). `theme/contrast.test.ts` computes WCAG 2.x relative-luminance contrast (`theme/contrast.ts`) and asserts ≥ 4.5 for each. Components get colours through named roles (`colors.chip.ok.fg`), not raw hex | B: an ESLint rule that forbids hex outside the theme (stops raw colours, does not check contrast); C: manual audit only (S-10) | A unit test is the cheapest proof that runs on every PR; the review checks that each new text colour/background combination is listed. Raw hex in components is grep-checked at review | cheap | agent |
| D-12 | What evidence shows "next to the matching mockup artboard"? | `evidence/look.md`: one row per screen with the light and dark e2e screenshots and the mockup PNG rendered from `docs/design/mockup/preview/<Screen>.html` by headless `google-chrome --screenshot --window-size=390,844` (script in `scripts/mockup-shots.sh`, not a gate). Images ≤ 300 KB each | B: link the preview HTML only (reviewer opens a browser per screen); C: Playwright (not set up in this repo; no new tools) | One page to compare; Chrome is already on the machine | cheap | agent |
| D-13 | One look flow or screenshots in existing flows? | One new flow `e2e/app-look.yaml` that visits each screen in light, switches to dark (D-8) and repeats; total 18 flows | B: add `takeScreenshot` steps to existing flows (no new flow, but dark needs a second pass anyway and scatters evidence) | The test-plan's "~15 flows" is a guideline; one flow keeps the look evidence in one place. Logged as `[minor]` against the test-plan guideline | cheap | agent |

## Design
### Theme module (`apps/mobile/src/theme/`)
- `tokens.ts` (pure TypeScript, no React Native import, unit-testable):
  `type Scheme = "light" | "dark"`; `COLORS: Record<Scheme, Colors>` where `Colors` has named
  roles: `ground, surface, text, textMuted, textSubtle, border, borderStrong, divider,
  segmentTrack, segmentSelected, accent, accentPressed, onAccent, danger, disabledBg, disabledFg,
  focus` and `chip: Record<Tone, { bg, fg }>` with
  `type Tone = "ok" | "warn" | "unsupported" | "info" | "neutral"`; `note: { bg, fg, border }`
  (airtime notice) and `banner: Record<Tone, { bg, fg }>` (result header).
  `SPACE = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24 }`, `RADIUS = { chip: 8, button: 10,
  segment: 12, card: 14 }`, `FONT = { sans: "IBM Plex Sans", mono: "IBM Plex Mono" }`,
  `TYPE = { title, detailTitle, name, body, small, label, section, mono, monoSmall }` as
  `{ fontFamily, fontSize, fontWeight, lineHeight?, letterSpacing?, textTransform? }` objects.
  `TEXT_PAIRS: Record<Scheme, readonly (readonly [fg: string, bg: string, use: string])[]>`.
- `contrast.ts`: `contrastRatio(fg: string, bg: string): number` (sRGB → relative luminance,
  `(L1 + 0.05) / (L2 + 0.05)`), hex `#RRGGBB` only.
- `theme-provider.tsx`: `ThemeProvider` reads `useColorScheme()` and a debug override (D-8,
  in-memory `useState` exposed by `setThemeOverride(scheme | null)` through context);
  `useTheme(): Theme`; `useStyles<T>(factory: (theme: Theme) => T): T` memoised on the scheme.
- `_layout.tsx` wraps `Navigator` in `ThemeProvider`; Stack `screenOptions` set
  `contentStyle.backgroundColor = colors.ground`, header background `ground`, tint `text`,
  `headerTitleStyle` Plex 600, `headerShadowVisible: false`; `headerShown: false` for `index`,
  `connect`, `settings`; `StatusBar style` follows the scheme.

### Shared components (`apps/mobile/src/components/ui/`)
- `icons.tsx`: `Icon({ name, size?, color })` with `name: IconName` =
  `"check" | "question" | "alert" | "slash" | "dash" | "circle" | "clock" | "sync" | "play" |
  "bluetooth" | "grid" | "sliders" | "compass" | "info" | "search"`; paths from the mockup HTML.
  Always `accessibilityElementsHidden` / `importantForAccessibility="no"` (decoration, the label
  carries the meaning).
- `status-chip.tsx`: `StatusChip({ tone, icon, label })`: pill (`RADIUS.chip`, chip colours,
  13/600), `accessible` with `accessibilityLabel={label}`. `RunStatus` and `ConnectionStatus`
  become thin wrappers that map their model through `statusLook` / `connectionLook` and keep their
  current props and accessibility labels.
- `button.tsx`: `AppButton({ title, onPress, variant: "primary" | "secondary" | "danger", icon?,
  disabled?, accessibilityLabel?, testID?, accessibilityState? })`: `Pressable` with
  `accessibilityRole="button"`, `accessibilityState.disabled`, min height 44 (48 for full-width),
  pressed state uses `accentPressed`; disabled uses `disabledBg/disabledFg`. Replaces every RN
  `Button` in the restyled screens; `Link asChild` keeps working because `AppButton` forwards
  `onPress`.
- `card.tsx`: `Card({ children, variant?: "default" | "accent" | "dashed", testID? })` and
  `SectionHeading({ children })` (uppercase 12/600 muted, `accessibilityRole="header"`).
- `segmented.tsx`: `Segmented({ options: { id, label, testID }[], value, onChange })`: track
  `segmentTrack`, selected `segmentSelected`, each option a `Pressable` with
  `accessibilityRole="button"` and `accessibilityState.selected` (same contract as today's
  `FilterButton`, `testID`s `filter-dashboard`/`filter-all` preserved).
- `bottom-nav.tsx`: `BottomNav({ current: "dashboard" | "connect" | "settings" })`: three equal
  items with icon + catalog label, `accessibilityRole="tab"`, `accessibilityState.selected`,
  safe-area bottom inset, `router.navigate("/" | "/connect" | "/settings")`.
- `screen.tsx`: `Screen({ title?, children, nav?, scroll? })`: ground background, 20 px side
  padding, optional large title (`accessibilityRole="header"`), optional `BottomNav`.

### Data flow and invariants
- Components read colours only from `useTheme()`; no hex literal outside `theme/tokens.ts`
  (checked at review with `grep -rn "#[0-9a-fA-F]\{6\}" apps/mobile/src --include=*.tsx`).
- No `en.json` change: `git diff main -- apps/mobile/src/i18n/en.json` is empty at every phase.
- No change in `application/**` except the presenter's glyph table → `statusLook`
  (and `connectionLook` beside it), pure data with unit tests.
- Accessibility: every status keeps its spoken label; icons are hidden from accessibility;
  touch targets ≥ 44 dp; text uses only pairs in `TEXT_PAIRS`.

## Phases
### Phase 1: Theme, fonts and dark mode
- Files:
  - `apps/mobile/package.json`, `pnpm-lock.yaml`: add `expo-font`, `expo-system-ui`,
    `react-native-svg` with `pnpm expo install` (SDK-pinned versions). Contract: D-1, D-2, D-3.
  - `apps/mobile/app.json`: `"userInterfaceStyle": "automatic"`; `expo-font` plugin with
    `android.fonts` families `IBM Plex Sans` (400/500/600/700) and `IBM Plex Mono` (400/500).
  - `apps/mobile/assets/fonts/*.ttf`, `assets/fonts/OFL.txt`, `assets/fonts/README.md`: font files,
    licence and their source (D-2).
  - `apps/mobile/src/theme/tokens.ts`: light and dark tokens, `TEXT_PAIRS` (D-10, D-11).
  - `apps/mobile/src/theme/contrast.ts` + `contrast.test.ts`: `contrastRatio` with known-value
    tests (black/white = 21, equal colours = 1, one mockup pair) and the ≥ 4.5 assertion for every
    pair in both schemes.
  - `apps/mobile/src/theme/theme-provider.tsx`: `ThemeProvider`, `useTheme`, `useStyles`, override.
  - `apps/mobile/src/app/_layout.tsx`: provider, themed Stack options, `headerShown: false` for the
    three top-level screens (D-6), scheme-aware `StatusBar`.
  - `apps/mobile/src/app/debug/theme/[scheme].tsx`: fake-only override route (D-8).
- Proves: NFR-09 (tokens in one module, light and dark), NFR-05 contrast (unit, `contrast.test.ts`).
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`; `pnpm e2e` (header removal moves
  content up; whole suite must stay green); `git diff main -- apps/mobile/src/i18n/en.json` empty.
- Human checks: none (screens are restyled in later phases).

### Phase 2: Shared components and the Dashboard
- Files:
  - `apps/mobile/src/components/ui/{icons,status-chip,button,card,segmented,bottom-nav,screen}.tsx`:
    as in *Design*.
  - `apps/mobile/src/application/diagnostics/presenter.ts` + `presenter.test.ts`: replace
    `statusGlyph`/`GLYPHS` with `statusLook(status): { icon: IconName; tone: Tone }` and add
    `connectionLook(kind)`; the test asserts the D-9 table for every `RunStatus["kind"]` and every
    connection kind. `IconName`/`Tone` are string-literal types declared in the presenter (or a
    pure `application/look.ts`) so the application layer does not import RN.
  - `apps/mobile/src/components/run-status.tsx`, `connection-status.tsx`: render `StatusChip`;
    props and accessibility labels unchanged.
  - `apps/mobile/src/components/node-row.tsx`: node card (surface, border, radius 14, name 17/600
    with role right-aligned, status chip, last heard muted; "not in contacts" as an `unsupported`
    chip and a dashed border). `accessibilityLabel` unchanged.
  - `apps/mobile/src/components/nearest-repeater-card.tsx`: accent-bordered card, compass icon +
    uppercase heading in accent, primary "Run diagnostic" button with its existing
    `accessibilityLabel`, "Other nearby" as an accent link button; `testID="nearest-card"` kept.
  - `apps/mobile/src/app/index.tsx`: `Screen` with title, the "Connect companion" link as a pill
    with the Bluetooth icon in the header row, `ConnectionStatus` chip, primary "Sync contacts"
    button with sync icon next to the sync line, `Segmented` filter, list with 10 px gaps, empty
    texts muted, `BottomNav current="dashboard"`.
- Proves: NFR-09 shared components (status chip, node card, nearest card, buttons, segmented
  filter, bottom navigation); NFR-05 no colour-only status (unit `presenter.test.ts`: every status
  has an icon and a text key; e2e flows still assert the status words).
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`; grep every e2e flow for Dashboard
  list assertions (lesson: height above a shared list) and run the full `pnpm e2e`.
- Human checks: Dashboard light/dark vs `docs/design/mockup/preview/Main.html` (evidence in
  Phase 5).

### Phase 3: Connect and Settings
- Files:
  - `apps/mobile/src/app/connect.tsx`: `Screen` with title and `BottomNav current="connect"`;
    connected companion card (name 18/600, firmware in mono, status chip, Disconnect as secondary
    button); capabilities card with `SectionHeading` and rows (name left, chip-coloured
    icon + word right, dividers); technical details card in mono; permission, Bluetooth-off and
    scan sections as cards with secondary "Scan for companions" (search icon) and device rows;
    failure detail and link-lost note as `warn` notes. All texts and conditions unchanged.
  - `apps/mobile/src/components/placeholder-screen.tsx`, `apps/mobile/src/app/settings.tsx`: themed
    `Screen` with `BottomNav current="settings"`.
- Proves: NFR-09 (Connect artboard), FR-01 AC5 / FR-03 status words still present (e2e
  `connect-ok.yaml`, `unsupported-capability.yaml`, `permission-denied.yaml`,
  `bluetooth-off.yaml`, `reconnect.yaml`, `connect-fail.yaml` unchanged).
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`, full `pnpm e2e`.
- Human checks: Connect light/dark vs `preview/Connect.html` (evidence in Phase 5).

### Phase 4: Node, run panel and Run result
- Files:
  - `apps/mobile/src/app/node/[id].tsx`: node name as 22/700 heading, key prefix in mono, role and
    reported lines muted; `RunPanel` as the "Run" artboard (D-7): status chip, primary "Run
    diagnostic" (play icon), airtime notice as info note with primary/secondary buttons, progress
    text in a card with `accessibilityLiveRegion` kept, full-width danger "Cancel", result summary
    card with "View details" secondary button; label input themed (border, radius 10, Plex);
    role buttons as a wrapping row of secondary buttons with `accessibilityState.selected` and the
    selected one in accent; "Add to dashboard" secondary. Duplicated in-content title removed (D-6).
  - `apps/mobile/src/app/run/[id].tsx`: "Result" artboard: summary banner coloured by the run's
    `statusLook` tone with icon, explanation, facts and check rows in a card with
    `SectionHeading`, possible causes / next steps / limitations as cards with bullets (catalog
    `run.bullet` kept). Duplicated in-content title removed (D-6).
  - If the banner needs the run's tone: `runDetails` already exposes the summary; add
    `look: { icon, tone }` to `RunDetails` from `statusLook(lastRunStatus(run, run.startedAt))` or
    from the result kind, with a unit test. Contract: `RunDetails.look` (additive).
- Proves: NFR-09 (Node, Run, Result artboards); FR-05/FR-06/FR-11 texts unchanged (e2e `diag-*.yaml`,
  `contacts-label-restart.yaml`, `nearest-positions.yaml` unchanged).
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`, full `pnpm e2e`.
- Human checks: Node, run-in-progress and Result light/dark vs `preview/Node.html`, `Run.html`,
  `Result.html` (evidence in Phase 5).

### Phase 5: Look flow and side-by-side evidence
- Files:
  - `apps/mobile/e2e/app-look.yaml`: runs `lib/look-screens.yaml` twice, after
    `openLink: guardian://debug/theme/light` and `…/dark`, with `env: THEME`. The lib flow uses the
    `diag-no-reply` scenario: Connect (connected) → Dashboard (after sync) → Node → run in progress
    (after the airtime notice) → Cancel or wait for the result → Run result → Settings, with
    `takeScreenshot: look-<screen>-${THEME}` at each. Asserts the status words on each screen.
  - `apps/mobile/e2e/lib/look-screens.yaml`: the shared steps.
  - `scripts/mockup-shots.sh`: renders `docs/design/mockup/preview/{Connect,Main,Node,Run,Result,
    Settings}.html` to PNG with headless Chrome at 390×844 (manual tool, not a gate).
  - `context/changes/app-look/evidence/look-*.png`, `mockup-*.png`, `look.md`: the comparison table
    (screen | light | dark | mockup), each image ≤ 300 KB (downscale with `convert`/`pngquant` if
    available, else Chrome at device scale 1).
  - `context/test-plan.md`: add `app-look.yaml` to the e2e list and TR-19 coverage note (look flow
    asserts status words in both schemes); note the flow count (D-13).
- Proves: NFR-09 (each screen light and dark next to the mockup, e2e + human check); every existing
  flow still passes (full e2e).
- Agent checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`, full `pnpm e2e`;
  `git diff main -- apps/mobile/src/i18n/en.json` empty; hex grep from *Design* finds nothing
  outside `theme/tokens.ts`.
- Human checks:
  - Compare each row of `evidence/look.md` (light, dark, mockup): spacing, type, colours, chips,
    nav read as the mockup; differences listed under *Out* are expected.
  - On a real phone with the CI APK (`android-apk` artifact): switch the system to dark mode and
    back while the app is open; the app follows.
  - On the CI APK: system font size at maximum (≈ 200 %): Dashboard, Connect, Node, Result still
    readable, no clipped button text, bottom nav labels visible.
  - With TalkBack on the Dashboard: each node card reads name, role, status words, last heard; the
    nav items read "Dashboard/Connect/Settings, tab, selected" for the current one; icons are not
    announced.

## Risks and unknowns
- `react-native-svg`, `expo-font` plugin and `expo-system-ui` need a fresh prebuild; the e2e
  script already runs `expo prebuild` each build, so a stale `android/` folder is unlikely but a
  Gradle cache issue may need one clean rebuild (`rm -rf apps/mobile/android`, generated output).
- Custom `Pressable` buttons instead of RN `Button`: Maestro must still find them by text. Existing
  `Pressable` taps work; if a tap fails, the fix is `accessibilityLabel={title}` on `AppButton`.
- Removing the native header on top-level screens moves content up by one header height; flows
  that scroll to a row could change. Mitigated by running the full suite in every UI phase.
- Dark values are not designed by a person; the human check decides whether they are acceptable.
- Font licence: OFL requires shipping the licence with the fonts; the app's licences screen
  (tech-stack: meshcore.js notice) does not exist yet → `[FOLLOW-UP]` for S-10 to list Plex there.

## Progress
<!-- One line per phase. /implement ticks it in the phase's own commit. -->
- [x] Phase 1: Theme, fonts and dark mode
- [x] Phase 2: Shared components and the Dashboard
- [x] Phase 3: Connect and Settings
- [ ] Phase 4: Node, run panel and Run result
- [ ] Phase 5: Look flow and side-by-side evidence

## Human checks
<!-- Filled by /implement: one open checkbox per human check, with how to run it and evidence. -->
- [ ] (Phase 2) Dashboard light/dark next to the mockup: spacing, type, chips, node cards, nearest card, segmented filter, bottom nav — run: `EXPO_PUBLIC_TRANSPORT=fake pnpm --filter mobile android` on the `guardian` emulator, compare with `docs/design/mockup/preview/Main.html` — evidence: `context/changes/app-look/evidence/look.md` (written in Phase 5)
- [ ] (Phase 3) Connect (idle, connected with capabilities, failure) and Settings light/dark next to the mockup — run: `EXPO_PUBLIC_TRANSPORT=fake pnpm --filter mobile android` on the `guardian` emulator, compare with `docs/design/mockup/preview/Connect.html` — evidence: `context/changes/app-look/evidence/look.md` (written in Phase 5)

## Deviations
<!-- [minor] / [REVIEW] / [FOLLOW-UP] / [STUCK] entries, see autonomy.md section 3 -->
- [minor] The test-plan asks to keep the e2e suite under ~15 flows; it has 17 and this change adds
  `app-look.yaml` (D-13). Consequence: e2e runtime grows by one flow of about two minutes.
- [minor] Phase 1: plan says the three top-level screens get `headerShown: false` in Phase 1; code shows
  their in-content title sits under the status bar until they use `Screen` (safe-area padding, Phases
  2-3). Consequence: `index`, `connect` and `settings` keep their native header in Phase 1 and each
  phase that restyles the screen flips it to `headerShown: false`. No user-visible change in Phase 1.
- [minor] Phase 1: review finding 7 checked without a screenshot: after `pnpm e2e` the prebuilt
  `android/app/src/main/res/font/` holds `xml_ibm_plex_sans.xml`, `xml_ibm_plex_mono.xml` and the six
  TTFs, so the font plugin is active. Dark mode is first seen in Phase 5 screenshots.
- [minor] Phase 2: plan lists `statusLook` types in the presenter or `application/look.ts`; code declares `IconName`, `Tone` and `Look` in `diagnostics/presenter.ts`, and `icons.tsx` re-exports `IconName`. Consequence: none; `theme/tokens.ts` keeps its own `Tone` (same literals, structurally compatible).
- [minor] Phase 2: `headerShown: false` for `index` is set now (Dashboard uses `Screen` with safe-area padding); `connect` and `settings` follow in Phase 3.
- [minor] Phase 3: plan says capability rows use chip-coloured icon + word; code uses a `StatusChip` (ok/check, unsupported/slash) per row, so all colours stay in listed text pairs. `PlaceholderScreen` gained a required `nav` prop. Consequence: none.
- [FOLLOW-UP] Licences screen listing IBM Plex (OFL) and meshcore.js (MIT) — S-10 pilot release.
- [FOLLOW-UP] In-app theme choice (system / light / dark) on the Settings screen — S-09.

## Review response
<!-- revise mode only: one line per plan-review finding and what changed -->
