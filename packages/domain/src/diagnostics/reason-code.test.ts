import { describe, expect, it } from "vitest";

import { REASONS_BY_RESULT, isReasonFor } from "./reason-code";
import { RESULT_CODES } from "./result-code";

describe("REASONS_BY_RESULT", () => {
  it("lists the stored reasons for every result", () => {
    expect(REASONS_BY_RESULT).toEqual({
      RESPONDED: ["ALL_CHECKS_REPLIED", "PARTIAL_REPLY", "LOGIN_REJECTED"],
      NO_RESPONSE: ["NO_REPLY"],
      TRANSPORT_UNAVAILABLE: ["NOT_CONNECTED", "LINK_LOST", "COMPANION_NO_ACK"],
      UNSUPPORTED: ["CAPABILITY_MISSING", "COMMAND_REJECTED", "MALFORMED_RESPONSE"],
      NOT_TESTED: ["CANCELLED", "UNEXPECTED_ERROR"],
    });
  });

  it("covers every result code and no reason belongs to two results", () => {
    expect(Object.keys(REASONS_BY_RESULT).sort()).toEqual([...RESULT_CODES].sort());
    const all = Object.values(REASONS_BY_RESULT).flat();
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("isReasonFor", () => {
  it.each(RESULT_CODES.flatMap((r) => REASONS_BY_RESULT[r].map((reason) => [r, reason] as const)))(
    "accepts %s / %s",
    (result, reason) => {
      expect(isReasonFor(result, reason)).toBe(true);
    },
  );

  it.each([
    ["RESPONDED", "NO_REPLY"],
    ["NO_RESPONSE", "ALL_CHECKS_REPLIED"],
    ["NOT_TESTED", "LINK_LOST"],
    ["UNSUPPORTED", "offline"],
    ["UNSUPPORTED", ""],
    ["UNSUPPORTED", undefined],
    ["UNSUPPORTED", null],
    ["UNSUPPORTED", 3],
  ] as const)("rejects %s / %s", (result, reason) => {
    expect(isReasonFor(result, reason)).toBe(false);
  });
});
