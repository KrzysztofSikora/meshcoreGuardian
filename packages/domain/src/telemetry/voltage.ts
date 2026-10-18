import type { TelemetrySource } from "./samples";

/** Trend gate (A-01): fewer samples or a shorter span than this show no trend. */
export const TREND_MIN_SAMPLES = 5;
export const TREND_MIN_SPAN_MS = 24 * 3_600_000;
/** A fitted change smaller than this (in volts, absolute) counts as stable (D-3). */
export const TREND_STABLE_BAND_V = 0.05;

/** One stored voltage reading of a node, as the repository returns it. */
export interface VoltageReading {
  runId: number;
  source: TelemetrySource;
  measuredAt: number;
  voltageV: number;
}

/** One chart point: the battery as seen by one run (D-1). */
export interface VoltagePoint {
  runId: number;
  source: TelemetrySource;
  /** Epoch ms. */
  at: number;
  voltageV: number;
}

/** Describes the measured past only; it has no field that looks ahead (FR-12 AC3). */
export type VoltageTrend =
  | { kind: "insufficient"; count: number; spanMs: number }
  | { kind: "falling" | "rising" | "stable"; changeV: number; spanMs: number; count: number };

const usable = (r: VoltageReading): boolean =>
  Number.isFinite(r.voltageV) && r.voltageV > 0 && Number.isFinite(r.measuredAt);

/**
 * One point per run: the status reading when the run has one, else the telemetry reading.
 * Ordered by time, then run id. Unusable values are dropped.
 */
export function voltagePoints(readings: readonly VoltageReading[]): VoltagePoint[] {
  const byRun = new Map<number, VoltageReading>();
  for (const r of readings) {
    if (!usable(r)) continue;
    const kept = byRun.get(r.runId);
    if (kept === undefined || (kept.source !== "status" && r.source === "status")) {
      byRun.set(r.runId, r);
    }
  }
  return [...byRun.values()]
    .map((r) => ({ runId: r.runId, source: r.source, at: r.measuredAt, voltageV: r.voltageV }))
    .sort((a, b) => a.at - b.at || a.runId - b.runId);
}

/** Least-squares fitted change over the span of the points, or `insufficient` below the A-01 gate. */
export function voltageTrend(points: readonly VoltagePoint[]): VoltageTrend {
  const count = points.length;
  const first = points[0];
  const last = points[count - 1];
  const spanMs = first === undefined || last === undefined ? 0 : last.at - first.at;
  if (first === undefined || count < TREND_MIN_SAMPLES || spanMs < TREND_MIN_SPAN_MS) {
    return { kind: "insufficient", count, spanMs };
  }
  // Times relative to the first point keep precision (epoch ms squared would not).
  const xs = points.map((p) => p.at - first.at);
  const meanX = xs.reduce((s, x) => s + x, 0) / count;
  const meanY = points.reduce((s, p) => s + p.voltageV, 0) / count;
  let sxy = 0;
  let sxx = 0;
  xs.forEach((x, i) => {
    const p = points[i];
    if (p === undefined) return;
    sxy += (x - meanX) * (p.voltageV - meanY);
    sxx += (x - meanX) ** 2;
  });
  const changeV = sxx === 0 ? 0 : (sxy / sxx) * spanMs;
  const kind =
    Math.abs(changeV) < TREND_STABLE_BAND_V ? "stable" : changeV < 0 ? "falling" : "rising";
  return { kind, changeV, spanMs, count };
}
