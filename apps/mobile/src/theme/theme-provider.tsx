import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { StyleSheet, useColorScheme } from "react-native";

import { COLORS, FONT, RADIUS, SPACE, TYPE, type Colors, type Scheme } from "./tokens";

export interface Theme {
  scheme: Scheme;
  colors: Colors;
  type: typeof TYPE;
  space: typeof SPACE;
  radius: typeof RADIUS;
  font: typeof FONT;
}

interface ThemeContextValue {
  scheme: Scheme;
  setOverride: (scheme: Scheme | null) => void;
}

const ThemeContext = createContext<ThemeContextValue>({ scheme: "light", setOverride: () => {} });

const THEMES: Record<Scheme, Theme> = {
  light: { scheme: "light", colors: COLORS.light, type: TYPE, space: SPACE, radius: RADIUS, font: FONT },
  dark: { scheme: "dark", colors: COLORS.dark, type: TYPE, space: SPACE, radius: RADIUS, font: FONT },
};

/** Follows the system colour scheme; the debug route can override it in memory (plan D-8). */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [override, setOverride] = useState<Scheme | null>(null);
  const scheme: Scheme = override ?? (system === "dark" ? "dark" : "light");
  const value = useMemo(() => ({ scheme, setOverride }), [scheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  return THEMES[useContext(ThemeContext).scheme];
}

export function useSetThemeOverride(): (scheme: Scheme | null) => void {
  return useContext(ThemeContext).setOverride;
}

/** Builds a style sheet from the theme, recomputed only when the scheme changes. */
export function useStyles<T extends StyleSheet.NamedStyles<T>>(factory: (theme: Theme) => T): T {
  const theme = useTheme();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the factory is static per call site; the scheme is the only input
  return useMemo(() => StyleSheet.create(factory(theme)), [theme]);
}
