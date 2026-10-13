import { describe, expect, it } from "vitest";

import type { GeoPoint } from "../geo/geo";
import { nearestRepeaters, rankRepeaters } from "./nearest";
import type { Node } from "./node";

const COMPANION: GeoPoint = { lat: 50, lon: 20 };

let seq = 0;
function node(overrides: Partial<Node> = {}): Node {
  seq += 1;
  return {
    publicKey: seq.toString(16).padStart(64, "0"),
    reportedName: `Node ${seq}`,
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

const keys = (nodes: readonly { node: Node }[]) => nodes.map((r) => r.node.publicKey);

describe("rankRepeaters candidates", () => {
  it("keeps contact repeaters and room servers only", () => {
    const rep = node();
    const room = node({ reportedRole: "room_server" });
    const chat = node({ reportedRole: "chat" });
    const gone = node({ inContacts: false });
    expect(keys(rankRepeaters([room, chat, gone, rep], null))).toEqual([rep.publicKey, room.publicKey]);
  });

  it("ranks a room server by the same rules as a repeater", () => {
    const rep = node({ pathHops: 2 });
    const room = node({ reportedRole: "room_server", pathHops: 0 });
    expect(keys(rankRepeaters([rep, room], null))).toEqual([room.publicKey, rep.publicKey]);
  });

  it("counts a user role override in both directions", () => {
    const promoted = node({ reportedRole: "chat", userRole: "repeater" });
    const demoted = node({ userRole: "chat" });
    expect(keys(rankRepeaters([promoted, demoted], null))).toEqual([promoted.publicKey]);
  });

  it("returns nothing for no nodes", () => {
    expect(rankRepeaters([], COMPANION)).toEqual([]);
    expect(nearestRepeaters([], COMPANION)).toEqual({ nearest: null, others: [] });
  });

  it("only ranks nodes whose path came from the given companion", () => {
    const other = node({ pathHops: 0, pathCompanionKey: "b".repeat(64) });
    const mine = node({ pathHops: 3, pathCompanionKey: "a".repeat(64) });
    expect(keys(rankRepeaters([other, mine], null, "a".repeat(64)))).toEqual([mine.publicKey]);
    expect(keys(rankRepeaters([other, mine], null, null))).toEqual([other.publicKey, mine.publicKey]);
  });

  it("keeps repeaters synced earlier from the same companion (partial sync)", () => {
    const key = "a".repeat(64);
    const earlier = node({ pathHops: 1, pathCompanionKey: key, syncedAt: 10 });
    const later = node({ pathHops: 2, pathCompanionKey: key, syncedAt: 20 });
    expect(keys(rankRepeaters([earlier, later], null, key))).toEqual([
      earlier.publicKey,
      later.publicKey,
    ]);
  });
});

describe("rankRepeaters order", () => {
  it("puts fewer hops first, direct before any hop, unknown last", () => {
    const unknown = node({ pathHops: null, position: { lat: 50, lon: 20.001 } });
    const two = node({ pathHops: 2 });
    const direct = node({ pathHops: 0 });
    const one = node({ pathHops: 1 });
    expect(keys(rankRepeaters([unknown, two, direct, one], null))).toEqual([
      direct.publicKey,
      one.publicKey,
      two.publicKey,
      unknown.publicKey,
    ]);
  });

  it("breaks equal hops by distance, unknown distance last", () => {
    const far = node({ pathHops: 1, position: { lat: 50, lon: 21 } });
    const near = node({ pathHops: 1, position: { lat: 50, lon: 20.01 } });
    const none = node({ pathHops: 1, position: null });
    expect(keys(rankRepeaters([none, far, near], COMPANION))).toEqual([
      near.publicKey,
      far.publicKey,
      none.publicKey,
    ]);
  });

  it("ignores distance when the companion has no position", () => {
    const a = node({ pathHops: 1, position: { lat: 50, lon: 21 }, lastHeardAt: 100 });
    const b = node({ pathHops: 1, position: { lat: 50, lon: 20.01 }, lastHeardAt: 200 });
    const ranked = rankRepeaters([a, b], null);
    expect(keys(ranked)).toEqual([b.publicKey, a.publicKey]);
    expect(ranked.every((r) => r.distanceM === null && r.direction === null)).toBe(true);
  });

  it("does not let hops lose to a closer position", () => {
    const close = node({ pathHops: 2, position: { lat: 50, lon: 20.001 } });
    const direct = node({ pathHops: 0, position: { lat: 51, lon: 20 } });
    expect(keys(rankRepeaters([close, direct], COMPANION))[0]).toBe(direct.publicKey);
  });

  it("breaks equal hops and distance by last heard, newest first, never heard last", () => {
    const old = node({ pathHops: 1, lastHeardAt: 100 });
    const recent = node({ pathHops: 1, lastHeardAt: 900 });
    const never = node({ pathHops: 1, lastHeardAt: null });
    expect(keys(rankRepeaters([never, old, recent], null))).toEqual([
      recent.publicKey,
      old.publicKey,
      never.publicKey,
    ]);
  });

  it("breaks a full tie by public key ascending", () => {
    const a = node({ publicKey: "aa".repeat(32) });
    const b = node({ publicKey: "bb".repeat(32) });
    const c = node({ publicKey: "cc".repeat(32) });
    expect(keys(rankRepeaters([c, a, b], null))).toEqual([a.publicKey, b.publicKey, c.publicKey]);
  });

  it("orders a full tie by public key whatever the input order", () => {
    const a = node({ publicKey: "aa".repeat(32) });
    const b = node({ publicKey: "bb".repeat(32) });
    const c = node({ publicKey: "cc".repeat(32) });
    const perms = [
      [a, b, c],
      [a, c, b],
      [b, a, c],
      [b, c, a],
      [c, a, b],
      [c, b, a],
    ];
    for (const input of perms) {
      expect(keys(rankRepeaters(input, null))).toEqual([a.publicKey, b.publicKey, c.publicKey]);
    }
  });

  it("falls through to the next criterion when both values are unknown", () => {
    const near = { lat: 50, lon: 20.001 };
    const far = { lat: 50, lon: 20.01 };
    const a = node({ pathHops: null, position: far, lastHeardAt: 9 });
    const b = node({ pathHops: null, position: near, lastHeardAt: 1 });
    const c = node({ pathHops: null, position: null, lastHeardAt: 5 });
    const d = node({ pathHops: null, position: null, lastHeardAt: 7 });
    for (const input of [
      [a, b, c, d],
      [d, c, b, a],
      [c, a, d, b],
    ]) {
      expect(keys(rankRepeaters(input, COMPANION))).toEqual([
        b.publicKey,
        a.publicKey,
        d.publicKey,
        c.publicKey,
      ]);
    }
  });

  it("treats equal distances as a tie for last heard", () => {
    const p = { lat: 50, lon: 20.01 };
    const a = node({ pathHops: 1, position: p, lastHeardAt: 1 });
    const b = node({ pathHops: 1, position: p, lastHeardAt: 2 });
    expect(keys(rankRepeaters([a, b], COMPANION))).toEqual([b.publicKey, a.publicKey]);
  });

  it("does not change the input", () => {
    const list = [node({ pathHops: 2 }), node({ pathHops: 0 })];
    const copy = [...list];
    rankRepeaters(list, null);
    expect(list).toEqual(copy);
  });
});

describe("rankRepeaters values", () => {
  it("gives hops, distance and 8-point direction", () => {
    const east = node({ pathHops: 0, position: { lat: 50, lon: 20.1 } });
    const [r] = rankRepeaters([east], COMPANION);
    expect(r?.hops).toBe(0);
    expect(r?.distanceM).toBeGreaterThan(7_000);
    expect(r?.distanceM).toBeLessThan(7_300);
    expect(r?.direction).toBe("E");
  });

  it("has a distance but no direction at the same point", () => {
    const here = node({ position: { ...COMPANION } });
    const [r] = rankRepeaters([here], COMPANION);
    expect(r?.distanceM).toBe(0);
    expect(r?.direction).toBeNull();
  });

  it("has no distance when the node has no position", () => {
    const [r] = rankRepeaters([node()], COMPANION);
    expect(r?.distanceM).toBeNull();
    expect(r?.direction).toBeNull();
  });
});

describe("nearestRepeaters", () => {
  const nine = Array.from({ length: 9 }, (_, i) => node({ pathHops: i }));

  it("names the best and up to 5 others, in order", () => {
    const { nearest, others } = nearestRepeaters(nine, null);
    expect(nearest?.node.publicKey).toBe(nine[0]?.publicKey);
    expect(keys(others)).toEqual(nine.slice(1, 6).map((n) => n.publicKey));
  });

  it("returns fewer others when fewer exist", () => {
    const { nearest, others } = nearestRepeaters(nine.slice(0, 3), null);
    expect(nearest).not.toBeNull();
    expect(others).toHaveLength(2);
  });

  it("returns no others for a single repeater", () => {
    expect(nearestRepeaters(nine.slice(0, 1), null).others).toEqual([]);
  });

  it("honours a custom count and the sync filter", () => {
    expect(nearestRepeaters(nine, null, null, 2).others).toHaveLength(2);
    const stale = nine.map((n) => ({ ...n, pathCompanionKey: "b".repeat(64) }));
    expect(nearestRepeaters(stale, null, "a".repeat(64)).nearest).toBeNull();
  });
});
