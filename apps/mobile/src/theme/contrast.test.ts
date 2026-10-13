import { describe, expect, it } from "vitest";

import { contrastRatio } from "./contrast";
import { COLORS, TEXT_PAIRS, type Scheme } from "./tokens";

describe("contrastRatio", () => {
  it("is 21 for black on white, in either order", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrastRatio("#FFFFFF", "#000000")).toBeCloseTo(21, 5);
  });

  it("is 1 for equal colours", () => {
    expect(contrastRatio("#0E6B5E", "#0E6B5E")).toBeCloseTo(1, 5);
  });

  it("matches a known value for the mockup accent on white", () => {
    expect(contrastRatio("#0E6B5E", "#FFFFFF")).toBeGreaterThan(6);
    expect(contrastRatio("#0E6B5E", "#FFFFFF")).toBeLessThan(7);
  });

  it("rejects colours that are not #RRGGBB", () => {
    expect(() => contrastRatio("#fff", "#000000")).toThrow();
    expect(() => contrastRatio("white", "#000000")).toThrow();
    expect(() => contrastRatio("#FFFFFFAA", "#000000")).toThrow();
    expect(() => contrastRatio("x#FFFFFF", "#000000")).toThrow(/Expected #RRGGBB, got x#FFFFFF/);
  });
});

describe.each(["light", "dark"] as Scheme[])("%s text pairs", (scheme) => {
  it("declares pairs", () => {
    expect(TEXT_PAIRS[scheme].length).toBeGreaterThan(20);
  });

  it.each(TEXT_PAIRS[scheme].map((p) => [p[2], p] as const))("%s is at least 4.5:1", (_use, p) => {
    expect(contrastRatio(p[0], p[1])).toBeGreaterThanOrEqual(4.5);
  });

  it("uses only #RRGGBB values", () => {
    const hex: string[] = [];
    const walk = (v: unknown) => {
      if (typeof v === "string") hex.push(v);
      else if (v && typeof v === "object") Object.values(v).forEach(walk);
    };
    walk(COLORS[scheme]);
    for (const h of hex) expect(h).toMatch(/^#[0-9A-F]{6}$/);
  });
});
