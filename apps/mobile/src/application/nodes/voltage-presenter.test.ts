import { describe, expect, it } from "vitest";

import type { TelemetrySample, VoltagePoint, VoltageTrend } from "@guardian/domain";

import { tr } from "../../components/translate";
import { i18n } from "../../i18n";
import type { Text } from "./presenter";
import { trendText, voltageCard } from "./voltage-presenter";

const HOUR = 3_600_000;
const fmt = (ms: number) => `T${ms}`;
const render = (text: Text) => tr(i18n.t, text);

const point = (at: number, voltageV: number, over: Partial<VoltagePoint> = {}): VoltagePoint => ({
  runId: at,
  source: "status",
  at,
  voltageV,
  ...over,
});

const sample = { runId: 1, checkSeq: 0, source: "status", measuredAt: 1 } as TelemetrySample;

const chart = (voltage: VoltagePoint[], width = 300) => {
  const model = voltageCard({ samples: [sample], voltage }, fmt, width);
  if (model.kind !== "chart") throw new Error(model.kind);
  return model;
};

describe("voltageCard states (FR-12 AC4, D-5)", () => {
  it("no samples at all is 'none', not the unavailable text", () => {
    const model = voltageCard({ samples: [], voltage: [] }, fmt, 300);
    expect(model.kind).toBe("none");
    expect(render((model as { text: Text }).text)).toBe("No voltage recorded yet.");
  });

  it("samples without any voltage point say the voltage is not available (AC4)", () => {
    const model = voltageCard({ samples: [sample], voltage: [] }, fmt, 300);
    expect(model.kind).toBe("unavailable");
    expect(render((model as { text: Text }).text)).toBe("Voltage not available from this node");
  });

  it("one point draws the chart with the AC2 sentence", () => {
    const model = chart([point(1000, 3.35)]);
    expect(render(model.title)).toBe("Battery voltage (V)");
    expect(render(model.trend)).toBe("Not enough data to determine trend");
    expect(render(model.trendDetail!)).toBe(
      "Needs at least 5 samples over 24 h; this node has 1 over 0 min.",
    );
  });
});

describe("trendText (D-4)", () => {
  const cases: [string, VoltageTrend, string][] = [
    [
      "falling",
      { kind: "falling", changeV: -0.0612, spanMs: 76 * HOUR, count: 7 },
      "Trend: falling, about −0.06 V over 3 d 4 h (7 samples)",
    ],
    [
      "rising",
      { kind: "rising", changeV: 0.04, spanMs: 30 * HOUR + 12 * 60_000, count: 5 },
      "Trend: rising, about +0.04 V over 1 d 6 h (5 samples)",
    ],
    [
      "stable",
      { kind: "stable", changeV: 0.01, spanMs: 5 * HOUR + 12 * 60_000, count: 9 },
      "Trend: stable, less than 0.05 V change over 5 h 12 min (9 samples)",
    ],
  ];
  it.each(cases)("%s", (_name, trend, expected) => {
    const { trend: text, detail } = trendText(trend);
    expect(render(text)).toBe(expected);
    expect(detail).toBeNull();
  });

  it("insufficient names the gate and what the node has", () => {
    const { trend, detail } = trendText({ kind: "insufficient", count: 4, spanMs: 90 * 60_000 });
    expect(render(trend)).toBe("Not enough data to determine trend");
    expect(render(detail!)).toBe(
      "Needs at least 5 samples over 24 h; this node has 4 over 1 h 30 min.",
    );
  });

  it("a span under an hour reads in minutes", () => {
    const { detail } = trendText({ kind: "insufficient", count: 2, spanMs: 59 * 60_000 + 59_000 });
    expect(render(detail!)).toContain("over 59 min.");
  });
});

describe("rows (FR-12 AC1)", () => {
  it("lists every point newest first with local time, volts and source", () => {
    const model = chart([
      point(1000, 3.353),
      point(2000, 3.3, { source: "telemetry" }),
      point(3000, 3.25),
    ]);
    expect(model.rows.map((r) => [render(r.time), render(r.value), render(r.source)])).toEqual([
      ["T3000", "3.25 V", "Status reply"],
      ["T2000", "3.30 V", "Telemetry reply"],
      ["T1000", "3.35 V", "Status reply"],
    ]);
  });

  it("the summary carries count, first and last time, lowest and highest", () => {
    const model = chart([point(1000, 3.4), point(2000, 3.1), point(3000, 3.2)]);
    expect(render(model.summary)).toBe(
      "Battery voltage chart, 3 samples from T1000 to T3000, lowest 3.10 V, highest 3.40 V.",
    );
  });
});

describe("chart geometry (D-7)", () => {
  it("spaces points in proportion to the time between them", () => {
    const { chart: c } = chart([point(0, 3.4), point(HOUR, 3.39), point(4 * HOUR, 3.38)], 300);
    expect(c.points.map((p) => p.spacing)).toEqual([75, 225, 0]);
  });

  it("gives close points at least the minimum gap and keeps the total inside the plot", () => {
    const close = chart([point(0, 3.4), point(1, 3.39), point(1000 * HOUR, 3.38)], 300).chart;
    expect(close.points[0]!.spacing).toBeGreaterThanOrEqual(6);
    const many = Array.from({ length: 50 }, (_, i) => point(i, 3.4));
    const total = chart(many, 200).chart.points.reduce((s, p) => s + p.spacing, 0);
    expect(total).toBeLessThanOrEqual(200 + 1e-9);
  });

  it("points sharing one time are spread evenly", () => {
    const { chart: c } = chart(
      [point(5, 3.4, { runId: 1 }), point(5, 3.3, { runId: 2 }), point(5, 3.2, { runId: 3 })],
      100,
    );
    expect(c.points.map((p) => p.spacing)).toEqual([50, 50, 0]);
  });

  it("a single point has no spacing", () => {
    expect(chart([point(1, 3.3)]).chart.points).toEqual([{ value: 3.3, spacing: 0, label: "T1" }]);
  });

  it("labels only the first and last point", () => {
    const { chart: c } = chart([point(1, 3.4), point(2, 3.39), point(3, 3.38), point(4, 3.37)]);
    expect(c.points.map((p) => p.label)).toEqual(["T1", null, null, "T4"]);
  });

  it("the y range covers every point on the 0.05 V grid with 4 sections", () => {
    const { chart: c } = chart([point(1, 3.07), point(2, 3.41), point(3, 3.35)]);
    expect([c.yMin, c.yMax, c.step]).toEqual([3.05, 3.45, 0.1]);
    expect(c.yLabels).toEqual(["3.05", "3.15", "3.25", "3.35", "3.45"]);
  });

  it("is at least 0.2 V tall and does not widen when a value sits on the grid", () => {
    const flat = chart([point(1, 3.35), point(2, 3.35)]).chart;
    expect(flat.yMax - flat.yMin).toBeCloseTo(0.2, 9);
    expect(flat.yMin).toBeLessThanOrEqual(3.35);
    expect(flat.yMax).toBeGreaterThanOrEqual(3.35);
    const onGrid = chart([point(1, 3.3), point(2, 3.5)]).chart;
    expect([onGrid.yMin, onGrid.yMax]).toEqual([3.3, 3.5]);
  });

  it("every label is a multiple of 0.05 with two decimals", () => {
    const { chart: c } = chart([point(1, 3.31), point(2, 3.37), point(3, 3.52)]);
    expect(c.yLabels).toHaveLength(5);
    for (const l of c.yLabels) expect(l).toMatch(/^\d\.\d[05]$/);
    expect(c.yLabels[0]).toBe(c.yMin.toFixed(2));
    expect(c.yLabels[4]).toBe(c.yMax.toFixed(2));
  });
});
