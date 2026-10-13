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
  ])("%j", (input, expected) => {
    expect(validateGuestPassword(input)).toEqual(expected);
  });

  it("limit is 15 bytes", () => {
    expect(GUEST_PASSWORD_MAX_BYTES).toBe(15);
  });
});
