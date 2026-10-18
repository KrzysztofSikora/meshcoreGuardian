import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { TelemetrySample, VoltagePoint } from "@guardian/domain";

import { voltageCard } from "../application/nodes/voltage-presenter";
import { formatTime } from "./node-row";
import { tr } from "./translate";
import { Card, SectionHeading } from "./ui/card";
import { EDGE_PX, VoltageChart, Y_AXIS_WIDTH } from "./voltage-chart";
import { useStyles, useTheme } from "../theme/theme-provider";

// Card padding (16 + 16) and the border (1 + 1) around the chart area.
const CARD_CHROME = 34;

const formatDay = (ms: number): string =>
  new Date(ms).toLocaleDateString(undefined, { month: "numeric", day: "numeric" });
const formatClock = (ms: number): string =>
  new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

/** Battery voltage over time with the trend line and an accessible list of every point (FR-12). */
export function VoltageCard({
  samples,
  voltage,
}: {
  samples: readonly TelemetrySample[];
  voltage: readonly VoltagePoint[];
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [width, setWidth] = useState(0);
  const [open, setOpen] = useState(false);
  const styles = useStyles((th) => ({
    small: { ...th.type.small },
    body: { ...th.type.body },
    strong: { ...th.type.bodyStrong },
    row: { flexDirection: "row", justifyContent: "space-between", gap: th.space.md },
    toggle: { minHeight: 44, justifyContent: "center" },
  }));

  const plotWidth = Math.max(0, width - CARD_CHROME - Y_AXIS_WIDTH - 2 * EDGE_PX);
  const model = voltageCard({ samples, voltage }, formatTime, plotWidth, { date: formatDay, time: formatClock });

  return (
    <View testID="voltage-card" onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <Card>
        <SectionHeading>{t("battery.title")}</SectionHeading>
        {model.kind !== "chart" ? (
          <Text style={[styles.body, { color: colors.textMuted }]}>{tr(t, model.text)}</Text>
        ) : (
          <>
            {plotWidth > 0 && (
              <VoltageChart model={model.chart} summary={tr(t, model.summary)} plotWidth={plotWidth} />
            )}
            <Text style={[styles.strong, { color: colors.text }]}>{tr(t, model.trend)}</Text>
            {model.trendDetail !== null && (
              <Text style={[styles.small, { color: colors.textMuted }]}>{tr(t, model.trendDetail)}</Text>
            )}
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: open }}
              onPress={() => setOpen((v) => !v)}
              style={styles.toggle}
            >
              <Text style={[styles.strong, { color: colors.accent }]}>
                {t(open ? "battery.hideValues" : "battery.showValues")}
              </Text>
            </Pressable>
            {open &&
              model.rows.map((row, index) => (
                <View key={index} testID={`voltage-row-${index}`} style={styles.row} accessible>
                  <Text style={[styles.body, { color: colors.text, flexShrink: 1 }]}>{tr(t, row.time)}</Text>
                  <Text style={[styles.strong, { color: colors.text }]}>{tr(t, row.value)}</Text>
                  <Text style={[styles.small, { color: colors.textMuted, flexShrink: 1 }]}>
                    {tr(t, row.source)}
                  </Text>
                </View>
              ))}
          </>
        )}
      </Card>
    </View>
  );
}
