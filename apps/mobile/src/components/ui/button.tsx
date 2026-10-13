import { Pressable, Text, View, type AccessibilityState } from "react-native";

import { useStyles, useTheme } from "../../theme/theme-provider";
import { Icon, type IconName } from "./icons";

export type ButtonVariant = "primary" | "secondary" | "danger";

interface Props {
  title: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  icon?: IconName;
  disabled?: boolean;
  fullWidth?: boolean;
  accessibilityLabel?: string;
  accessibilityState?: AccessibilityState;
  testID?: string;
}

/** Primary, secondary and danger buttons; at least 44 dp high, found by their text in e2e flows. */
export function AppButton({
  title,
  onPress,
  variant = "primary",
  icon,
  disabled = false,
  fullWidth = false,
  accessibilityLabel,
  accessibilityState,
  testID,
}: Props) {
  const { colors } = useTheme();
  const styles = useStyles((th) => ({
    base: {
      minHeight: 44,
      paddingHorizontal: th.space.lg,
      paddingVertical: th.space.sm,
      borderRadius: th.radius.button,
      alignItems: "center",
      justifyContent: "center",
    },
    full: { minHeight: 48, alignSelf: "stretch" },
    inner: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: th.space.sm },
    label: { ...th.type.bodyStrong, textAlign: "center", flexShrink: 1 },
  }));

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ ...accessibilityState, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => {
        let bg = colors.surface;
        let border = colors.borderStrong;
        if (variant === "primary") {
          bg = pressed ? colors.accentPressed : colors.accent;
          border = bg;
        } else if (variant === "danger") {
          bg = colors.danger;
          border = bg;
        } else if (pressed) {
          bg = colors.segmentTrack;
        }
        if (disabled) {
          bg = colors.disabledBg;
          border = colors.disabledBg;
        }
        return [styles.base, fullWidth && styles.full, { backgroundColor: bg, borderColor: border, borderWidth: 1 }];
      }}
    >
      {(() => {
        const fg = disabled
          ? colors.disabledFg
          : variant === "primary"
            ? colors.onAccent
            : variant === "danger"
              ? colors.onDanger
              : colors.text;
        return (
          <View style={styles.inner}>
            {icon !== undefined && <Icon name={icon} size={16} color={fg} />}
            <Text style={[styles.label, { color: fg }]}>{title}</Text>
          </View>
        );
      })()}
    </Pressable>
  );
}
