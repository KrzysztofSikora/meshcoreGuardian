import type { ContactReport } from "@guardian/domain";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import { SqliteNodeRepository, NodeNotFoundError } from "../src/nodes/node-repository";
import { NodeSqlDriver } from "./helpers/node-sql-driver";
import { openTestDb, type TestDb } from "./helpers/open-test-db";

const KEY = "ab".repeat(32);
const report: ContactReport = {
  publicKey: KEY,
  name: "Hill",
  type: 4,
  lastHeardAt: 5_000,
  pathHops: null,
  position: null,
};

describe("SqliteNodeRepository", () => {
  let testDb: TestDb | undefined;
  afterEach(() => {
    testDb?.close();
    testDb = undefined;
  });

  it("maps a synced contact to a domain node", async () => {
    testDb = await openTestDb();
    const repo = new SqliteNodeRepository(testDb.driver);

    await repo.applySync([report], { complete: true, now: 7 });

    expect(await repo.get(KEY)).toEqual({
      publicKey: KEY,
      reportedName: "Hill",
      reportedRole: "unknown",
      reportedType: 4,
      userLabel: null,
      userRole: null,
      lastHeardAt: 5_000,
      pathHops: null,
      position: null,
      inContacts: true,
      dashboardPinned: false,
      createdAt: 7,
      syncedAt: 7,
    });
    expect(await repo.get("cd".repeat(32))).toBeNull();
    expect(await repo.listAll()).toHaveLength(1);
  });

  it("reads a contact missing from a complete sync as not in contacts, in get and listAll", async () => {
    testDb = await openTestDb();
    const repo = new SqliteNodeRepository(testDb.driver);
    const other: ContactReport = { publicKey: "cd".repeat(32), name: "Ridge", type: 2, lastHeardAt: 0, pathHops: null, position: null };

    await repo.applySync([report, other], { complete: true, now: 7 });
    await repo.applySync([other], { complete: true, now: 8 });

    expect((await repo.get(KEY))?.inContacts).toBe(false);
    expect((await repo.get(other.publicKey))?.inContacts).toBe(true);
    const listed = await repo.listAll();
    expect(listed.map((n) => [n.publicKey, n.inContacts]).sort()).toEqual([
      [KEY, false],
      [other.publicKey, true],
    ]);
  });

  it("keeps label, role and pin after the database is closed and reopened", async () => {
    testDb = await openTestDb();
    const first = new SqliteNodeRepository(testDb.driver);
    await first.applySync([report], { complete: true, now: 7 });
    await first.setLabel(KEY, "Hilltop");
    await first.setRole(KEY, "repeater");
    await first.pinToDashboard(KEY);
    testDb.db.close();

    const reopened = new DatabaseSync(testDb.path);
    try {
      const node = await new SqliteNodeRepository(new NodeSqlDriver(reopened)).get(KEY);
      expect(node).toMatchObject({
        userLabel: "Hilltop",
        userRole: "repeater",
        dashboardPinned: true,
        reportedRole: "unknown",
      });
    } finally {
      reopened.close();
    }
  });

  it("clears the label and the role with null", async () => {
    testDb = await openTestDb();
    const repo = new SqliteNodeRepository(testDb.driver);
    await repo.applySync([report], { complete: true, now: 7 });
    await repo.setLabel(KEY, "x");
    await repo.setRole(KEY, "chat");

    await repo.setLabel(KEY, null);
    await repo.setRole(KEY, null);

    expect(await repo.get(KEY)).toMatchObject({ userLabel: null, userRole: null });
  });

  it("throws NodeNotFoundError for an unknown key", async () => {
    testDb = await openTestDb();
    const repo = new SqliteNodeRepository(testDb.driver);

    await expect(repo.setLabel(KEY, "x")).rejects.toBeInstanceOf(NodeNotFoundError);
    await expect(repo.setRole(KEY, "chat")).rejects.toBeInstanceOf(NodeNotFoundError);
    await expect(repo.pinToDashboard(KEY)).rejects.toBeInstanceOf(NodeNotFoundError);
  });

  it("refuses a label of 65 characters and accepts 64", async () => {
    testDb = await openTestDb();
    const repo = new SqliteNodeRepository(testDb.driver);
    await repo.applySync([report], { complete: true, now: 7 });

    await repo.setLabel(KEY, "a".repeat(64));
    await expect(repo.setLabel(KEY, "a".repeat(65))).rejects.toThrow();

    expect((await repo.get(KEY))?.userLabel).toBe("a".repeat(64));
  });
});
