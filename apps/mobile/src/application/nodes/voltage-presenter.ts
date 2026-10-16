import {
  TREND_MIN_SAMPLES,
  TREND_STABLE_BAND_V,
  voltageTrend,
  type TelemetrySample,
  type VoltagePoint,
  type VoltageTrend,
} from "@guardian/domain";

import type { Text } from "./presenter";

export interface ChartPoint {
  value: number;
  /** Pixels to the next point; 0 for the last one. */
  spacing: number;
  /** Only the first and last point carry a time label (D-7). */
  label: string | null;
}

export interface ChartModel {
  points: ChartPoint[];
  yMin: number;
  yMax: number;
  step: number;
  /** Bottom to top, 2 decimals. */
  yLabels: string[];
}

export interface VoltageRow {
  time: Text;
  value: Text;
  source: Text;
}

export type VoltageCardModel =
  | { kind: "none"; text: Text }
  | { kind: "unavailable"; text: Text }
  | {
      kind: "chart";
      title: Text;
      summary: Text;
      chart: ChartModel;
      trend: Text;
      trendDetail: Text | null;
      rows: VoltageRow[];
    };

const MIN_GAP_PX = 6;
const Y_UNIT = 0.05;
const Y_MIN_UNITS = 4;
const Y_SECTIONS = 4;
const MINUS = "−";

/** Rounds away binary noise so 3.35 / 0.05 floors and ceils as a person expects. */
const clean = (n: number): number => Math.round(n * 1e6) / 1e6;

function spanParams(ms: number): Record<string, string | number> {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  if (days > 0) return { spanKind: "dh", days, hours };
  if (hours > 0) return { spanKind: "hm", hours, minutes: minutes % 60 };
  return { spanKind: "m", minutes };
}

/** Signed, two decimals, a real minus sign: "−0.06", "+0.04". */
function signed(changeV: number): string {
  const text = Math.abs(changeV).toFixed(2);
  return changeV < 0 ? `${MINUS}${text}` : `+${text}`;
}

/** Describes the measured past only (D-4, FR-12 AC3). */
export function trendText(trend: VoltageTrend): { trend: Text; detail: Text | null } {
  if (trend.kind === "insufficient") {
    return {
      trend: { key: "battery.notEnough" },
      detail: {
        key: "battery.notEnoughDetail",
        params: { min: TREND_MIN_SAMPLES, count: trend.count, ...spanParams(trend.spanMs) },
      },
    };
  }
  const params: Record<string, string | number> = {
    count: trend.count,
    ...spanParams(trend.spanMs),
  };
  if (trend.kind === "stable") params.band = TREND_STABLE_BAND_V.toFixed(2);
  else params.change = signed(trend.changeV);
  return { trend: { key: `battery.trend.${trend.kind}`, params }, detail: null };
}

function yRange(values: readonly number[]): Pick<ChartModel, "yMin" | "yMax" | "step" | "yLabels"> {
  let lo = Math.floor(clean(Math.min(...values) / Y_UNIT));
  let hi = Math.ceil(clean(Math.max(...values) / Y_UNIT));
  if (hi - lo < Y_MIN_UNITS) {
    const extra = Y_MIN_UNITS - (hi - lo);
    lo -= Math.floor(extra / 2);
    hi += Math.ceil(extra / 2);
  }
  // Whole units per section, so every label lands on the 0.05 V grid.
  hi += (Y_SECTIONS - ((hi - lo) % Y_SECTIONS)) % Y_SECTIONS;
  const unitsPerSection = (hi - lo) / Y_SECTIONS;
  const yMin = clean(lo * Y_UNIT);
  const step = clean(unitsPerSection * Y_UNIT);
  return {
    yMin,
    yMax: clean(hi * Y_UNIT),
    step,
    yLabels: Array.from({ length: Y_SECTIONS + 1 }, (_, i) => (yMin + i * step).toFixed(2)),
  };
}

/** Distance to the next point in proportion to the time between them (D-7). */
function spacings(points: readonly VoltagePoint[], plotWidth: number): number[] {
  const first = points[0];
  const last = points[points.length - 1];
  if (first === undefined || last === undefined || points.length < 2) return points.map(() => 0);
  const span = last.at - first.at;
  const shares = points.slice(1).map((p, i) => {
    const prev = points[i];
    return span === 0 || prev === undefined ? 1 / (points.length - 1) : (p.at - prev.at) / span;
  });
  // Gaps under the minimum stay at the minimum; the others give up the width that takes.
  const small = shares.filter((share) => share * plotWidth < MIN_GAP_PX).length;
  const room = plotWidth - small * MIN_GAP_PX;
  const largeTotal = shares.reduce(
    (s, share) => (share * plotWidth < MIN_GAP_PX ? s : s + share),
    0,
  );
  const scale = largeTotal * plotWidth > room && room > 0 ? room / (largeTotal * plotWidth) : 1;
  const gaps = shares.map((share) =>
    share * plotWidth < MIN_GAP_PX ? MIN_GAP_PX : share * plotWidth * scale,
  );
  const total = gaps.reduce((s, g) => s + g, 0);
  // Too many points for the minimum gap: keep the total inside the plot instead.
  const fit = total > plotWidth && plotWidth > 0 ? plotWidth / total : 1;
  return [...gaps.map((g) => g * fit), 0];
}

function chartModel(
  points: readonly VoltagePoint[],
  formatTime: (ms: number) => string,
  plotWidth: number,
): ChartModel {
  const gaps = spacings(points, plotWidth);
  return {
    points: points.map((p, i) => ({
      value: p.voltageV,
      spacing: gaps[i] ?? 0,
      label: i === 0 || i === points.length - 1 ? formatTime(p.at) : null,
    })),
    ...yRange(points.map((p) => p.voltageV)),
  };
}

/**
 * The battery voltage card (D-5). The caller passes only loaded history: `samples` empty means
 * the node never answered, samples without a voltage point means replies lacked voltage (AC4).
 */
export function voltageCard(
  input: { samples: readonly TelemetrySample[]; voltage: readonly VoltagePoint[] },
  formatTime: (ms: number) => string,
  plotWidth: number,
): VoltageCardModel {
  const { samples, voltage } = input;
  if (voltage.length === 0) {
    return samples.length === 0
      ? { kind: "none", text: { key: "battery.none" } }
      : { kind: "unavailable", text: { key: "battery.unavailable" } };
  }
  const first = voltage[0]!;
  const last = voltage[voltage.length - 1]!;
  const values = voltage.map((p) => p.voltageV);
  const { trend, detail } = trendText(voltageTrend(voltage));
  return {
    kind: "chart",
    title: { key: "battery.title" },
    summary: {
      key: "battery.summary",
      params: {
        count: voltage.length,
        first: formatTime(first.at),
        last: formatTime(last.at),
        min: Math.min(...values).toFixed(2),
        max: Math.max(...values).toFixed(2),
      },
    },
    chart: chartModel(voltage, formatTime, plotWidth),
    trend,
    trendDetail: detail,
    rows: [...voltage].reverse().map((p) => ({
      time: { key: "battery.time", params: { time: formatTime(p.at) } },
      value: { key: "battery.value", params: { value: p.voltageV.toFixed(2) } },
      source: { key: `battery.source.${p.source}` },
    })),
  };
}
