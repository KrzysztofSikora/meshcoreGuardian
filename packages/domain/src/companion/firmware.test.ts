import { describe, expect, it } from "vitest";

import { TESTED_FIRMWARE, isTestedFirmware } from "./firmware";

describe("TESTED_FIRMWARE", () => {
  it("records the 1.17 line verified in S-01", () => {
    expect(TESTED_FIRMWARE).toEqual(["1.17"]);
  });
});

describe("isTestedFirmware", () => {
  it.each([
    ["v1.17.1-d929643", true],
    ["1.17.0", true],
    ["v1.17", true],
    ["v1.16.2", false],
    ["v1.170.0", false],
    ["v2.17.0", false],
    ["v11.17.0", false],
    ["x1.17.0", false],
    ["garbage", false],
    ["", false],
  ])("%s → %s", (version, expected) => {
    expect(isTestedFirmware(version)).toBe(expected);
  });
});
