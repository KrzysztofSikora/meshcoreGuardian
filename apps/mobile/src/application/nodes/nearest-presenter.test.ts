import type { Node, SyncOrigin } from "@guardian/domain";
import { describe, expect, it } from "vitest";

import { formatDistance, nearestCard } from "./nearest-presenter";

const KRAKOW = { lat: 50.0647, lon: 19.945 };
const SYNCED = 1_000;

function node(over: Partial<Node> & { publicKey: string }): Node {
  return {
    reportedName: "R",
    reportedRole: "repeater",
    reportedType: 2,
    userLabel: null,
    userRole: null,
    lastHeardAt: 500,
    pathHops: null,
    position: null,
    pathCompanionKey: "c".repeat(64),
    inContacts: true,
    dashboardPinned: true,
    createdAt: 0,
    syncedAt: SYNCED,
    ...over,
  };
}

const origin = (position: SyncOrigin["position"]): SyncOrigin => ({
  companionPublicKey: "c".repeat(64),
  position,
  at: SYNCED,
});

const fmt = (ms: number) => `T${ms}`;

describe("formatDistance (D-7)", () => {
  it.each([
    [0, "0 m"],
    [4, "0 m"],
    [5, "10 m"],
    [854, "850 m"],
    [995, "1 km"],
    [999, "1 km"],
    [1000, "1.0 km"],
    [1234, "1.2 km"],
    [9949, "9.9 km"],
    [10_000, "10 km"],
    [23_400, "23 km"],
    [252_700, "253 km"],
  ])("%s m -> %s", (m, expected) => {
    expect(formatDistance(m)).toBe(expected);
  });
});

describe("nearestCard", () => {
  it("is empty without a repeater and points at Sync contacts (AC5)", () => {
    const card = nearestCard([node({ publicKey: "a", reportedRole: "chat", reportedType: 1 })], null, fmt);
    expect(card).toEqual({
      kind: "empty",
      text: { key: "nearest.empty" },
      syncHint: { key: "nearest.syncHint" },
    });
  });

  it("names path, position, last heard and as-of for the nearest (AC1, AC4)", () => {
    const near = node({
      publicKey: "a",
      reportedName: "Hilltop",
      pathHops: 0,
      position: { lat: KRAKOW.lat + 0.1, lon: KRAKOW.lon },
    });
    const card = nearestCard([near], origin(KRAKOW), fmt);
    if (card.kind !== "found") throw new Error("expected found");
    expect(card.nearest.publicKey).toBe("a");
    expect(card.nearest.name).toEqual({ key: "nodes.name", params: { name: "Hilltop" } });
    expect(card.nearest.path).toEqual({ key: "nearest.path.direct" });
    expect(card.nearest.position).toEqual({
      key: "nearest.position.distance",
      params: { distance: "11 km", direction: { key: "nearest.compass.N" } },
    });
    expect(card.nearest.lastHeard).toEqual({ key: "nodes.lastHeard", params: { time: "T500" } });
    expect(card.asOf).toEqual({ key: "nearest.asOf", params: { time: "T1000" } });
    expect(card.others).toEqual([]);
  });

  it("uses a plural path text for hops", () => {
    const card = nearestCard([node({ publicKey: "a", pathHops: 2 })], origin(null), fmt);
    if (card.kind !== "found") throw new Error("expected found");
    expect(card.nearest.path).toEqual({ key: "nearest.path.hops", params: { count: 2 } });
  });

  it("says 'Path unknown' for an unknown path (AC3)", () => {
    const card = nearestCard([node({ publicKey: "a" })], origin(KRAKOW), fmt);
    if (card.kind !== "found") throw new Error("expected found");
    expect(card.nearest.path).toEqual({ key: "nearest.path.unknown" });
  });

  it("says 'Position not advertised' when only the node lacks a position", () => {
    const card = nearestCard([node({ publicKey: "a" })], origin(KRAKOW), fmt);
    if (card.kind !== "found") throw new Error("expected found");
    expect(card.nearest.position).toEqual({ key: "nearest.position.notAdvertised" });
  });

  it("says 'Companion position not set' when the companion lacks one, even if the node lacks too (D-5)", () => {
    const withPos = node({ publicKey: "a", position: KRAKOW });
    const without = node({ publicKey: "b" });
    for (const n of [withPos, without]) {
      const card = nearestCard([n], origin(null), fmt);
      if (card.kind !== "found") throw new Error("expected found");
      expect(card.nearest.position).toEqual({ key: "nearest.position.companionNotSet" });
    }
  });

  it("says 'Companion position not set' without any sync origin", () => {
    const card = nearestCard([node({ publicKey: "a" })], null, fmt);
    if (card.kind !== "found") throw new Error("expected found");
    expect(card.nearest.position).toEqual({ key: "nearest.position.companionNotSet" });
    expect(card.asOf).toBeNull();
  });

  it("shows no direction at distance 0", () => {
    const card = nearestCard([node({ publicKey: "a", position: KRAKOW })], origin(KRAKOW), fmt);
    if (card.kind !== "found") throw new Error("expected found");
    expect(card.nearest.position).toEqual({
      key: "nearest.position.noDirection",
      params: { distance: "0 m" },
    });
  });

  it("lists up to 5 others in rank order", () => {
    const nodes = Array.from({ length: 8 }, (_, i) =>
      node({ publicKey: `k${i}`, reportedName: `N${i}`, pathHops: i }),
    );
    const card = nearestCard([...nodes].reverse(), origin(null), fmt);
    if (card.kind !== "found") throw new Error("expected found");
    expect(card.nearest.publicKey).toBe("k0");
    expect(card.others.map((o) => o.publicKey)).toEqual(["k1", "k2", "k3", "k4", "k5"]);
  });

  it("ignores nodes whose path came from another companion (plan-review 1)", () => {
    const stale = node({ publicKey: "old", pathHops: 0, pathCompanionKey: "d".repeat(64) });
    const fresh = node({ publicKey: "new", pathHops: 3 });
    const card = nearestCard([stale, fresh], origin(null), fmt);
    if (card.kind !== "found") throw new Error("expected found");
    expect(card.nearest.publicKey).toBe("new");
  });

  it("keeps repeaters an earlier partial sync from the same companion reported (R2)", () => {
    const earlier = node({ publicKey: "earlier", pathHops: 1, syncedAt: SYNCED - 10 });
    const card = nearestCard([earlier], origin(null), fmt);
    if (card.kind !== "found") throw new Error("expected found");
    expect(card.nearest.publicKey).toBe("earlier");
  });
});
