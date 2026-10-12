import { describe, expect, it } from "vitest";

import { COOLDOWN_MS, cooldownRemaining, cooldownRemainingAt } from "./cooldown";

describe("cooldownRemainingAt", () => {
  it("has no cooldown without a previous request", () => {
    expect(cooldownRemainingAt(null, 1_000)).toBe(0);
  });

  it.each([
    [0, 60_000],
    [1, 59_999],
    [59_999, 1],
    [60_000, 0],
    [60_001, 0],
  ])("%s ms after the request leaves %s ms", (elapsed, remaining) => {
    expect(cooldownRemainingAt(10_000, 10_000 + elapsed)).toBe(remaining);
  });

  it("does not go negative when the clock moves back", () => {
    expect(cooldownRemainingAt(10_000, 5_000)).toBe(COOLDOWN_MS);
  });
});

describe("cooldownRemaining", () => {
  it("has no cooldown for a node never tested", () => {
    expect(cooldownRemaining(null, 1_000)).toBe(0);
  });

  it("counts from the end of a run that wrote a request", () => {
    expect(cooldownRemaining({ attemptsUsed: 1, finishedAt: 100_000 }, 159_999)).toBe(1);
    expect(cooldownRemaining({ attemptsUsed: 1, finishedAt: 100_000 }, 160_000)).toBe(0);
  });

  it("ignores a run that sent nothing", () => {
    expect(cooldownRemaining({ attemptsUsed: 0, finishedAt: 100_000 }, 100_001)).toBe(0);
  });
});
