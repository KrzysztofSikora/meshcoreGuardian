import { describe, expect, it } from "vitest";

import {
  COMPASS_POINTS,
  advertisedPosition,
  compassPoint,
  distanceMeters,
  initialBearing,
} from "./geo";

const KRAKOW = { lat: 50.0647, lon: 19.945 };
const WARSAW = { lat: 52.2297, lon: 21.0122 };

describe("advertisedPosition", () => {
  it("keeps a real position", () => {
    expect(advertisedPosition(50.5, 19.25)).toEqual({ lat: 50.5, lon: 19.25 });
  });

  it("treats exactly 0,0 as not advertised", () => {
    expect(advertisedPosition(0, 0)).toBeNull();
  });

  it("keeps a position on one zero axis", () => {
    expect(advertisedPosition(0, 10)).toEqual({ lat: 0, lon: 10 });
    expect(advertisedPosition(10, 0)).toEqual({ lat: 10, lon: 0 });
  });

  it.each([
    [NaN, 1],
    [1, NaN],
    [Infinity, 1],
    [1, -Infinity],
    [90.0001, 1],
    [-90.0001, 1],
    [1, 180.0001],
    [1, -180.0001],
  ])("rejects %s,%s", (lat, lon) => {
    expect(advertisedPosition(lat, lon)).toBeNull();
  });

  it("accepts the limits", () => {
    expect(advertisedPosition(90, 180)).toEqual({ lat: 90, lon: 180 });
    expect(advertisedPosition(-90, -180)).toEqual({ lat: -90, lon: -180 });
  });
});

describe("distanceMeters", () => {
  it("is 0 for the same point", () => {
    expect(distanceMeters(KRAKOW, KRAKOW)).toBe(0);
  });

  it("measures Kraków to Warsaw within 0.5 % of 252 km", () => {
    const d = distanceMeters(KRAKOW, WARSAW);
    expect(Math.abs(d - 252_000) / 252_000).toBeLessThan(0.005);
  });

  it("is symmetric", () => {
    expect(distanceMeters(WARSAW, KRAKOW)).toBeCloseTo(distanceMeters(KRAKOW, WARSAW), 6);
  });

  it("measures one degree of latitude as about 111.2 km", () => {
    const d = distanceMeters({ lat: 10, lon: 20 }, { lat: 11, lon: 20 });
    expect(d).toBeGreaterThan(111_100);
    expect(d).toBeLessThan(111_300);
  });

  it("measures near-antipodal points as about half the circumference", () => {
    const d = distanceMeters({ lat: 0, lon: 0.5 }, { lat: 0, lon: 180 });
    expect(d).toBeGreaterThan(19_900_000);
    expect(d).toBeLessThan(20_100_000);
  });

  it("does not return NaN for exact antipodes", () => {
    const d = distanceMeters({ lat: 10, lon: 0 }, { lat: -10, lon: 180 });
    expect(d).toBeCloseTo(Math.PI * 6_371_008.8, -2);
  });
});

describe("initialBearing", () => {
  const origin = { lat: 50, lon: 20 };

  it.each([
    ["north", { lat: 51, lon: 20 }, 0],
    ["east", { lat: 50, lon: 21 }, 90],
    ["south", { lat: 49, lon: 20 }, 180],
    ["west", { lat: 50, lon: 19 }, 270],
  ] as const)("points %s", (_name, target, expected) => {
    expect(initialBearing(origin, target)).toBeCloseTo(expected, 0);
  });

  it("points Kraków to Warsaw about 17° east of north", () => {
    const b = initialBearing(KRAKOW, WARSAW);
    expect(b).toBeGreaterThan(15);
    expect(b).toBeLessThan(19);
  });

  it("matches the great-circle bearing away from the equator and the shared meridian", () => {
    expect(initialBearing({ lat: 50, lon: 10 }, { lat: 51, lon: 12 })).toBeCloseTo(51.0618, 3);
  });

  it("stays within [0, 360)", () => {
    const b = initialBearing(origin, { lat: 50.01, lon: 19.99 });
    expect(b).toBeGreaterThanOrEqual(0);
    expect(b).toBeLessThan(360);
    expect(b).toBeGreaterThan(300);
  });
});

describe("compassPoint", () => {
  it("lists eight points clockwise from north", () => {
    expect(COMPASS_POINTS).toEqual(["N", "NE", "E", "SE", "S", "SW", "W", "NW"]);
  });

  it.each([
    [0, "N"],
    [45, "NE"],
    [90, "E"],
    [135, "SE"],
    [180, "S"],
    [225, "SW"],
    [270, "W"],
    [315, "NW"],
  ] as const)("maps %s° to %s", (bearing, point) => {
    expect(compassPoint(bearing)).toBe(point);
  });

  it.each([
    [22.49, "N"],
    [22.5, "NE"],
    [67.49, "NE"],
    [67.5, "E"],
    [337.49, "NW"],
    [337.5, "N"],
    [359.99, "N"],
  ] as const)("maps the boundary %s° to %s", (bearing, point) => {
    expect(compassPoint(bearing)).toBe(point);
  });

  it("wraps values outside 0–360", () => {
    expect(compassPoint(360)).toBe("N");
    expect(compassPoint(405)).toBe("NE");
    expect(compassPoint(-45)).toBe("NW");
  });
});
