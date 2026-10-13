import { describe, expect, it } from "vitest";

import { GUEST_PASSWORD_MAX_BYTES, validateGuestPassword } from "./guest-password";

describe("validateGuestPassword", () => {
  it.each([
    ["", { ok: false, reason: "EMPTY" }],
    [" ", { ok: true, value: " " }],
    ["😀".repeat(3) + "abc", { ok: true, value: "😀".repeat(3) + "abc" }],
    ["😀".repeat(4), { ok: false, reason: "TOO_LONG" }],
    ["a".repeat(15), { ok: true, value: "a".repeat(15) }],
    ["a".repeat(16), { ok: false, reason: "TOO_LONG" }],
    ["ż".repeat(7), { ok: true, value: "ż".repeat(7) }],
    ["ż".repeat(8), { ok: false, reason: "TOO_LONG" }],
    [" secret", { ok: true, value: " secret" }],
    // UTF-8 width boundaries: U+007F 1 byte, U+0080 and U+07FF 2, U+0800 and U+FFFF 3, U+10000 4.
    ["\u007f".repeat(15), { ok: true, value: "\u007f".repeat(15) }],
    ["\u0080".repeat(7), { ok: true, value: "\u0080".repeat(7) }],
    ["\u0080".repeat(8), { ok: false, reason: "TOO_LONG" }],
    ["\u07ff".repeat(8), { ok: false, reason: "TOO_LONG" }],
    ["\u0800".repeat(5), { ok: true, value: "\u0800".repeat(5) }],
    ["\u0800".repeat(6), { ok: false, reason: "TOO_LONG" }],
    ["\uffff".repeat(5), { ok: true, value: "\uffff".repeat(5) }],
    ["\uffff".repeat(6), { ok: false, reason: "TOO_LONG" }],
    ["\u{10000}".repeat(3), { ok: true, value: "\u{10000}".repeat(3) }],
    ["\u{10000}".repeat(4), { ok: false, reason: "TOO_LONG" }],
  ])("%j", (input, expected) => {
    expect(validateGuestPassword(input)).toEqual(expected);
  });

  it("limit is 15 bytes", () => {
    expect(GUEST_PASSWORD_MAX_BYTES).toBe(15);
  });
});
