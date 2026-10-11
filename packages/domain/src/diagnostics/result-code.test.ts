import { describe, expect, it } from "vitest";

import { RESULT_CODES, isResultCode } from "./result-code";

describe("RESULT_CODES", () => {
  it("lists the FR-06 result codes in order", () => {
    expect(RESULT_CODES).toEqual([
      "RESPONDED",
      "NO_RESPONSE",
      "TRANSPORT_UNAVAILABLE",
      "UNSUPPORTED",
      "NOT_TESTED",
    ]);
  });
});

describe("isResultCode", () => {
  it.each(RESULT_CODES)("accepts %s", (code) => {
    expect(isResultCode(code)).toBe(true);
  });

  it.each([
    ["an unknown code", "OFFLINE"],
    ["a lower-case code", "responded"],
    ["an empty string", ""],
    ["undefined", undefined],
    ["null", null],
    ["a number", 0],
    ["an array holding a code", ["RESPONDED"]],
    ["a String object", new String("RESPONDED")],
  ])("rejects %s", (_label, value) => {
    expect(isResultCode(value)).toBe(false);
  });
});
