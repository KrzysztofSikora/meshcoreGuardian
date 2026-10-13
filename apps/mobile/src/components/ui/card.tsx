import type { ReactNode } from "react";
import { Text, View } from "react-native";

import { useStyles, useTheme } from "../../theme/theme-provider";

export type CardVariant = "default" | "accent" | "dashed";

export function Card({
  children,
  variant = "default",
  testID,
}: {
  children: ReactNode;
  variant?: CardVariant;
  testID?: string;
}) {
  const { colors } = useTheme();
  const styles = useStyles((th) => ({
    card: {
      borderWidth: 1,
      borderRadius: th.radius.card,
      padding: th.space.lg,
      gap: th.space.sm,
    },
  }));
  const border = variant === "accent" ? colors.accent : colors.border;
  return (
    <View
      testID={testID}
      style={[
        styles.card,
        {
          backgroundColor: colors.surface,
          borderColor: variant === "dashed" ? colors.borderStrong : border,
          borderStyle: variant === "dashed" ? "dashed" : "solid",
        },
      ]}
    >
      {children}
    </View>
  );
}

export function SectionHeading({ children, accent = false }: { children: ReactNode; accent?: boolean }) {
  const { colors } = useTheme();
  const styles = useStyles((th) => ({ heading: { ...th.type.section } }));
  return (
    <Text accessibilityRole="header" style={[styles.heading, { color: accent ? colors.accent : colors.textMuted }]}>
      {children}
    </Text>
  );
}
