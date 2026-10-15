import { describe, expect, it } from "vitest";

import { lppMeaning } from "./lpp";

describe("lppMeaning", () => {
  it.each([
    [100, "generic", null],
    [101, "illuminance", "lx"],
    [102, "presence", null],
    [103, "temperature", "°C"],
    [104, "humidity", "%"],
    [115, "pressure", "hPa"],
    [116, "voltage", "V"],
    [117, "current", "A"],
    [120, "percentage", "%"],
    [125, "concentration", "ppm"],
    [128, "power", "W"],
    [136, "gps", null],
  ])("type %d is %s in %s", (type, name, unit) => {
    expect(lppMeaning(type)).toEqual({ name, unit });
  });

  it("gives an unknown type no unit", () => {
    expect(lppMeaning(200)).toEqual({ name: "lpp_200", unit: null });
  });
});
