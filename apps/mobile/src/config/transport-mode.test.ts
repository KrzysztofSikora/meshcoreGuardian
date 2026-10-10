import { describe, expect, it } from "vitest";

import { parseTransportMode } from "./transport-mode";

describe("parseTransportMode", () => {
  it.each([
    [undefined, "ble"],
    ["", "ble"],
    ["ble", "ble"],
    ["fake", "fake"],
  ] as const)("maps %j to %s", (raw, expected) => {
    expect(parseTransportMode(raw)).toBe(expected);
  });

  it.each(["Fake", "usb", " fake"])("rejects %j", (raw) => {
    expect(() => parseTransportMode(raw)).toThrow(`Unknown EXPO_PUBLIC_TRANSPORT: ${raw}`);
  });
});
