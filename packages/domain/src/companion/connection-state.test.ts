import { describe, expect, it } from "vitest";

import { CONNECT_FAILURE_REASONS, isConnectFailureReason } from "./connection-state";

describe("CONNECT_FAILURE_REASONS", () => {
  it("lists the D-10 reasons in order", () => {
    expect(CONNECT_FAILURE_REASONS).toEqual([
      "CONNECT_TIMEOUT",
      "CONNECT_ERROR",
      "HANDSHAKE_NO_RESPONSE",
      "HANDSHAKE_MALFORMED",
      "LINK_LOST",
      "BLUETOOTH_OFF",
    ]);
  });
});

describe("isConnectFailureReason", () => {
  it.each(CONNECT_FAILURE_REASONS)("accepts %s", (reason) => {
    expect(isConnectFailureReason(reason)).toBe(true);
  });

  it.each([
    ["an unknown reason", "OFFLINE"],
    ["lower case", "link_lost"],
    ["an empty string", ""],
    ["undefined", undefined],
    ["a number", 1],
  ])("rejects %s", (_label, value) => {
    expect(isConnectFailureReason(value)).toBe(false);
  });
});
