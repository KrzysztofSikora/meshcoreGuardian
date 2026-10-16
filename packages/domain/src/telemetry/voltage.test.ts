import { describe, expect, it } from "vitest";

import {
  TREND_MIN_SPAN_MS,
  voltagePoints,
  voltageTrend,
  type VoltagePoint,
  type VoltageReading,
} from "./voltage";

const H = 3_600_000;
const reading = (over: Partial<VoltageReading> = {}): VoltageReading => ({
  runId: 1,
  source: "status",
  measuredAt: 1000,
  voltageV: 3.35,
  ...over,
});
const point = (at: number, voltageV: number, runId = at): VoltagePoint => ({
  runId,
  source: "status",
  at,
  voltageV,
});
/** `n` points evenly spread over `spanMs`, voltage from `v0` linearly by `dv`. */
const series = (n: number, spanMs: number, v0: number, dv: number, base = 0): VoltagePoint[] =>
  Array.from({ length: n }, (_, i) =>
    point(base + (spanMs * i) / (n - 1), v0 + (dv * i) / (n - 1), i + 1),
  );

describe("voltagePoints", () => {
  it("takes the status reading of a run that has both", () => {
    const out = voltagePoints([
      reading({ source: "telemetry", voltageV: 3.35, measuredAt: 2000 }),
      reading({ source: "status", voltageV: 3.353, measuredAt: 1000 }),
    ]);
    expect(out).toEqual([{ runId: 1, source: "status", at: 1000, voltageV: 3.353 }]);
  });

  it("keeps the status reading whichever order the run's readings arrive in", () => {
    const status = reading({ source: "status", voltageV: 3.353, measuredAt: 1000 });
    const telemetry = reading({ source: "telemetry", voltageV: 3.35, measuredAt: 2000 });
    for (const readings of [
      [status, telemetry],
      [telemetry, status],
    ]) {
      expect(voltagePoints(readings)).toEqual([
        { runId: 1, source: "status", at: 1000, voltageV: 3.353 },
      ]);
    }
  });

  it("keeps the first of two telemetry readings of one run", () => {
    const out = voltagePoints([
      reading({ source: "telemetry", voltageV: 3.3, measuredAt: 1000 }),
      reading({ source: "telemetry", voltageV: 3.1, measuredAt: 2000 }),
    ]);
    expect(out).toEqual([{ runId: 1, source: "telemetry", at: 1000, voltageV: 3.3 }]);
  });

  it("falls back to telemetry when a run has no status reading", () => {
    const out = voltagePoints([reading({ source: "telemetry", measuredAt: 2000 })]);
    expect(out).toEqual([{ runId: 1, source: "telemetry", at: 2000, voltageV: 3.35 }]);
  });

  it("sorts by time, then by run id", () => {
    const out = voltagePoints([
      reading({ runId: 3, measuredAt: 500 }),
      reading({ runId: 2, measuredAt: 500 }),
      reading({ runId: 1, measuredAt: 900 }),
      reading({ runId: 4, measuredAt: 100 }),
    ]);
    expect(out.map((p) => p.runId)).toEqual([4, 2, 3, 1]);
  });

  it.each([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["zero", 0],
    ["negative", -3.3],
  ])("drops a %s voltage", (_name, voltageV) => {
    expect(voltagePoints([reading({ voltageV })])).toEqual([]);
  });

  it("drops a non-finite time and returns [] for no readings", () => {
    expect(voltagePoints([reading({ measuredAt: Number.NaN })])).toEqual([]);
    expect(voltagePoints([])).toEqual([]);
  });

  it("does not let an unusable status reading hide a usable telemetry one", () => {
    const out = voltagePoints([
      reading({ source: "status", voltageV: 0 }),
      reading({ source: "telemetry", voltageV: 3.3 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]?.source).toBe("telemetry");
  });
});

describe("voltageTrend gate (TR-17, A-01)", () => {
  it.each([
    ["no points", [] as VoltagePoint[], 0, 0],
    ["one point", [point(5, 3.3)], 1, 0],
    ["4 points over 48 h", series(4, 48 * H, 4, -0.5), 4, 48 * H],
    ["5 points over 23 h 59 min", series(5, 24 * H - 60_000, 4, -0.5), 5, 24 * H - 60_000],
  ])("%s → insufficient", (_name, points, count, spanMs) => {
    expect(voltageTrend(points)).toEqual({ kind: "insufficient", count, spanMs });
  });

  it("5 points over exactly 24 h give a trend", () => {
    const t = voltageTrend(series(5, TREND_MIN_SPAN_MS, 4, -0.5));
    expect(t.kind).toBe("falling");
    expect(t).toMatchObject({ count: 5, spanMs: TREND_MIN_SPAN_MS });
  });
});

describe("voltageTrend kinds (D-3)", () => {
  it("falling beyond the band, with the fitted change", () => {
    const t = voltageTrend(series(6, 72 * H, 4.0, -0.1));
    expect(t.kind).toBe("falling");
    if (t.kind === "insufficient") throw new Error("expected a trend");
    expect(t.changeV).toBeCloseTo(-0.1, 9);
  });

  it("fits a least-squares line through uneven readings", () => {
    const volts = [4.0, 3.9, 3.95, 3.8, 3.85];
    const pts = volts.map((v, i) => point(1_760_000_000_000 + i * 6 * H, v, i + 1));
    const t = voltageTrend(pts);
    if (t.kind === "insufficient") throw new Error("expected a trend");
    expect(t.kind).toBe("falling");
    expect(t.changeV).toBeCloseTo(-0.16, 9);
    expect(t.spanMs).toBe(24 * H);
    expect(t.count).toBe(5);
  });

  it("rising beyond the band", () => {
    const t = voltageTrend(series(6, 72 * H, 3.9, 0.1));
    expect(t.kind).toBe("rising");
    if (t.kind === "insufficient") throw new Error("expected a trend");
    expect(t.changeV).toBeCloseTo(0.1, 9);
  });

  it.each([
    [-0.049, "stable"],
    [-0.051, "falling"],
    [0.049, "stable"],
    [0.051, "rising"],
    [0, "stable"],
  ])("a fitted change of %s is %s (|change| < 0.05 is stable)", (dv, kind) => {
    expect(voltageTrend(series(5, 48 * H, 3.8, dv)).kind).toBe(kind);
  });

  it("one outlier in the middle of a steady series stays stable", () => {
    const pts = series(7, 72 * H, 3.8, 0);
    pts[3] = { ...(pts[3] as VoltagePoint), voltageV: 3.5 };
    expect(voltageTrend(pts).kind).toBe("stable");
  });

  it("keeps precision with epoch-ms times", () => {
    const t = voltageTrend(series(6, 72 * H, 4.0, -0.1, 1_760_000_000_000));
    if (t.kind === "insufficient") throw new Error("expected a trend");
    expect(t.changeV).toBeCloseTo(-0.1, 6);
  });

  it("points at one instant cannot reach the gate", () => {
    expect(voltageTrend(series(5, 0, 3.8, 0)).kind).toBe("insufficient");
  });

  it("has exactly the keys kind, changeV, spanMs, count and no prediction (AC3)", () => {
    const t = voltageTrend(series(6, 72 * H, 4.0, -0.1));
    expect(Object.keys(t).sort()).toEqual(["changeV", "count", "kind", "spanMs"]);
    expect(Object.keys(voltageTrend([])).sort()).toEqual(["count", "kind", "spanMs"]);
  });
});
