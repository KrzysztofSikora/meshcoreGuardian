import { Text, View } from "react-native";

import type { Tone } from "../../theme/tokens";
import { useStyles, useTheme } from "../../theme/theme-provider";
import { Icon, type IconName } from "./icons";

/** Pill with icon and words, never colour alone (NFR-05). */
export function StatusChip({ tone, icon, label }: { tone: Tone; icon: IconName; label: string }) {
  const { colors } = useTheme();
  const styles = useStyles((th) => ({
    chip: {
      flexDirection: "row",
      alignItems: "center",
      alignSelf: "flex-start",
      gap: 6,
      paddingVertical: 4,
      paddingHorizontal: 10,
      borderRadius: th.radius.chip,
    },
    label: { ...th.type.label, flexShrink: 1 },
  }));
  const { bg, fg } = colors.chip[tone];
  return (
    <View style={[styles.chip, { backgroundColor: bg }]} accessible accessibilityLabel={label}>
      <Icon name={icon} size={15} color={fg} />
      <Text style={[styles.label, { color: fg }]}>{label}</Text>
    </View>
  );
}
