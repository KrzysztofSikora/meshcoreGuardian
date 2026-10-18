import { describe, expect, it } from "vitest";

import type { SessionState } from "../connection/companion-session";
import { dataView, deletionMessage, settingsView, saveProblem } from "./presenter";
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
    expect(saveProblem({ ok: false, reason: "OUT_OF_RANGE", field: "timeout", range: [5, 60] })).toEqual({
      key: "settings.timeoutRange",
      params: { min: 5, max: 60 },
    });
  });
  it("names attempts, not seconds, for an attempts value", () => {
    expect(saveProblem({ ok: false, reason: "OUT_OF_RANGE", field: "attempts", range: [1, 3] })).toEqual({
      key: "settings.attemptsRange",
      params: { min: 1, max: 3 },
    });
  });
  it("reports a storage failure and nothing on success", () => {
    expect(saveProblem({ ok: false, reason: "STORAGE_ERROR" })).toEqual({ key: "settings.saveFailed" });
    expect(saveProblem({ ok: true })).toBeNull();
  });
});

const nodeOf = (key: string, over: Record<string, unknown> = {}) =>
  ({ publicKey: key, userLabel: null, userRole: null, reportedName: "", ...over }) as never;

const runsOf = (over: Record<string, unknown> = {}) =>
  ({ latest: {}, loaded: true, active: null, storage: "ok", ...over }) as never;

const nodesOf = (list: unknown[], over: Record<string, unknown> = {}) =>
  ({ nodes: list, loaded: true, storage: "ok", sync: { kind: "idle" }, ...over }) as never;

describe("dataView (D-13, D-11)", () => {
  it("lists nodes with a run, a label or a role, in the given order", () => {
    const view = dataView(
      runsOf({ latest: { bb22: {} } }),
      nodesOf([nodeOf("aa11", { userLabel: "Hill" }), nodeOf("bb22"), nodeOf("cc33"), nodeOf("dd44", { userRole: "repeater" })]),
    );
    expect(view.rows.map((r) => r.publicKey)).toEqual(["aa11", "bb22", "dd44"]);
    expect(view.empty).toBeNull();
    expect(view.busyNote).toBeNull();
  });

  it("says nothing is stored only when both stores loaded without error", () => {
    const empty = { key: "settings.noHistory" };
    expect(dataView(runsOf(), nodesOf([nodeOf("aa11")])).empty).toEqual(empty);
    expect(dataView(runsOf({ loaded: false }), nodesOf([])).empty).toBeNull();
    expect(dataView(runsOf(), nodesOf([], { loaded: false })).empty).toBeNull();
    expect(dataView(runsOf({ storage: "error" }), nodesOf([])).empty).toBeNull();
    expect(dataView(runsOf(), nodesOf([], { storage: "error" })).empty).toBeNull();
  });

  it("shows the busy note during a run or a sync", () => {
    const busy = { key: "settings.busy" };
    expect(dataView(runsOf({ active: {} }), nodesOf([])).busyNote).toEqual(busy);
    expect(dataView(runsOf(), nodesOf([], { sync: { kind: "syncing" } })).busyNote).toEqual(busy);
  });
});

describe("deletionMessage (D-10)", () => {
  it("names what happened", () => {
    expect(deletionMessage({ ok: true }, "node")).toEqual({ key: "settings.deleted" });
    expect(deletionMessage({ ok: true }, "all")).toEqual({ key: "settings.clearedAll" });
    expect(deletionMessage({ ok: false, reason: "BUSY" }, "all")).toEqual({ key: "settings.busy" });
    expect(deletionMessage({ ok: false, reason: "STORAGE_ERROR" }, "node")).toEqual({ key: "settings.deleteStorageError" });
    expect(deletionMessage({ ok: false, reason: "SECRET_ERROR" }, "node")).toEqual({ key: "settings.deleteSecretError" });
    expect(deletionMessage({ ok: false, reason: "SECRET_ERROR" }, "all")).toEqual({ key: "settings.clearSecretError" });
  });
});
