# Accessibility audit (NFR-05, TR-19)

Audited on the `guardian` emulator (Android, fake-transport release APK) with the system font
scale at 2.0 (200 %), by `bash scripts/a11y-shots.sh`. Screenshots:
`context/changes/pilot-release/evidence/font-200/`. Repeat the audit before each release and
after a layout change. The phone checks (largest font and display size, TalkBack) are human
checks in the pilot checklist in `docs/release.md`.

## Method

- **Contrast:** `apps/mobile/src/theme/contrast.test.ts` asserts at least 4.5:1 for every text
  colour pair in `TEXT_PAIRS`, in the light and the dark scheme. The Licences and Privacy screens
  use only `text` and `textMuted` on `ground` or `surface`, and `accent` for headings; those pairs
  are already listed, so no pair was added.
- **Labels:** read from the code (`accessibilityRole`, `accessibilityLabel`, `accessibilityState`)
  and asserted by the e2e flows, which find controls by their text.
- **Colour-only status:** every status shows an icon and words (`StatusChip`, `RunStatus`). The
  look pass (`e2e/lib/look-screens.yaml`) asserts the status words and that "offline" never appears.
- **200 % font:** one screenshot per screen, looking for clipped, overlapping or mid-word-broken text.

## Results

| Screen | Contrast | Labels | Colour-only status | 200 % font | Fix |
|--------|----------|--------|--------------------|------------|-----|
| Connect | pass (`TEXT_PAIRS`) | buttons by title; capability rows have chip words | pass: "Supported" with icon | pass: `font-connect-idle.png`, `font-connect-connected.png` | none |
| Dashboard | pass | rows have a label (`node-row.tsx`); tabs carry role and selected state | pass: status words in rows | **fail** before: the title "Dashboard" broke mid-word ("Das/hbo/ard") next to the "Connect companion" link. Pass after: `font-dashboard.png`, `font-dashboard-empty.png` | `Screen` title row wraps (`flexWrap`), so the accessory moves below the title |
| Node | pass | text fields and role buttons labelled; chart has a summary label | pass: "Not tested" chip with icon | pass: `font-node.png`, `font-node-confirm.png`, `font-node-result.png` | none |
| Run (in progress) | pass | live region announces the step | pass: step in words | pass: `font-run.png` | none |
| Result | pass | headers have `accessibilityRole="header"` | pass: "No response — cause unknown" with icon | pass: `font-result.png`, `font-result-causes.png`, `font-result-steps.png` | none |
| Export | pass | switch labelled | n/a | not captured: needs a stored run; covered by the Settings and Node layouts (same `Screen`, `Card`, `AppButton`) | none |
| Settings | pass | timeout field and switch labelled; segmented options carry selected state | n/a | pass: `font-settings.png` | none |
| Licences | pass | each toggle names its package; expanded state exposed | n/a | pass: `font-licenses.png` | none |
| Privacy | pass | headings carry the header role | n/a | pass: `font-privacy.png` | none |

## Not covered

- TalkBack on a real device and the largest display size: human check.
- The Export screen at 200 %: not in the flow; add it when a stored run is seeded in the audit flow.
