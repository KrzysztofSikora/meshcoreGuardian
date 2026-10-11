import { describe, expect, it } from "vitest";

import { cString, i16le, i32le, requireLength, toHex, u16le, u32le, u8 } from "./bytes";
import { MalformedFrameError } from "./errors";

describe("byte readers", () => {
  // A view into the middle of a larger buffer: readers must honour byteOffset.
  const backing = Uint8Array.from([0xee, 0x01, 0x02, 0xfe, 0xff, 0x78, 0x56, 0x34, 0x12, 0xee]);
  const bytes = backing.subarray(1, 9);

  it("reads little-endian integers relative to the view", () => {
    expect(u8(bytes, 0)).toBe(0x01);
    expect(u16le(bytes, 0)).toBe(0x0201);
    expect(i16le(bytes, 2)).toBe(-2);
    expect(u16le(bytes, 2)).toBe(0xfffe);
    expect(u32le(bytes, 4)).toBe(0x12345678);
    expect(i32le(Uint8Array.from([0xff, 0xff, 0xff, 0xff]), 0)).toBe(-1);
    expect(u32le(Uint8Array.from([0xff, 0xff, 0xff, 0xff]), 0)).toBe(0xffffffff);
  });

  it("writes lower-case hex with two digits per byte", () => {
    expect(toHex(Uint8Array.from([0x00, 0x0a, 0xff]))).toBe("000aff");
    expect(toHex(new Uint8Array(0))).toBe("");
  });

  it("reads a zero-terminated string inside a fixed field", () => {
    const field = Uint8Array.from([0x41, 0x42, 0x41, 0x00, 0x43, 0x44]);
    expect(cString(field, 1, 4)).toBe("BA");
  });

  it("reads the whole field when it has no terminator, and decodes UTF-8", () => {
    const field = Uint8Array.from([0x5a, 0xc3, 0xb3, 0x6c, 0x77, 0x99]);
    expect(cString(field, 0, 5)).toBe("Zólw");
  });

  it("throws MalformedFrameError with code, length and needed when a frame is short", () => {
    expect(() => requireLength(Uint8Array.from([7, 1, 2]), 4)).toThrowError(
      expect.objectContaining({ code: 7, length: 3, needed: 4 }),
    );
    expect(() => requireLength(Uint8Array.from([7, 1, 2]), 3)).not.toThrow();
  });

  it("reports a missing code for an empty frame", () => {
    const error = (() => {
      try {
        requireLength(new Uint8Array(0), 1);
      } catch (thrown) {
        return thrown;
      }
    })();
    expect(error).toBeInstanceOf(MalformedFrameError);
    expect(error).toMatchObject({
      name: "MalformedFrameError",
      code: null,
      length: 0,
      needed: 1,
      message: "Malformed frame (code none): 0 bytes, needs 1",
    });
  });
});
