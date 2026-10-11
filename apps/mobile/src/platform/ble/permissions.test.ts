import { describe, expect, it } from "vitest";

import { REQUIRED_PERMISSIONS } from "./permissions";

describe("REQUIRED_PERMISSIONS", () => {
  it("asks for Bluetooth scan and connect only", () => {
    expect([...REQUIRED_PERMISSIONS]).toEqual([
      "android.permission.BLUETOOTH_SCAN",
      "android.permission.BLUETOOTH_CONNECT",
    ]);
  });

  it("contains no location permission", () => {
    for (const permission of REQUIRED_PERMISSIONS) expect(permission).not.toMatch(/LOCATION/);
  });
});
