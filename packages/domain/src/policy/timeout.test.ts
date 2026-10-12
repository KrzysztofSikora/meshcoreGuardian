import { describe, expect, it } from "vitest";

import {
  OVERRIDE_RANGE_MS,
  TIMEOUT_CAP_MS,
  TIMEOUT_DEFAULT_MS,
  TIMEOUT_FLOOR_MS,
  TIMEOUT_MARGIN,
  attemptTimeout,
} from "./timeout";

describe("attemptTimeout", () => {
  it("keeps the constants the PRD fixes", () => {
    expect(TIMEOUT_CAP_MS).toBe(30_000);
    expect(TIMEOUT_FLOOR_MS).toBe(5_000);
    expect(TIMEOUT_DEFAULT_MS).toBe(15_000);
    expect(TIMEOUT_MARGIN).toBe(2);
    expect(OVERRIDE_RANGE_MS).toEqual([5_000, 60_000]);
  });

  it.each([
    [null, 15_000, "default"],
    [undefined, 15_000, "default"],
    [0, 15_000, "default"],
    [-1, 15_000, "default"],
    [1, 5_000, "estimate"],
    [2_499, 5_000, "estimate"],
    [2_500, 5_000, "estimate"],
    [2_694, 5_388, "estimate"],
    [14_999, 29_998, "estimate"],
    [15_000, 30_000, "estimate"],
    [15_001, 30_000, "estimate"],
    [1_000_000, 30_000, "estimate"],
  ] as const)("estimate %s ms gives %s ms (%s)", (estimateMs, ms, source) => {
    expect(attemptTimeout({ estimateMs, overrideMs: null })).toEqual({ ms, source });
  });

  it.each([5_000, 5_001, 20_000, 59_999, 60_000])("an override of %s ms wins", (overrideMs) => {
    expect(attemptTimeout({ estimateMs: 2_694, overrideMs })).toEqual({
      ms: overrideMs,
      source: "override",
    });
  });

  it.each([4_999, 60_001, 0, -5, Number.NaN])("rejects an override of %s ms", (overrideMs) => {
    expect(() => attemptTimeout({ estimateMs: null, overrideMs })).toThrow(RangeError);
  });

  it("treats a missing override as none", () => {
    expect(attemptTimeout({ estimateMs: 3_000 })).toEqual({ ms: 6_000, source: "estimate" });
  });
});
