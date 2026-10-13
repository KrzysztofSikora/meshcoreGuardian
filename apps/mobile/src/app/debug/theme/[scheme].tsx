import { Redirect, useLocalSearchParams } from "expo-router";
import { useEffect } from "react";

import { container } from "../../../composition";
import { useSetThemeOverride } from "../../../theme/theme-provider";

/**
 * `guardian://debug/theme/<light|dark|system>` forces the colour scheme for an e2e screenshot
 * (plan D-8). In a BLE build it does nothing and goes to the Dashboard.
 */
export default function ThemeRoute() {
  const { scheme } = useLocalSearchParams<{ scheme: string }>();
  const setOverride = useSetThemeOverride();
  const valid = container.platform.fake !== null && ["light", "dark", "system"].includes(scheme);

  useEffect(() => {
    if (!valid) return;
    setOverride(scheme === "system" ? null : (scheme as "light" | "dark"));
  }, [valid, scheme, setOverride]);

  return <Redirect href="/" />;
}
