import { describe, expect, it } from "vitest";

import { CONTACT_SYNC_FAILURES, isContactSyncFailure } from "./sync";

describe("CONTACT_SYNC_FAILURES", () => {
  it("lists the failure reasons", () => {
    expect(CONTACT_SYNC_FAILURES).toEqual([
      "NO_RESPONSE",
      "TRANSPORT_UNAVAILABLE",
      "UNSUPPORTED",
      "MALFORMED_RESPONSE",
      "STORAGE_ERROR",
    ]);
  });
});

describe("isContactSyncFailure", () => {
  it.each(CONTACT_SYNC_FAILURES)("accepts %s", (reason) => {
    expect(isContactSyncFailure(reason)).toBe(true);
  });

  it.each([["offline"], [""], [undefined], [null], [3]])("rejects %s", (value) => {
    expect(isContactSyncFailure(value)).toBe(false);
  });
});
