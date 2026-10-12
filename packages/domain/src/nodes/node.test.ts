import { describe, expect, it } from "vitest";

import {
  NODE_ROLES,
  contactLastHeard,
  displayName,
  effectiveRole,
  isOnDashboard,
  keyPrefix,
  normalizeLabel,
  roleFromContactType,
  sortNodes,
} from "./node";
import type { Node, NodeRole } from "./node";

const KEY = "ab".repeat(32);

function node(overrides: Partial<Node> = {}): Node {
  return {
    publicKey: KEY,
    reportedName: "Reported",
    reportedRole: "repeater",
    reportedType: 2,
    userLabel: null,
    userRole: null,
    lastHeardAt: null,
    pathHops: null,
    position: null,
    pathCompanionKey: null,
    inContacts: true,
    dashboardPinned: false,
    createdAt: 1,
    syncedAt: 1,
    ...overrides,
  };
}

describe("NODE_ROLES", () => {
  it("lists the four roles", () => {
    expect(NODE_ROLES).toEqual(["repeater", "room_server", "chat", "unknown"]);
  });
});

describe("roleFromContactType", () => {
  it.each([
    [0, "unknown"],
    [1, "chat"],
    [2, "repeater"],
    [3, "room_server"],
    [4, "unknown"],
    [255, "unknown"],
    [-1, "unknown"],
    [1.5, "unknown"],
  ] as const)("maps type %s to %s", (type, role) => {
    expect(roleFromContactType(type)).toBe(role);
  });
});

describe("effectiveRole", () => {
  it("uses the reported role without a user role", () => {
    expect(effectiveRole(node({ reportedRole: "room_server" }))).toBe("room_server");
  });

  it("lets the user role win", () => {
    expect(effectiveRole(node({ reportedRole: "unknown", userRole: "repeater" }))).toBe("repeater");
  });
});

describe("displayName", () => {
  it("prefers the user label", () => {
    expect(displayName(node({ userLabel: "Hilltop" }))).toBe("Hilltop");
  });

  it("falls back to the reported name", () => {
    expect(displayName(node())).toBe("Reported");
  });

  it("is null when neither exists", () => {
    expect(displayName(node({ reportedName: "" }))).toBeNull();
  });
});

describe("keyPrefix", () => {
  it("returns the first 8 hex characters", () => {
    expect(keyPrefix("0123456789abcdef".repeat(4))).toBe("01234567");
  });
});

describe("isOnDashboard", () => {
  const cases: [NodeRole, boolean, boolean][] = [
    ["repeater", false, true],
    ["repeater", true, true],
    ["room_server", false, true],
    ["room_server", true, true],
    ["unknown", false, true],
    ["unknown", true, true],
    ["chat", false, false],
    ["chat", true, true],
  ];
  it.each(cases)("role %s pinned %s -> %s", (role, pinned, expected) => {
    expect(isOnDashboard(node({ reportedRole: role, dashboardPinned: pinned }))).toBe(expected);
  });

  it("follows the user role", () => {
    expect(isOnDashboard(node({ reportedRole: "repeater", userRole: "chat" }))).toBe(false);
    expect(isOnDashboard(node({ reportedRole: "chat", userRole: "repeater" }))).toBe(true);
  });
});

describe("normalizeLabel", () => {
  it("trims", () => {
    expect(normalizeLabel("  Hilltop  ")).toEqual({ ok: true, value: "Hilltop" });
  });

  it("maps whitespace only and empty to null", () => {
    expect(normalizeLabel(" \t\n ")).toEqual({ ok: true, value: null });
    expect(normalizeLabel("")).toEqual({ ok: true, value: null });
  });

  it("accepts 64 code points", () => {
    const label = "a".repeat(64);
    expect(normalizeLabel(label)).toEqual({ ok: true, value: label });
  });

  it("rejects 65 code points", () => {
    expect(normalizeLabel("a".repeat(65))).toEqual({ ok: false, reason: "TOO_LONG" });
  });

  it("counts an emoji as one", () => {
    const label = "😀".repeat(64);
    expect(normalizeLabel(label)).toEqual({ ok: true, value: label });
    expect(normalizeLabel("😀".repeat(65))).toEqual({ ok: false, reason: "TOO_LONG" });
  });

  it("measures the length after trimming", () => {
    expect(normalizeLabel(` ${"a".repeat(64)} `)).toEqual({ ok: true, value: "a".repeat(64) });
  });
});

describe("contactLastHeard", () => {
  it("maps 0 to null", () => {
    expect(contactLastHeard(0)).toBeNull();
  });

  it("converts seconds to milliseconds", () => {
    expect(contactLastHeard(1_700_000_000)).toBe(1_700_000_000_000);
  });
});

describe("sortNodes", () => {
  it("sorts by display name, case-insensitive, then by key, without mutating", () => {
    const a = node({ publicKey: "02".repeat(32), reportedName: "bravo" });
    const b = node({ publicKey: "01".repeat(32), reportedName: "Alpha" });
    const c = node({ publicKey: "03".repeat(32), reportedName: "alpha" });
    const d = node({ publicKey: "04".repeat(32), reportedName: "", userLabel: null });
    const input = [a, b, c, d];
    const sorted = sortNodes(input);
    expect(sorted.map((n) => n.publicKey)).toEqual([
      d.publicKey,
      b.publicKey,
      c.publicKey,
      a.publicKey,
    ]);
    expect(input[0]).toBe(a);
  });

  it("breaks name ties by key in either input order", () => {
    const low = node({ publicKey: "01".repeat(32), reportedName: "Same" });
    const high = node({ publicKey: "02".repeat(32), reportedName: "Same" });
    expect(sortNodes([high, low]).map((n) => n.publicKey)).toEqual([low.publicKey, high.publicKey]);
    expect(sortNodes([low, high]).map((n) => n.publicKey)).toEqual([low.publicKey, high.publicKey]);
  });

  it("keeps two entries with the same name and key in input order", () => {
    const first = node({ reportedName: "Same", createdAt: 1 });
    const second = node({ reportedName: "Same", createdAt: 2 });
    expect(sortNodes([first, second])).toEqual([first, second]);
    expect(sortNodes([second, first])).toEqual([second, first]);
  });

  it("sorts by the label when set", () => {
    const a = node({ publicKey: "01".repeat(32), reportedName: "Zed", userLabel: "Alpha" });
    const b = node({ publicKey: "02".repeat(32), reportedName: "Beta" });
    expect(sortNodes([b, a]).map((n) => n.publicKey)).toEqual([a.publicKey, b.publicKey]);
  });
});
