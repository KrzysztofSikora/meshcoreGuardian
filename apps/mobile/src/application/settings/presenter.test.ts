import { describe, expect, it } from "vitest";

import type { SessionState } from "../connection/companion-session";
import { settingsView, saveProblem } from "./presenter";
import type { SettingsState } from "./settings-controller";
import { DEFAULT_SETTINGS } from "./settings";

const ready = (over: Partial<SettingsState> = {}): SettingsState => ({
  status: "ready",
  settings: DEFAULT_SETTINGS,
  unreadable: false,
  ...over,
});

const disconnected: Pick<SessionState, "connection" | "firmwareTested"> = {
  connection: { kind: "disconnected" },
  firmwareTested: null,
};

const connected = (firmwareTested: boolean | null): Pick<SessionState, "connection" | "firmwareTested"> => ({
  connection: {
    kind: "connected",
    companion: {
      publicKey: "k",
      name: "Companion",
      model: "T-Deck",
      firmwareVersion: "1.2.3",
      firmwareVerCode: 9,
      buildDate: "2025-01-02",
      position: null,
    },
  } as SessionState["connection"],
  firmwareTested,
});

describe("settingsView (FR-15 AC1)", () => {
  it("shows Auto, the app version and the no-companion hint", () => {
    const view = settingsView(ready(), disconnected, "1.0.0");
    expect(view.loading).toBe(false);
    expect(view.timeout).toEqual({ key: "settings.timeoutAuto" });
    expect(view.attempts).toBe(2);
    expect(view.redactKeys).toBe(true);
    expect(view.appVersion).toEqual({ key: "settings.appVersion", params: { version: "1.0.0" } });
    expect(view.companion).toEqual({ kind: "none", text: { key: "settings.noCompanion" } });
    expect(view.unreadableNote).toBeNull();
  });

  it("shows the saved timeout in seconds", () => {
    const view = settingsView(ready({ settings: { ...DEFAULT_SETTINGS, timeoutOverrideS: 20 } }), disconnected, "1");
    expect(view.timeout).toEqual({ key: "settings.timeoutValue", params: { seconds: 20 } });
  });

  it("reports loading without claiming a value as the user's choice", () => {
    expect(settingsView(ready({ status: "loading" }), disconnected, "1").loading).toBe(true);
  });

  it("flags unreadable saved settings", () => {
    expect(settingsView(ready({ unreadable: true }), disconnected, "1").unreadableNote).toEqual({
      key: "settings.unreadable",
    });
  });

  it("shows model, firmware and build of the connected companion", () => {
    const view = settingsView(ready(), connected(true), "1");
    expect(view.companion).toEqual({
      kind: "info",
      name: "Companion",
      lines: [
        { key: "connect.model", params: { model: "T-Deck" } },
        { key: "connect.firmware", params: { version: "1.2.3" } },
        { key: "connect.build", params: { date: "2025-01-02" } },
      ],
      untested: false,
    });
  });

  it("marks only a known-untested firmware", () => {
    const flag = (tested: boolean | null) => {
      const c = settingsView(ready(), connected(tested), "1").companion;
      return c.kind === "info" && c.untested;
    };
    expect(flag(false)).toBe(true);
    expect(flag(null)).toBe(false);
    expect(flag(true)).toBe(false);
  });
});

describe("saveProblem (FR-15 AC3)", () => {
  it("states the allowed range", () => {
    expect(saveProblem({ ok: false, reason: "OUT_OF_RANGE", range: [5, 60] })).toEqual({
      key: "settings.timeoutRange",
      params: { min: 5, max: 60 },
    });
  });
  it("reports a storage failure and nothing on success", () => {
    expect(saveProblem({ ok: false, reason: "STORAGE_ERROR" })).toEqual({ key: "settings.saveFailed" });
    expect(saveProblem({ ok: true })).toBeNull();
  });
});
