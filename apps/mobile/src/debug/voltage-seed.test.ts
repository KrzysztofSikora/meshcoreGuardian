import { describe, expect, it } from "vitest";

import { samplesFromChecks, voltagePoints, voltageTrend } from "@guardian/domain";

import { voltageSeedRuns } from "./voltage-seed";

const NOW = 1_800_000_000_000;
const COMPANION = { publicKey: "ef".repeat(32), name: "Companion", firmwareVersion: "v1.17.1" };

describe("voltageSeedRuns", () => {
  const runs = voltageSeedRuns(NOW, "aa".repeat(32), COMPANION);

  it("gives six responded runs that all end before now", () => {
    expect(runs).toHaveLength(6);
    for (const run of runs) {
      expect(run.result).toBe("RESPONDED");
      expect(run.finishedAt).toBeLessThan(NOW);
    }
  });

  it("passes the A-01 gate and trends falling", () => {
    const readings = runs.flatMap((run, i) =>
      samplesFromChecks(run.checks, run.finishedAt).flatMap((s) =>
        s.voltageV === null
          ? []
          : [{ runId: i + 1, source: s.source, measuredAt: s.measuredAt, voltageV: s.voltageV }],
      ),
    );
    const trend = voltageTrend(voltagePoints(readings));
    expect(trend.kind).toBe("falling");
    expect(trend.count).toBe(6);
    if (trend.kind !== "insufficient") expect(trend.changeV).toBeCloseTo(-0.1, 1);
  });
});
