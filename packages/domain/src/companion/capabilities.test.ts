import { describe, expect, it } from "vitest";

import {
  CAPABILITIES,
  CAPABILITY_MIN_VER_CODE,
  actionAvailability,
  deriveCapabilities,
} from "./capabilities";

const info = (firmwareVerCode: number, firmwareVersion = "v1.4.0") => ({
  firmwareVerCode,
  firmwareVersion,
});

describe("CAPABILITIES", () => {
  it("lists the five FR-03 capabilities", () => {
    expect(CAPABILITIES).toEqual(["contacts", "login", "status", "telemetry", "trace"]);
  });

  it("has a minimum for each", () => {
    expect(CAPABILITY_MIN_VER_CODE).toEqual({
      contacts: 1,
      login: 1,
      status: 1,
      telemetry: 5,
      trace: 1,
    });
  });
});

describe("deriveCapabilities", () => {
  it("marks telemetry unsupported below ver code 5, with the firmware version", () => {
    const caps = deriveCapabilities(info(4));
    expect(caps.telemetry).toEqual({
      supported: false,
      reason: "FIRMWARE_TOO_OLD",
      firmwareVersion: "v1.4.0",
    });
    expect(caps.contacts).toEqual({ supported: true });
    expect(caps.login).toEqual({ supported: true });
    expect(caps.status).toEqual({ supported: true });
    expect(caps.trace).toEqual({ supported: true });
  });

  it("supports telemetry exactly at ver code 5", () => {
    expect(deriveCapabilities(info(5)).telemetry).toEqual({ supported: true });
  });

  it("supports everything at ver code 13", () => {
    const caps = deriveCapabilities(info(13, "v1.17.1-d929643"));
    for (const capability of CAPABILITIES) expect(caps[capability]).toEqual({ supported: true });
  });

  it("marks everything unsupported at ver code 0", () => {
    const caps = deriveCapabilities(info(0));
    for (const capability of CAPABILITIES) expect(caps[capability].supported).toBe(false);
  });
});

describe("actionAvailability", () => {
  it("enables a supported capability", () => {
    expect(actionAvailability(deriveCapabilities(info(13)), "telemetry")).toEqual({
      enabled: true,
    });
  });

  it("disables an unsupported one with the reason and firmware version", () => {
    expect(actionAvailability(deriveCapabilities(info(4)), "telemetry")).toEqual({
      enabled: false,
      reason: "FIRMWARE_TOO_OLD",
      firmwareVersion: "v1.4.0",
    });
  });

  it("only looks at the capability the action needs", () => {
    expect(actionAvailability(deriveCapabilities(info(4)), "status")).toEqual({ enabled: true });
  });
});
