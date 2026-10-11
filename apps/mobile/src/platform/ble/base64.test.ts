import { describe, expect, it } from "vitest";

import { base64ToBytes, bytesToBase64 } from "./base64";

describe("base64", () => {
  it.each([
    [[], ""],
    [[0x66], "Zg=="],
    [[0x66, 0x6f], "Zm8="],
    [[0x66, 0x6f, 0x6f], "Zm9v"],
    [[0x16, 0x03], "FgM="],
    [[0xff, 0xfe, 0xfd, 0x00], "//79AA=="],
  ])("encodes %j as %s and decodes it back", (input, text) => {
    expect(bytesToBase64(Uint8Array.from(input))).toBe(text);
    expect([...base64ToBytes(text)]).toEqual(input);
  });

  it("round-trips every length up to a full companion frame", () => {
    for (let length = 0; length <= 160; length += 1) {
      const input = Uint8Array.from({ length }, (_, i) => (i * 37 + length) & 255);
      expect(base64ToBytes(bytesToBase64(input))).toEqual(input);
    }
  });

  it("rejects characters outside the alphabet", () => {
    expect(() => base64ToBytes("Zm9v!")).toThrow(/Invalid base64/);
  });
});
