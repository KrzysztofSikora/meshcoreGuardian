import type { ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useStyles, useTheme } from "../../theme/theme-provider";
import { BottomNav, type NavTab } from "./bottom-nav";

/** Ground, side padding, optional large title and optional bottom navigation. */
export function Screen({
  title,
  nav,
  scroll = false,
  titleAccessory,
  children,
}: {
  title?: string;
  nav?: NavTab;
  scroll?: boolean;
  titleAccessory?: ReactNode;
  children: ReactNode;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useStyles((th) => ({
    root: { flex: 1 },
    body: { flex: 1, paddingHorizontal: th.space.xl, gap: th.space.md },
    titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: th.space.md },
    title: { ...th.type.title, flexShrink: 1 },
  }));
  const top = nav !== undefined ? insets.top + 12 : 12;
  const content = (
    <>
      {title !== undefined && (
        <View style={styles.titleRow}>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>
            {title}
          </Text>
          {titleAccessory}
        </View>
      )}
      {children}
    </>
  );
  return (
    <View style={[styles.root, { backgroundColor: colors.ground }]}>
      {scroll ? (
        <ScrollView style={styles.root} contentContainerStyle={[styles.body, { paddingTop: top, paddingBottom: 24 }]}>
          {content}
        </ScrollView>
      ) : (
        <View style={[styles.body, { paddingTop: top }]}>{content}</View>
      )}
      {nav !== undefined && <BottomNav current={nav} />}
    </View>
  );
}
