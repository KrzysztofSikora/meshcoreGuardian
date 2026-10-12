import { describe, expect, it } from "vitest";

import { ATTEMPTS_RANGE, DEFAULT_DIAGNOSTIC_POLICY, assertAttempts, shouldRetry } from "./retry";

describe("DEFAULT_DIAGNOSTIC_POLICY", () => {
  it("is 2 attempts and no timeout override", () => {
    expect(DEFAULT_DIAGNOSTIC_POLICY).toEqual({ attempts: 2, overrideMs: null });
    expect(ATTEMPTS_RANGE).toEqual([1, 3]);
  });
});

describe("assertAttempts", () => {
  it.each([1, 2, 3])("accepts %s", (n) => {
    expect(() => assertAttempts(n)).not.toThrow();
  });

  it.each([0, 4, -1, 1.5, Number.NaN])("rejects %s", (n) => {
    expect(() => assertAttempts(n)).toThrow(RangeError);
  });
});

describe("shouldRetry", () => {
  it("retries a silent attempt while attempts remain", () => {
    expect(shouldRetry("NO_REPLY", 1, 2)).toBe(true);
    expect(shouldRetry("NO_REPLY", 2, 3)).toBe(true);
  });

  it("stops at the attempt limit", () => {
    expect(shouldRetry("NO_REPLY", 2, 2)).toBe(false);
    expect(shouldRetry("NO_REPLY", 1, 1)).toBe(false);
    expect(shouldRetry("NO_REPLY", 3, 2)).toBe(false);
  });

  it.each([
    "LOGIN_REJECTED",
    "MALFORMED_RESPONSE",
    "COMMAND_REJECTED",
    "COMPANION_NO_ACK",
    "LINK_LOST",
    "CANCELLED",
    "UNEXPECTED_ERROR",
    "ALL_CHECKS_REPLIED",
  ] as const)("never retries %s", (reason) => {
    expect(shouldRetry(reason, 1, 3)).toBe(false);
  });
});
