import { describe, expect, it } from "vitest";

import { decodePathLen } from "./path";

describe("decodePathLen", () => {
  it.each([
    { raw: 0x00, hashSize: 1, hops: 0 },
    { raw: 0x05, hashSize: 1, hops: 5 },
    { raw: 0x45, hashSize: 2, hops: 5 },
    { raw: 0x80, hashSize: 3, hops: 0 },
    { raw: 0x85, hashSize: 3, hops: 5 },
    { raw: 0xbf, hashSize: 3, hops: 63 },
  ])("reads $raw as hash size $hashSize with $hops hops", ({ raw, hashSize, hops }) => {
    expect(decodePathLen(raw)).toEqual({ raw, kind: "known", hashSize, hops });
  });

  it("reads 0xFF as no known path (flood)", () => {
    expect(decodePathLen(0xff)).toEqual({ raw: 0xff, kind: "unknown" });
  });

  it("keeps hash size 4 values below 0xFF as known paths", () => {
    expect(decodePathLen(0xfe)).toEqual({ raw: 0xfe, kind: "known", hashSize: 4, hops: 62 });
  });
});
