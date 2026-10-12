import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

import type { ContactReport } from "@guardian/domain";

import { applyContactSync } from "../src/sync/contacts";
import { openTestDb, type TestDb } from "./helpers/open-test-db";

const key = (n: number) => n.toString(16).padStart(64, "0");

const report = (n: number, over: Partial<ContactReport> = {}): ContactReport => ({
  publicKey: key(n),
  name: `node-${n}`,
  type: 2,
  lastHeardAt: 1_000 * n,
  pathHops: null,
  position: null,
  ...over,
});

type Row = {
  public_key: string;
  reported_name: string;
  reported_role: string;
  reported_type: number;
  user_label: string | null;
  user_role: string | null;
  in_contacts: number;
  dashboard_pinned: number;
  created_at: number;
  synced_at: number;
};

const rows = (db: TestDb) => db.driver.all<Row>("SELECT * FROM devices ORDER BY public_key");

const ORIGIN = { companionPublicKey: "c".repeat(64), position: null };

describe("applyContactSync", () => {
  let testDb: TestDb | undefined;
  afterEach(() => {
    testDb?.close();
    testDb = undefined;
  });

  it("stores a contact once however often it is synced", async () => {
    testDb = await openTestDb();
    const reports = [report(1), report(2, { type: 3 })];

    const first = await applyContactSync(testDb.driver, reports, {
      complete: true,
      now: 10,
      origin: ORIGIN,
    });
    const second = await applyContactSync(testDb.driver, reports, {
      complete: true,
      now: 20,
      origin: ORIGIN,
    });

    expect(first).toEqual({ added: 2, updated: 0, markedMissing: 0 });
    expect(second).toEqual({ added: 0, updated: 2, markedMissing: 0 });
    const stored = await rows(testDb);
    expect(stored.map((r) => r.reported_role)).toEqual(["repeater", "room_server"]);
    expect(stored.map((r) => r.created_at)).toEqual([10, 10]);
    expect(stored.map((r) => r.synced_at)).toEqual([20, 20]);
  });

  it("keeps the user label, role and pin when the protocol values change", async () => {
    testDb = await openTestDb();
    await applyContactSync(testDb.driver, [report(1, { type: 4 })], {
      complete: true,
      now: 10,
      origin: ORIGIN,
    });
    await testDb.driver.run(
      "UPDATE devices SET user_label = 'Hilltop', user_role = 'repeater', dashboard_pinned = 1",
    );

    await applyContactSync(
      testDb.driver,
      [report(1, { name: "renamed", type: 1, lastHeardAt: 5 })],
      {
        complete: true,
        now: 20,
        origin: ORIGIN,
      },
    );

    const [row] = await rows(testDb);
    expect(row).toMatchObject({
      reported_name: "renamed",
      reported_role: "chat",
      reported_type: 1,
      user_label: "Hilltop",
      user_role: "repeater",
      dashboard_pinned: 1,
      in_contacts: 1,
    });
  });

  it("marks a contact missing after a complete sync, keeps its row, and restores it when it returns", async () => {
    testDb = await openTestDb();
    await applyContactSync(testDb.driver, [report(1), report(2)], {
      complete: true,
      now: 10,
      origin: ORIGIN,
    });
    await testDb.driver.run("UPDATE devices SET user_label = 'Keep' WHERE public_key = ?", [
      key(2),
    ]);

    const outcome = await applyContactSync(testDb.driver, [report(1)], {
      complete: true,
      now: 20,
      origin: ORIGIN,
    });

    expect(outcome.markedMissing).toBe(1);
    let stored = await rows(testDb);
    expect(stored.map((r) => r.in_contacts)).toEqual([1, 0]);
    expect(stored[1]).toMatchObject({ user_label: "Keep", reported_name: "node-2" });

    await applyContactSync(testDb.driver, [report(1), report(2)], {
      complete: true,
      now: 30,
      origin: ORIGIN,
    });
    stored = await rows(testDb);
    expect(stored.map((r) => r.in_contacts)).toEqual([1, 1]);
  });

  it("marks nothing missing after an incomplete sync, but stores what came", async () => {
    testDb = await openTestDb();
    await applyContactSync(testDb.driver, [report(1), report(2)], {
      complete: true,
      now: 10,
      origin: ORIGIN,
    });

    const outcome = await applyContactSync(testDb.driver, [report(1, { name: "new" })], {
      complete: false,
      now: 20,
      origin: ORIGIN,
    });

    expect(outcome).toEqual({ added: 0, updated: 1, markedMissing: 0 });
    const stored = await rows(testDb);
    expect(stored.map((r) => r.in_contacts)).toEqual([1, 1]);
    expect(stored[0]?.reported_name).toBe("new");
  });

  it("marks nothing missing after a complete sync with zero contacts", async () => {
    testDb = await openTestDb();
    await applyContactSync(testDb.driver, [report(1)], { complete: true, now: 10, origin: ORIGIN });

    const outcome = await applyContactSync(testDb.driver, [], {
      complete: true,
      now: 20,
      origin: ORIGIN,
    });

    expect(outcome).toEqual({ added: 0, updated: 0, markedMissing: 0 });
    expect((await rows(testDb))[0]?.in_contacts).toBe(1);
  });

  it("applies the 350 contacts of the real fixture in one call", async () => {
    testDb = await openTestDb();
    const fixture = JSON.parse(
      readFileSync(
        new URL("../../meshcore-adapter/fixtures/v1.17.1-d929643/handshake.json", import.meta.url),
        "utf8",
      ),
    ) as {
      frames: { decoded?: { kind: string; publicKey?: string; name?: string; type?: number } }[];
    };
    const reports = fixture.frames.flatMap((f) =>
      f.decoded?.kind === "contact"
        ? [
            {
              publicKey: f.decoded.publicKey!,
              name: f.decoded.name!,
              type: f.decoded.type!,
              lastHeardAt: null,
              pathHops: null,
              position: null,
            },
          ]
        : [],
    );
    expect(reports).toHaveLength(350);

    const outcome = await applyContactSync(testDb.driver, reports, {
      complete: true,
      now: 1,
      origin: ORIGIN,
    });
    const again = await applyContactSync(testDb.driver, reports, {
      complete: true,
      now: 2,
      origin: ORIGIN,
    });

    expect(outcome.added).toBe(350);
    expect(again).toEqual({ added: 0, updated: 350, markedMissing: 0 });
    expect(await rows(testDb)).toHaveLength(350);
  });

  it("rolls back the whole batch when one insert fails", async () => {
    testDb = await openTestDb();
    await applyContactSync(testDb.driver, [report(1)], { complete: true, now: 10, origin: ORIGIN });

    await expect(
      applyContactSync(
        testDb.driver,
        [report(2), report(1, { name: "changed" }), report(3, { publicKey: "short" })],
        { complete: true, now: 20, origin: ORIGIN },
      ),
    ).rejects.toThrow();

    const stored = await rows(testDb);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ reported_name: "node-1", synced_at: 10 });
  });

  it("stores path and position, and a later sync replaces them, also with nothing", async () => {
    testDb = await openTestDb();
    const geo = { pathHops: 3, position: { lat: 50.06, lon: 19.94 } };
    await applyContactSync(testDb.driver, [report(1, geo)], {
      complete: true,
      now: 10,
      origin: ORIGIN,
    });
    const read = () =>
      testDb!.driver.all<{
        path_hops: number | null;
        adv_lat: number | null;
        adv_lon: number | null;
      }>("SELECT path_hops, adv_lat, adv_lon FROM devices");
    expect(await read()).toEqual([{ path_hops: 3, adv_lat: 50.06, adv_lon: 19.94 }]);

    await applyContactSync(testDb.driver, [report(1, { pathHops: 0 })], {
      complete: true,
      now: 20,
      origin: ORIGIN,
    });
    expect(await read()).toEqual([{ path_hops: 0, adv_lat: null, adv_lon: null }]);

    await applyContactSync(testDb.driver, [report(1)], { complete: true, now: 30, origin: ORIGIN });
    expect(await read()).toEqual([{ path_hops: null, adv_lat: null, adv_lon: null }]);
  });

  it("replaces the sync origin instead of adding a row, with the sync time", async () => {
    testDb = await openTestDb();
    const origin = (n: number, position: { lat: number; lon: number } | null) => ({
      companionPublicKey: key(n),
      position,
    });
    await applyContactSync(testDb.driver, [report(1)], {
      complete: true,
      now: 10,
      origin: origin(90, { lat: 50, lon: 19 }),
    });
    await applyContactSync(testDb.driver, [report(1)], {
      complete: true,
      now: 20,
      origin: origin(91, null),
    });

    expect(await testDb.driver.all("SELECT * FROM contact_sync_origin")).toEqual([
      {
        id: 1,
        companion_public_key: key(91),
        companion_lat: null,
        companion_lon: null,
        synced_at: 20,
      },
    ]);
  });

  it("leaves the origin as it was when the batch fails", async () => {
    testDb = await openTestDb();
    await applyContactSync(testDb.driver, [report(1)], { complete: true, now: 10, origin: ORIGIN });

    await expect(
      applyContactSync(testDb.driver, [report(2, { publicKey: "short" })], {
        complete: true,
        now: 20,
        origin: { companionPublicKey: key(77), position: null },
      }),
    ).rejects.toThrow();

    const [row] = await testDb.driver.all<{ companion_public_key: string; synced_at: number }>(
      "SELECT companion_public_key, synced_at FROM contact_sync_origin",
    );
    expect(row).toEqual({ companion_public_key: ORIGIN.companionPublicKey, synced_at: 10 });
  });

  it("keeps the user's columns when path and position change", async () => {
    testDb = await openTestDb();
    await applyContactSync(testDb.driver, [report(1)], { complete: true, now: 10, origin: ORIGIN });
    await testDb.driver.run("UPDATE devices SET user_label = 'Mine', dashboard_pinned = 1");

    await applyContactSync(testDb.driver, [report(1, { pathHops: 2 })], {
      complete: true,
      now: 20,
      origin: ORIGIN,
    });

    expect((await rows(testDb))[0]).toMatchObject({ user_label: "Mine", dashboard_pinned: 1 });
  });

  it("keeps the path of a node a partial sync from another companion did not report", async () => {
    testDb = await openTestDb();
    await applyContactSync(
      testDb.driver,
      [report(1, { pathHops: 1 }), report(2, { pathHops: 4 })],
      {
        complete: true,
        now: 10,
        origin: ORIGIN,
      },
    );

    await applyContactSync(testDb.driver, [report(1, { pathHops: 5 })], {
      complete: false,
      now: 20,
      origin: { companionPublicKey: key(55), position: null },
    });

    const stored = await testDb.driver.all<{ path_companion_key: string; synced_at: number }>(
      "SELECT path_companion_key, synced_at FROM devices ORDER BY public_key",
    );
    // Node 2 keeps the companion that gave its path, so the ranking (which filters on it) skips it.
    expect(stored).toEqual([
      { path_companion_key: key(55), synced_at: 20 },
      { path_companion_key: ORIGIN.companionPublicKey, synced_at: 10 },
    ]);
  });

  it("keeps the companion of a node a partial sync from the same companion did not report", async () => {
    testDb = await openTestDb();
    await applyContactSync(testDb.driver, [report(1), report(2)], {
      complete: true,
      now: 10,
      origin: ORIGIN,
    });

    await applyContactSync(testDb.driver, [report(1)], {
      complete: false,
      now: 20,
      origin: ORIGIN,
    });

    const stored = await testDb.driver.all<{ path_companion_key: string }>(
      "SELECT path_companion_key FROM devices",
    );
    expect(stored.map((r) => r.path_companion_key)).toEqual([
      ORIGIN.companionPublicKey,
      ORIGIN.companionPublicKey,
    ]);
  });
});
