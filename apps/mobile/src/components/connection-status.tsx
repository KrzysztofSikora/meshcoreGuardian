import type { ConnectionState } from "@guardian/domain";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

const GLYPH: Record<ConnectionState["kind"], string> = {
  disconnected: "○",
  connecting: "…",
  connected: "✓",
  failed: "✕",
};

/** One of four states as an icon glyph plus text, never colour alone (FR-01 AC5). */
export function ConnectionStatus({ connection }: { connection: ConnectionState }) {
  const { t } = useTranslation();
  const label = t(`connection.${connection.kind}`);
  return (
    <View style={styles.row} accessible accessibilityLabel={label}>
      <Text accessibilityElementsHidden importantForAccessibility="no" style={styles.glyph}>
        {GLYPH[connection.kind]}
      </Text>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  glyph: { fontSize: 18, width: 24, textAlign: "center" },
  label: { fontSize: 18, fontWeight: "600" },
});
