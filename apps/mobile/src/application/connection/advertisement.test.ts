import { describe, expect, it } from "vitest";

import { NUS_SERVICE_UUID, isCompanionAdvertisement } from "./advertisement";

describe("isCompanionAdvertisement", () => {
  it("accepts the NUS service UUID in any case", () => {
    expect(isCompanionAdvertisement({ name: null, serviceUUIDs: [NUS_SERVICE_UUID] })).toBe(true);
    expect(
      isCompanionAdvertisement({ name: "x", serviceUUIDs: [NUS_SERVICE_UUID.toUpperCase()] }),
    ).toBe(true);
  });

  it("accepts a MeshCore name prefix without a UUID", () => {
    expect(isCompanionAdvertisement({ name: "MeshCore-ab12", serviceUUIDs: null })).toBe(true);
  });

  it("rejects other devices", () => {
    expect(isCompanionAdvertisement({ name: "Headphones", serviceUUIDs: ["180f"] })).toBe(false);
    expect(isCompanionAdvertisement({ name: null, serviceUUIDs: null })).toBe(false);
    expect(isCompanionAdvertisement({ name: "my MeshCore", serviceUUIDs: [] })).toBe(false);
  });
});
