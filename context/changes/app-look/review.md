# Review: app-look

Verdict: APPROVE
Gates: typecheck ok, lint ok, unit tests ok (63 files, 1152 tests), e2e ok (18/18 flows, 8m 18s) · Round: 2

Invariants from the plan: `git diff main...HEAD -- apps/mobile/src/i18n/en.json` is empty; the
hex grep `grep -rn "#[0-9a-fA-F]\{6\}" apps/mobile/src --include=*.tsx` finds nothing; every
evidence image is ≤ 300 KB (largest 245 KB).

## Plan vs diff
| File | Status | Note |
|------|--------|------|
| `apps/mobile/package.json`, `pnpm-lock.yaml` | done | `expo-font`, `expo-system-ui`, `react-native-svg` (D-1, D-2, D-3) |
| `apps/mobile/app.json` | done | `userInterfaceStyle: automatic`, `expo-font` plugin with both families |
| `apps/mobile/assets/fonts/*` (6 TTF, `OFL.txt`, `README.md`) | done | |
| `apps/mobile/src/theme/tokens.ts` | done | Light/dark tokens, `TEXT_PAIRS`; round 2 adds the pressed secondary pair (R3 fixed) |
| `apps/mobile/src/theme/contrast.ts`, `contrast.test.ts` | done | |
| `apps/mobile/src/theme/theme-provider.tsx` | done | |
| `apps/mobile/src/app/_layout.tsx` | done | Themed Stack, top-level headers hidden (D-6, logged deviation on timing) |
| `apps/mobile/src/app/debug/theme/[scheme].tsx` | done | Fake builds only; BLE builds redirect to `/` |
| `apps/mobile/src/components/ui/icons.tsx` | done | |
| `apps/mobile/src/components/ui/status-chip.tsx` | done | |
| `apps/mobile/src/components/ui/button.tsx` | done | |
| `apps/mobile/src/components/ui/card.tsx` | done | |
| `apps/mobile/src/components/ui/segmented.tsx` | done | `filter-*` testIDs kept |
| `apps/mobile/src/components/ui/bottom-nav.tsx` | done | Round 2: `dismissTo("/")` / `push` / `replace` keep the stack at `[index, tab]` (R1 fixed) |
| `apps/mobile/src/components/ui/screen.tsx` | done | |
| `apps/mobile/src/application/diagnostics/presenter.ts` + test | done | `statusLook`, `connectionLook`, `RunDetails.look` (logged deviations) |
| `apps/mobile/src/components/run-status.tsx`, `connection-status.tsx` | done | |
| `apps/mobile/src/components/node-row.tsx` | done | |
| `apps/mobile/src/components/nearest-repeater-card.tsx` | done | |
| `apps/mobile/src/app/index.tsx` | done | |
| `apps/mobile/src/app/connect.tsx` | done | Round 2: failure detail and link-lost note use `banner.warn` (R2 fixed) |
| `apps/mobile/src/components/placeholder-screen.tsx`, `app/settings.tsx` | done | Logged deviation: `nav` prop added |
| `apps/mobile/src/app/node/[id].tsx` | done | |
| `apps/mobile/src/app/run/[id].tsx` | done | |
| `apps/mobile/e2e/app-look.yaml`, `e2e/lib/look-screens.yaml` | done | Round 2: asserts "Supported" and "Not tested", plus a Settings → Connect → back check for R1 |
| `scripts/mockup-shots.sh` | done | |
| `context/changes/app-look/evidence/*` | done | |
| `context/test-plan.md` | done | |
| `context/roadmap.md` | done | Status line only |
| `context/lessons.md` | unplanned | Round 2: R1 lesson proposed by `/fix-review` (status `proposed`), expected |
| `context/changes/app-look/{plan,plan-review,mutation}.md` | done | Workflow artifacts |

## Areas
| Area | Result | One-line reason |
|------|--------|-----------------|
| Correctness | ok | Round 2: tab taps keep the stack at `[index, tab]`; verified in code and by the new back step in `app-look` |
| Design | ok | Tokens in one module, components read named roles, the application layer stays free of RN, icons sit behind one switch |
| Safety | ok | Debug theme route does nothing in BLE builds; no secrets, no new I/O |
| Tests | ok | Contrast test covers the pressed pair; the look flow asserts status words on every status screen and the back stack |
| Simplicity | ok | Small components; `useStyles` factories use only the theme, so memoising on the scheme is safe |
| Plan fidelity | ok | R1 and R2 divergences fixed in round 2 |
| Agent decisions | ok | D-1 (`react-native-svg`) sits in `icons.tsx` only, D-2/D-3 in `app.json` + `package.json` only, so each swap stays local; D-8 route is fake-only |

## Round 2 check
- R1 fixed (c804c5e): `bottom-nav.tsx:44-48` uses `dismissTo("/")` for Dashboard, `push` from the
  Dashboard and `replace` between Connect and Settings. The new tail of `look-screens.yaml`
  (Settings → Connect → `back` → Dashboard) passes in both schemes.
- R2 fixed (1b6ddd4): `Note tone="warn"` uses `banner.warn` (already in `TEXT_PAIRS`) for the
  failure detail and the link-lost note. No evidence screenshot shows these notes, so none needs
  re-taking.
- R3 fixed (1b6ddd4): `[text, segmentTrack, "secondary button pressed"]` is in `textPairs`.
- R4 fixed (1b6ddd4): the look flow asserts "Supported" (Connect) and "Not tested" (Dashboard, Node).
- No new findings.

## Findings
### R1: Bottom navigation pushes a new screen on every tab tap
- Severity: major
- Where: `apps/mobile/src/components/ui/bottom-nav.tsx:44`
- Problem: `router.navigate(item.href)` in expo-router 57 only reuses the route when it is the
  current one (`node_modules/expo-router/build/layouts/StackClient.js:96-104`; `pop` is set only by
  `dismissTo`); otherwise it pushes. Dashboard → Settings → Dashboard gives the stack
  `[index, settings, index]`. Checked on the `guardian` emulator with a scratch Maestro flow
  (`launchApp` → tap "Settings" → tap "Dashboard" → `back` → "Settings will appear here." is
  visible). So Android back from the Dashboard goes to the previous tab instead of leaving the app.
  The stack grows with every tap, and each pushed Dashboard or Connect is a new instance that runs
  its mount effects again. D-5 chose the custom nav to keep "back behaviour unchanged".
- Fix: navigate between top-level screens without growing the stack: to Dashboard use
  `router.dismissTo("/")`; to Connect/Settings use `router.replace(href)` when the current screen is
  Connect or Settings and `router.push(href)` from the Dashboard, so the stack is never deeper than
  `[index, tab]`. Add a flow step (or extend `app-look`) that taps two tabs, presses `back` and
  asserts the Dashboard.
- Effort: small
- Lesson candidate: When you build navigation with expo-router `navigate`, check the resulting stack (back button) in an e2e flow; `navigate` pushes unless the target is the current route.
- Decision: fixed (c804c5e) + lesson proposed

### R2: Connection failure and link-lost notes use the calm `info` look, not `warn` as planned
- Severity: minor
- Where: `apps/mobile/src/app/connect.tsx:189` (`Note`), used at lines 62 and 207
- Problem: Phase 3 says "failure detail and link-lost note as `warn` notes"; `Note` always uses
  `colors.note` (the blue airtime-notice palette). The failure chip above it is `warn` (amber), so
  the reason sits in a different, informational colour. This divergence is not under *Deviations*.
  The words still carry the meaning, so NFR-05 holds.
- Fix: give `Note` a `tone` prop and pass `colors.banner.warn` (already in `TEXT_PAIRS`) for the
  failure and link-lost notes; or log a `[minor]` deviation if blue was a deliberate choice.
- Effort: small
- Lesson candidate: no
- Decision: fixed (1b6ddd4)

### R3: `TEXT_PAIRS` misses the pressed secondary button (text on segment track)
- Severity: minor
- Where: `apps/mobile/src/components/ui/button.tsx:65` (pressed secondary bg = `segmentTrack`, fg = `text`); `apps/mobile/src/theme/tokens.ts:150-170`
- Problem: D-11 requires every text/background combination a component uses to be listed so that
  the contrast test guards it. `[text, segmentTrack]` is used but not listed. Today it passes
  (13.4:1 light, 12.0:1 dark, computed with `contrastRatio`), so the gap affects only later token
  changes.
- Fix: add `[c.text, c.segmentTrack, "secondary button pressed"]` to `textPairs`.
- Effort: small
- Lesson candidate: no
- Decision: fixed (1b6ddd4)

### R4: The look flow asserts status words on fewer screens than the plan and test-plan claim
- Severity: minor
- Where: `apps/mobile/e2e/lib/look-screens.yaml:40-62`; `context/test-plan.md:138`
- Problem: Phase 5 says the flow "asserts the status words on each screen", and the test-plan
  says "status words asserted in both schemes (TR-19)". The flow waits for "Connected" and "No
  response — cause unknown" only. For the Dashboard node cards ("Not tested"), the Node screen
  chip and the capability chips ("Supported") it takes screenshots without assertions. Other
  flows assert most of these words in light mode only. A dark-mode regression that hid a chip's
  text would pass.
- Fix: add `assertVisible` for "Not tested" on the Dashboard and Node steps and for one
  capability word on the connected Connect step. Or change the test-plan sentence to match what
  the flow checks.
- Effort: small
- Lesson candidate: no
- Decision: fixed (1b6ddd4)
