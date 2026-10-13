/**
 * Design tokens (NFR-09): colour, type, spacing and radius in one module. Pure TypeScript, no
 * React Native import, so the contrast test can run under Vitest. Light values come from the
 * mockup in `docs/design/mockup/`; dark values are derived (plan D-10).
 */

export type Scheme = "light" | "dark";
export type Tone = "ok" | "warn" | "unsupported" | "info" | "neutral";

export interface ToneColors {
  bg: string;
  fg: string;
}

export interface Colors {
  ground: string;
  surface: string;
  text: string;
  textMuted: string;
  textSubtle: string;
  border: string;
  borderStrong: string;
  divider: string;
  segmentTrack: string;
  segmentSelected: string;
  accent: string;
  accentPressed: string;
  onAccent: string;
  danger: string;
  onDanger: string;
  disabledBg: string;
  disabledFg: string;
  chip: Record<Tone, ToneColors>;
  note: { bg: string; fg: string; border: string };
  banner: Record<Tone, ToneColors>;
}

const LIGHT: Colors = {
  ground: "#F3F4F1",
  surface: "#FFFFFF",
  text: "#15201B",
  textMuted: "#55605A",
  textSubtle: "#4A524D",
  border: "#D9DDD8",
  borderStrong: "#B9BFB8",
  divider: "#ECEEEB",
  segmentTrack: "#E4E7E2",
  segmentSelected: "#FFFFFF",
  accent: "#0E6B5E",
  accentPressed: "#0A4F45",
  onAccent: "#FFFFFF",
  danger: "#A1262A",
  onDanger: "#FFFFFF",
  disabledBg: "#DCE0DA",
  disabledFg: "#4A524D",
  chip: {
    ok: { bg: "#E3F1E8", fg: "#1B6E43" },
    warn: { bg: "#FBEEDC", fg: "#7F4500" },
    unsupported: { bg: "#E9E7F3", fg: "#4B3F8A" },
    info: { bg: "#E6EEF6", fg: "#1D3A57" },
    neutral: { bg: "#E4E7E2", fg: "#3C4641" },
  },
  note: { bg: "#E6EEF6", fg: "#1D3A57", border: "#9FB6CC" },
  banner: {
    ok: { bg: "#E3F1E8", fg: "#1B6E43" },
    warn: { bg: "#FBEEDC", fg: "#6B3A00" },
    unsupported: { bg: "#E9E7F3", fg: "#4B3F8A" },
    info: { bg: "#E6EEF6", fg: "#1D3A57" },
    neutral: { bg: "#E4E7E2", fg: "#3C4641" },
  },
};

const DARK: Colors = {
  ground: "#101513",
  surface: "#1A211E",
  text: "#E6EBE7",
  textMuted: "#A6B0AA",
  textSubtle: "#B8C1BB",
  border: "#2E3833",
  borderStrong: "#47524C",
  divider: "#252E2A",
  segmentTrack: "#232B27",
  segmentSelected: "#323D38",
  accent: "#5CC0AE",
  accentPressed: "#7AD0C0",
  onAccent: "#0B1F1B",
  danger: "#F0868A",
  onDanger: "#2A0A0B",
  disabledBg: "#2A322E",
  disabledFg: "#A6B0AA",
  chip: {
    ok: { bg: "#1B3326", fg: "#8FD9AE" },
    warn: { bg: "#3A2A14", fg: "#F2C185" },
    unsupported: { bg: "#2B2842", fg: "#C3BAF0" },
    info: { bg: "#1B2C3D", fg: "#A9C8E6" },
    neutral: { bg: "#27302C", fg: "#C4CCC7" },
  },
  note: { bg: "#1B2C3D", fg: "#A9C8E6", border: "#3C5A78" },
  banner: {
    ok: { bg: "#1B3326", fg: "#8FD9AE" },
    warn: { bg: "#3A2A14", fg: "#F2C185" },
    unsupported: { bg: "#2B2842", fg: "#C3BAF0" },
    info: { bg: "#1B2C3D", fg: "#A9C8E6" },
    neutral: { bg: "#27302C", fg: "#C4CCC7" },
  },
};

export const COLORS: Record<Scheme, Colors> = { light: LIGHT, dark: DARK };

export const SPACE = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24 } as const;

export const RADIUS = { chip: 8, button: 10, segment: 12, card: 14 } as const;

export const FONT = { sans: "IBM Plex Sans", mono: "IBM Plex Mono" } as const;

export interface TextStyleToken {
  fontFamily: string;
  fontSize: number;
  fontWeight: "400" | "500" | "600" | "700";
  lineHeight?: number;
  letterSpacing?: number;
  textTransform?: "uppercase";
}

export const TYPE = {
  title: { fontFamily: FONT.sans, fontSize: 26, fontWeight: "700", lineHeight: 32 },
  detailTitle: { fontFamily: FONT.sans, fontSize: 22, fontWeight: "700", lineHeight: 28 },
  name: { fontFamily: FONT.sans, fontSize: 17, fontWeight: "600", lineHeight: 23 },
  body: { fontFamily: FONT.sans, fontSize: 15, fontWeight: "400", lineHeight: 21 },
  bodyStrong: { fontFamily: FONT.sans, fontSize: 15, fontWeight: "600", lineHeight: 21 },
  small: { fontFamily: FONT.sans, fontSize: 13, fontWeight: "400", lineHeight: 18 },
  label: { fontFamily: FONT.sans, fontSize: 13, fontWeight: "600", lineHeight: 18 },
  section: {
    fontFamily: FONT.sans,
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 16,
    letterSpacing: 0.72,
    textTransform: "uppercase",
  },
  mono: { fontFamily: FONT.mono, fontSize: 15, fontWeight: "400", lineHeight: 21 },
  monoSmall: { fontFamily: FONT.mono, fontSize: 12, fontWeight: "400", lineHeight: 17 },
} as const satisfies Record<string, TextStyleToken>;

export type TextVariant = keyof typeof TYPE;

export type TextPair = readonly [fg: string, bg: string, use: string];

function textPairs(c: Colors): readonly TextPair[] {
  const pairs: TextPair[] = [
    [c.text, c.ground, "body on ground"],
    [c.text, c.surface, "body on surface"],
    [c.textMuted, c.ground, "muted on ground"],
    [c.textMuted, c.surface, "muted on surface"],
    [c.textMuted, c.segmentTrack, "muted on segment track"],
    [c.textSubtle, c.segmentTrack, "unselected segment on track"],
    [c.textSubtle, c.surface, "subtle on surface"],
    [c.text, c.segmentSelected, "selected segment"],
    [c.accent, c.surface, "accent on surface (nav, links, headings)"],
    [c.accent, c.ground, "accent on ground"],
    [c.onAccent, c.accent, "primary button"],
    [c.accentPressed, c.surface, "accent pressed on surface"],
    [c.onAccent, c.accentPressed, "primary button pressed"],
    [c.danger, c.surface, "danger text on surface"],
    [c.danger, c.ground, "danger text on ground"],
    [c.onDanger, c.danger, "danger button"],
    [c.disabledFg, c.disabledBg, "disabled button"],
    [c.note.fg, c.note.bg, "note"],
  ];
  for (const tone of Object.keys(c.chip) as Tone[]) {
    pairs.push([c.chip[tone].fg, c.chip[tone].bg, `chip ${tone}`]);
    pairs.push([c.banner[tone].fg, c.banner[tone].bg, `banner ${tone}`]);
    pairs.push([c.chip[tone].fg, c.surface, `chip ${tone} foreground on surface`]);
  }
  return pairs;
}

/** Every foreground/background combination a component uses for text (plan D-11). */
export const TEXT_PAIRS: Record<Scheme, readonly TextPair[]> = {
  light: textPairs(LIGHT),
  dark: textPairs(DARK),
};
