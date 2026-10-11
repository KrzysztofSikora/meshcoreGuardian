import { isResultCode } from "@guardian/domain";
import { describe, expect, it } from "vitest";

describe("workspace resolution", () => {
  it("resolves @guardian/domain through its package entry point", () => {
    expect(isResultCode("NO_RESPONSE")).toBe(true);
  });
});
