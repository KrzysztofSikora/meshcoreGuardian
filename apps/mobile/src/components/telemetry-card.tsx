import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import type { TelemetryCardModel } from "../application/nodes/history-presenter";
import { tr } from "./translate";
import { Card, SectionHeading } from "./ui/card";
import { useStyles, useTheme } from "../theme/theme-provider";

/** Latest telemetry as label/value rows per source, with the measured time (FR-07). */
export function TelemetryCard({ model }: { model: TelemetryCardModel }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useStyles((th) => ({
    group: { gap: th.space.xs },
    row: { flexDirection: "row", justifyContent: "space-between", gap: th.space.md },
    label: { ...th.type.body, flexShrink: 1 },
    value: { ...th.type.bodyStrong, flexShrink: 0 },
    small: { ...th.type.small },
    strong: { ...th.type.bodyStrong },
  }));

  if ("empty" in model) {
    return (
      <Card testID="telemetry-card">
        <SectionHeading>{t("telemetry.heading")}</SectionHeading>
        <Text style={[styles.small, { color: colors.textMuted }]}>{tr(t, model.empty)}</Text>
      </Card>
    );
  }
  return (
    <Card testID="telemetry-card">
      <SectionHeading>{tr(t, model.heading)}</SectionHeading>
      <Text style={[styles.small, { color: colors.textMuted }]}>{tr(t, model.fromRun)}</Text>
      {model.groups.map((group) => (
        <View key={group.title.key} style={styles.group}>
          <Text style={[styles.strong, { color: colors.text }]}>{tr(t, group.title)}</Text>
          {group.measured !== null && (
            <Text style={[styles.small, { color: colors.textMuted }]}>{tr(t, group.measured)}</Text>
          )}
          {group.rows.map((row, index) => (
            <View key={index} style={styles.row}>
              <Text style={[styles.label, { color: colors.text }]}>{tr(t, row.label)}</Text>
              <Text style={[styles.value, { color: colors.text }]}>{tr(t, row.value)}</Text>
            </View>
          ))}
        </View>
      ))}
      {model.note !== null && <Text style={[styles.small, { color: colors.textMuted }]}>{tr(t, model.note)}</Text>}
    </Card>
  );
}
