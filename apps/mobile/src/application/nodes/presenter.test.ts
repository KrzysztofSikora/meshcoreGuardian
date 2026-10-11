import { deriveCapabilities, type Node } from "@guardian/domain";
import { describe, expect, it } from "vitest";

import {
  lastHeardText,
  nameText,
  nodeRowModel,
  reportedAsText,
  reportedNameText,
  syncButton,
  syncLine,
  visibleNodes,
} from "./presenter";

const KEY = "ab".repeat(32);

function node(overrides: Partial<Node> = {}): Node {
  return {
    publicKey: KEY,
    reportedName: "Hill",
    reportedRole: "repeater",
    reportedType: 2,
    userLabel: null,
    userRole: null,
    lastHeardAt: null,
    inContacts: true,
    dashboardPinned: false,
    createdAt: 1,
    syncedAt: 1,
    ...overrides,
  };
}

const format = (ms: number) => `T${ms}`;

describe("nameText", () => {
  it("prefers the label, then the reported name, then the key prefix", () => {
    expect(nameText(node({ userLabel: "Mine" }))).toEqual({
      key: "nodes.name",
      params: { name: "Mine" },
    });
    expect(nameText(node())).toEqual({ key: "nodes.name", params: { name: "Hill" } });
    expect(nameText(node({ reportedName: "" }))).toEqual({
      key: "nodes.unnamed",
      params: { prefix: "abababab" },
    });
  });
});

describe("lastHeardText", () => {
  it("says not reported when the companion gave no time", () => {
    expect(lastHeardText(node(), format)).toEqual({ key: "nodes.lastHeardNone" });
    expect(lastHeardText(node({ lastHeardAt: 5000 }), format)).toEqual({
      key: "nodes.lastHeard",
      params: { time: "T5000" },
    });
  });
});

describe("reportedAsText", () => {
  it("is absent for a known type while nothing was changed by the user", () => {
    expect(reportedAsText(node())).toBeNull();
  });

  it("shows the raw type of an untouched unknown node", () => {
    expect(reportedAsText(node({ reportedRole: "unknown", reportedType: 4 }))).toEqual({
      key: "nodes.reportedAs.unknown",
      params: { type: 4 },
    });
  });

  it("names the reported role once the user changed role or label", () => {
    expect(reportedAsText(node({ userLabel: "x" }))).toEqual({ key: "nodes.reportedAs.repeater" });
    expect(reportedAsText(node({ userRole: "chat" }))).toEqual({
      key: "nodes.reportedAs.repeater",
    });
  });

  it("keeps the raw type for an unknown reported role", () => {
    expect(
      reportedAsText(node({ reportedRole: "unknown", reportedType: 4, userRole: "repeater" })),
    ).toEqual({ key: "nodes.reportedAs.unknown", params: { type: 4 } });
  });
});

describe("reportedNameText", () => {
  it("shows the advertised name once a label hides it", () => {
    expect(reportedNameText(node({ userLabel: "Hilltop" }))).toEqual({
      key: "nodes.reportedName",
      params: { name: "Hill" },
    });
  });

  it("is absent without a label, or when no name was reported", () => {
    expect(reportedNameText(node())).toBeNull();
    expect(reportedNameText(node({ userLabel: "Hilltop", reportedName: "" }))).toBeNull();
  });
});

describe("nodeRowModel", () => {
  it("shows the user role over the reported one and flags missing contacts", () => {
    const model = nodeRowModel(node({ userRole: "room_server", inContacts: false }), format);
    expect(model.role).toEqual({ key: "roles.room_server" });
    expect(model.notInContacts).toBe(true);
  });
});

describe("visibleNodes", () => {
  const chat = node({ publicKey: "c".repeat(64), reportedRole: "chat", reportedType: 1 });
  const pinned = node({ publicKey: "d".repeat(64), reportedRole: "chat", dashboardPinned: true });
  const unknown = node({ publicKey: "e".repeat(64), reportedRole: "unknown", reportedType: 4 });
  const all = [node(), chat, pinned, unknown];

  it("keeps chat contacts off the Dashboard unless pinned", () => {
    expect(visibleNodes(all, "dashboard")).toEqual([node(), pinned, unknown]);
  });

  it("lists everything under All contacts", () => {
    expect(visibleNodes(all, "all")).toEqual(all);
  });
});

describe("syncLine", () => {
  it.each([
    [{ kind: "idle" }, null],
    [{ kind: "syncing" }, { key: "sync.syncing" }],
    [
      { kind: "done", at: 1, total: 31 },
      { key: "sync.done", params: { count: 31 } },
    ],
    [
      { kind: "partial", at: 1, received: 30, expected: 31 },
      { key: "sync.partial", params: { received: 30, expected: 31 } },
    ],
    [{ kind: "failed", reason: "NO_RESPONSE" }, { key: "sync.failed.NO_RESPONSE" }],
  ] as const)("%j", (state, expected) => {
    expect(syncLine(state)).toEqual(expected);
  });
});

describe("syncButton", () => {
  const supported = deriveCapabilities({ firmwareVerCode: 13, firmwareVersion: "v1" });
  const old = deriveCapabilities({ firmwareVerCode: 0, firmwareVersion: "v0" });

  it("is disabled with a reason when not connected", () => {
    expect(syncButton({ connected: false, capabilities: null, sync: { kind: "idle" } })).toEqual({
      enabled: false,
      reason: { key: "sync.needConnection" },
    });
  });

  it("needs both a connection and known capabilities", () => {
    const needConnection = { enabled: false, reason: { key: "sync.needConnection" } };
    expect(
      syncButton({ connected: false, capabilities: supported, sync: { kind: "idle" } }),
    ).toEqual(needConnection);
    expect(syncButton({ connected: true, capabilities: null, sync: { kind: "idle" } })).toEqual(
      needConnection,
    );
  });

  it("is disabled with the firmware reason when contacts are unsupported", () => {
    expect(syncButton({ connected: true, capabilities: old, sync: { kind: "idle" } })).toEqual({
      enabled: false,
      reason: { key: "capability.unsupported", params: { version: "v0" } },
    });
  });

  it("is enabled when idle and disabled while syncing", () => {
    expect(
      syncButton({ connected: true, capabilities: supported, sync: { kind: "idle" } }),
    ).toEqual({
      enabled: true,
      reason: null,
    });
    expect(
      syncButton({ connected: true, capabilities: supported, sync: { kind: "syncing" } }).enabled,
    ).toBe(false);
  });
});
