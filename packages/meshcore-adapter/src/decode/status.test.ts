import { describe, expect, it } from "vitest";

import { STATS, statsBytes } from "../../test/support/frames";
import { MalformedFrameError } from "./errors";
import { decodeStats } from "./status";

const PUSH_HEADER = [0x87, 0, 1, 2, 3, 4, 5, 6];
const withHeader = (payload: ArrayLike<number>) =>
  Uint8Array.from([...PUSH_HEADER, ...Array.from(payload)]);

describe("decodeStats", () => {
  it("reads the 48-byte stats struct field by field from the given offset", () => {
    expect(decodeStats(withHeader(statsBytes()), 8)).toEqual({ stats: STATS, extraHex: "" });
  });

  it("keeps bytes after the shared struct (room server fields, padding) as extraHex", () => {
    const frame = withHeader([...statsBytes(), 0x07, 0x00, 0x02, 0x00]);
    expect(decodeStats(frame, 8)).toEqual({ stats: STATS, extraHex: "07000200" });
  });

  it("throws MalformedFrameError for a frame that ends inside the struct", () => {
    const frame = withHeader(statsBytes().subarray(0, 47));
    expect(() => decodeStats(frame, 8)).toThrowError(MalformedFrameError);
    expect(() => decodeStats(frame, 8)).toThrowError(
      expect.objectContaining({ code: 0x87, length: 55, needed: 56 }),
    );
  });
});
