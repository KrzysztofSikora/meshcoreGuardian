import type { RunStatus as Status } from "@guardian/domain";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { statusGlyph, statusText } from "../application/diagnostics/presenter";
import { tr } from "./translate";

/** The last-run status as a glyph plus words, never colour alone (FR-11, NFR-05). */
export function RunStatus({ status }: { status: Status }) {
  const { t } = useTranslation();
  const label = tr(t, statusText(status));
  return (
    <View style={styles.row} accessible accessibilityLabel={label}>
      <Text accessibilityElementsHidden importantForAccessibility="no" style={styles.glyph}>
        {statusGlyph(status)}
      </Text>
      <Text>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  glyph: { fontSize: 16, width: 20, textAlign: "center" },
});
