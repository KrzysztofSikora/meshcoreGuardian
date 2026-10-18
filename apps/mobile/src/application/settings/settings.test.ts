import { describe, expect, it } from "vitest";

import {
  DEFAULT_SETTINGS,
  parseStoredSettings,
  parseTimeoutInput,
  serializeSettings,
  toPolicy,
} from "./settings";

const stored = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ version: 1, timeoutOverrideS: null, attempts: 2, redactKeys: true, ...over });

describe("parseTimeoutInput (FR-15 AC3)", () => {
  it.each(["5", "20", "60", " 30 "])("accepts %j", (text) => {
    expect(parseTimeoutInput(text)).toEqual({ ok: true, seconds: Number(text.trim()) });
  });

  it.each(["4", "61", "0", "12.5", "abc", "", "  ", "-5", "1e1", "0x10", "٢٠"])(
    "rejects %j with the allowed range",
    (text) => {
      expect(parseTimeoutInput(text)).toEqual({
        ok: false,
        reason: "OUT_OF_RANGE",
        min: 5,
        max: 60,
      });
    },
  );
});

describe("parseStoredSettings (TR-20)", () => {
  it("returns defaults for a missing value without a warning", () => {
    expect(parseStoredSettings(null)).toEqual({ settings: DEFAULT_SETTINGS, unreadable: false });
  });

  it("round-trips a serialised value", () => {
    const settings = { timeoutOverrideS: 20, attempts: 3, redactKeys: false };
    expect(parseStoredSettings(serializeSettings(settings))).toEqual({
      settings,
      unreadable: false,
    });
  });

  it.each([5, 60])("accepts the %i s bound", (timeoutOverrideS) => {
    expect(parseStoredSettings(stored({ timeoutOverrideS })).unreadable).toBe(false);
  });

  it.each([1, 3])("accepts %i attempts", (attempts) => {
    expect(parseStoredSettings(stored({ attempts })).unreadable).toBe(false);
  });

  it.each([
    ["bad JSON", "{nope"],
    ["not an object", "5"],
    ["timeout 4", stored({ timeoutOverrideS: 4 })],
    ["timeout 61", stored({ timeoutOverrideS: 61 })],
    ["fractional timeout", stored({ timeoutOverrideS: 12.5 })],
    ["string timeout", stored({ timeoutOverrideS: "20" })],
    ["attempts 0", stored({ attempts: 0 })],
    ["attempts 4", stored({ attempts: 4 })],
    ["fractional attempts", stored({ attempts: 1.5 })],
    ["redaction not boolean", stored({ redactKeys: "yes" })],
    ["unknown key", stored({ extra: 1 })],
    ["wrong version", stored({ version: 2 })],
  ])("falls back to defaults and flags it: %s", (_name, raw) => {
    expect(parseStoredSettings(raw)).toEqual({ settings: DEFAULT_SETTINGS, unreadable: true });
  });
});

describe("toPolicy", () => {
  it("maps seconds to milliseconds and keeps null as automatic", () => {
    expect(toPolicy({ timeoutOverrideS: 20, attempts: 3, redactKeys: true })).toEqual({
      attempts: 3,
      overrideMs: 20_000,
    });
    expect(toPolicy(DEFAULT_SETTINGS)).toEqual({ attempts: 2, overrideMs: null });
  });
});
