import { describe, expect, it } from "vitest";

import { CaptureConfigError, readCaptureConfig } from "./config";

const env = {
  HW_COMPANION: "AA:BB:CC:DD:EE:FF",
  HW_REPEATER: "A0A1A2A3A4A5",
  HW_GUEST_PASSWORD: "pw-LEAK-CANARY",
};

describe("readCaptureConfig (TR-23)", () => {
  it("reads the companion, a lower-case target prefix and the password", () => {
    expect(readCaptureConfig(env)).toEqual({
      companion: "AA:BB:CC:DD:EE:FF",
      repeaterPrefix: "a0a1a2a3a4a5",
      guestPassword: "pw-LEAK-CANARY",
    });
  });

  it("trims the companion and target but keeps the password as written", () => {
    const config = readCaptureConfig({
      HW_COMPANION: " Base ",
      HW_REPEATER: " a0 ",
      HW_GUEST_PASSWORD: " pw ",
    });
    expect(config).toEqual({ companion: "Base", repeaterPrefix: "a0", guestPassword: " pw " });
  });

  it("allows an open guest login without a password", () => {
    const { HW_GUEST_PASSWORD: _, ...withoutPassword } = env;
    expect(readCaptureConfig(withoutPassword).guestPassword).toBe("");
  });

  it.each([
    ["HW_COMPANION", undefined],
    ["HW_COMPANION", ""],
    ["HW_COMPANION", "   "],
    ["HW_REPEATER", undefined],
    ["HW_REPEATER", ""],
    ["HW_REPEATER", "  "],
  ])("refuses to start when %s is %j", (name, value) => {
    expect(() => readCaptureConfig({ ...env, [name]: value })).toThrow(CaptureConfigError);
    expect(() => readCaptureConfig({ ...env, [name]: value })).toThrow(`${name} is not set`);
  });

  it.each(["a0a", "xyz0", "a0-a1", "00".repeat(33)])("rejects the target prefix %j", (prefix) => {
    expect(() => readCaptureConfig({ ...env, HW_REPEATER: prefix })).toThrow(
      "HW_REPEATER must be a hex public key prefix",
    );
  });

  it("accepts a full 32-byte public key as the target", () => {
    expect(readCaptureConfig({ ...env, HW_REPEATER: "ab".repeat(32) }).repeaterPrefix).toBe(
      "ab".repeat(32),
    );
  });

  it("accepts a 15-character password and rejects 16 without echoing it", () => {
    expect(readCaptureConfig({ ...env, HW_GUEST_PASSWORD: "p".repeat(15) }).guestPassword).toBe(
      "p".repeat(15),
    );
    const tooLong = "pw-LEAK-CANARY-1";
    let message = "";
    try {
      readCaptureConfig({ ...env, HW_GUEST_PASSWORD: tooLong });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toBe("HW_GUEST_PASSWORD is longer than 15 characters");
  });
});
