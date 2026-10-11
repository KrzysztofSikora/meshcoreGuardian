import { describe, expect, it } from "vitest";

import { deviceInfoFrame } from "../../test/support/frames";
import { decodeDeviceInfo } from "./device-info";
import { MalformedFrameError } from "./errors";

describe("decodeDeviceInfo (firmware 1.17 layout)", () => {
  it("reads every field after the PIN, with both trailer bytes", () => {
    expect(decodeDeviceInfo(deviceInfoFrame())).toEqual({
      firmwareVerCode: 10,
      maxContacts: 350,
      maxChannels: 40,
      buildDate: "11 Oct 2026",
      manufacturer: "Heltec V3",
      firmwareVersion: "v1.17.1",
      repeatEnabled: true,
      pathHashMode: 2,
    });
  });

  it("reads repeat 0 as disabled", () => {
    expect(decodeDeviceInfo(deviceInfoFrame({ trailer: [0, 0] }))).toMatchObject({
      repeatEnabled: false,
      pathHashMode: 0,
    });
  });

  it("omits the trailer fields older firmware does not send", () => {
    const withRepeatOnly = decodeDeviceInfo(deviceInfoFrame({ trailer: [1] }));
    expect(withRepeatOnly.repeatEnabled).toBe(true);
    expect(withRepeatOnly).not.toHaveProperty("pathHashMode");

    const withNeither = decodeDeviceInfo(deviceInfoFrame({ trailer: [] }));
    expect(withNeither).not.toHaveProperty("repeatEnabled");
    expect(withNeither).not.toHaveProperty("pathHashMode");
    expect(withNeither.firmwareVersion).toBe("v1.17.1");
  });

  it("has no PIN field, and the PIN bytes do not change the result", () => {
    const one = decodeDeviceInfo(deviceInfoFrame({ pin: 111111 }));
    const other = decodeDeviceInfo(deviceInfoFrame({ pin: 999999 }));
    expect(one).toEqual(other);
    expect(JSON.stringify(one)).not.toMatch(/pin/i);
  });

  it("throws MalformedFrameError when the firmware version field is cut short", () => {
    const frame = deviceInfoFrame({ trailer: [] }).subarray(0, 79);
    expect(() => decodeDeviceInfo(frame)).toThrowError(MalformedFrameError);
    expect(() => decodeDeviceInfo(frame)).toThrowError(
      expect.objectContaining({ code: 13, length: 79, needed: 80 }),
    );
  });
});
