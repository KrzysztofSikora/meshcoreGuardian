import { useRouter } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";

import { useStyles, useTheme } from "../../theme/theme-provider";
import { Icon, type IconName } from "./icons";

export type NavTab = "dashboard" | "connect" | "settings";

const ITEMS: { id: NavTab; href: "/" | "/connect" | "/settings"; icon: IconName }[] = [
  { id: "dashboard", href: "/", icon: "grid" },
  { id: "connect", href: "/connect", icon: "bluetooth" },
  { id: "settings", href: "/settings", icon: "sliders" },
];

/** Bottom navigation of the three top-level screens (plan D-5); labels reuse the screen titles. */
export function BottomNav({ current }: { current: NavTab }) {
  const { t } = useTranslation();
  const router = useRouter();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useStyles((th) => ({
    bar: { flexDirection: "row", borderTopWidth: 1 },
    item: { flex: 1, minHeight: 60, alignItems: "center", justifyContent: "center", gap: 2 },
    label: { ...th.type.small, fontSize: 12, lineHeight: 16 },
  }));
  return (
    <View
      style={[
        styles.bar,
        { backgroundColor: colors.surface, borderTopColor: colors.border, paddingBottom: insets.bottom },
      ]}
    >
      {ITEMS.map((item) => {
        const selected = item.id === current;
        const color = selected ? colors.accent : colors.textMuted;
        return (
          <Pressable
            key={item.id}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => {
              if (selected) return;
              // Keep the stack at [index, tab]: back from any tab ends at the Dashboard.
              if (item.id === "dashboard") router.dismissTo("/");
              else if (current === "dashboard") router.push(item.href);
              else router.replace(item.href);
            }}
            style={styles.item}
          >
            <Icon name={item.icon} size={22} color={color} />
            <Text style={[styles.label, { color, fontWeight: selected ? "600" : "400" }]}>{t(`${item.id}.title`)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
