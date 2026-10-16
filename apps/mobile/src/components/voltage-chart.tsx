import { View } from "react-native";
import { LineChart } from "react-native-gifted-charts/dist/LineChart";

import type { ChartModel } from "../application/nodes/voltage-presenter";
import { useTheme } from "../theme/theme-provider";

export const Y_AXIS_WIDTH = 44;
const CHART_HEIGHT = 140;
const POINT_RADIUS = 4;
/** Room left and right of the plot so the end points and their labels are not cut off. */
export const EDGE_PX = 20;

/**
 * The line chart of the voltage points (D-6). The only file that imports gifted-charts, through the
 * deep path so its gradient-based bar charts and their native peer are never loaded. The presenter
 * already computed the geometry; the summary label is the accessible name of the whole chart.
 */
export function VoltageChart({
  model,
  summary,
  plotWidth,
}: {
  model: ChartModel;
  summary: string;
  plotWidth: number;
}) {
  // gifted-charts adds both edges to the width it draws, so the view is as wide as all three.
  const single = model.points.length === 1;
  const { colors } = useTheme();
  const textStyle = { color: colors.textMuted, fontSize: 11 };
  return (
    <View accessible accessibilityLabel={summary} importantForAccessibility="yes">
      <LineChart
        data={model.points.map((p) => ({
          value: p.value,
          spacing: p.spacing,
          label: p.label ?? "",
          labelTextStyle: { ...textStyle, width: 44 },
        }))}
        yAxisOffset={model.yMin}
        maxValue={model.yMax - model.yMin}
        stepValue={model.step}
        noOfSections={model.yLabels.length - 1}
        showFractionalValues
        roundToDigits={2}
        yAxisLabelWidth={Y_AXIS_WIDTH}
        yAxisTextStyle={textStyle}
        yAxisColor={colors.border}
        xAxisColor={colors.borderStrong}
        rulesColor={colors.border}
        height={CHART_HEIGHT}
        width={plotWidth + 2 * EDGE_PX}
        initialSpacing={single ? EDGE_PX + plotWidth / 2 : EDGE_PX}
        endSpacing={EDGE_PX}
        color={colors.accent}
        thickness={2}
        dataPointsColor={colors.accent}
        dataPointsRadius={POINT_RADIUS}
        isAnimated={false}
        disableScroll
      />
    </View>
  );
}
