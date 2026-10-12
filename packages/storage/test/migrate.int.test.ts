import { afterEach, describe, expect, it } from "vitest";

import { migrateToLatest, SchemaTooNewError } from "../src/migrate";
import { MIGRATIONS } from "../src/migrations/generated";
import { openTestDb, type TestDb } from "./helpers/open-test-db";

const version = async (db: TestDb) =>
  (await db.driver.all<{ user_version: number }>("PRAGMA user_version"))[0]?.user_version;

const insertDevice = (db: TestDb, key: string) =>
  db.driver.run(
    `INSERT INTO devices (public_key, reported_name, reported_role, reported_type, in_contacts, created_at, synced_at)
     VALUES (?, 'n', 'repeater', 2, 1, 1, 1)`,
    [key],
  );

describe("migrateToLatest", () => {
  let testDb: TestDb | undefined;
  afterEach(() => {
    testDb?.close();
    testDb = undefined;
  });

  it("brings a fresh database to the latest version with the devices table", async () => {
    testDb = await openTestDb({ migrate: false });
    expect(await version(testDb)).toBe(0);

    const result = await migrateToLatest(testDb.driver);

    expect(result).toEqual({ from: 0, to: MIGRATIONS.length });
    expect(await version(testDb)).toBe(MIGRATIONS.length);
    const tables = await testDb.driver.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'devices'",
    );
    expect(tables).toHaveLength(1);
  });

  it("is a no-op when run twice", async () => {
    testDb = await openTestDb();

    const result = await migrateToLatest(testDb.driver);

    expect(result).toEqual({ from: MIGRATIONS.length, to: MIGRATIONS.length });
  });

  it("refuses a database from a newer app", async () => {
    testDb = await openTestDb();
    await testDb.driver.exec("PRAGMA user_version = 99");

    await expect(migrateToLatest(testDb.driver)).rejects.toThrow(SchemaTooNewError);
    expect(await version(testDb)).toBe(99);
  });

  it("rolls back a failing migration and keeps the version", async () => {
    testDb = await openTestDb();
    const broken = [
      ...MIGRATIONS,
      {
        version: MIGRATIONS.length + 1,
        name: "broken",
        sql: "CREATE TABLE half (id INTEGER); INSERT INTO missing_table VALUES (1);",
      },
    ];

    await expect(migrateToLatest(testDb.driver, broken)).rejects.toThrow();

    expect(await version(testDb)).toBe(MIGRATIONS.length);
    const half = await testDb.driver.all("SELECT name FROM sqlite_master WHERE name = 'half'");
    expect(half).toHaveLength(0);
  });

  it("keeps rows inserted at version 1 across a later migration", async () => {
    testDb = await openTestDb({ migrate: 1 });
    await insertDevice(testDb, "a".repeat(64));
    const next = [
      ...MIGRATIONS,
      {
        version: MIGRATIONS.length + 1,
        name: "extra",
        sql: "ALTER TABLE devices ADD COLUMN extra TEXT;",
      },
    ];

    await migrateToLatest(testDb.driver, next);

    expect(await version(testDb)).toBe(MIGRATIONS.length + 1);
    const rows = await testDb.driver.all<{ public_key: string; extra: string | null }>(
      "SELECT public_key, extra FROM devices",
    );
    expect(rows).toEqual([{ public_key: "a".repeat(64), extra: null }]);
  });

  it("migrates a version 1 database to 2 and keeps its devices", async () => {
    testDb = await openTestDb({ migrate: 1 });
    await insertDevice(testDb, "a".repeat(64));
    await insertDevice(testDb, "b".repeat(64));

    const result = await migrateToLatest(testDb.driver);

    expect(result).toEqual({ from: 1, to: MIGRATIONS.length });
    expect(await version(testDb)).toBe(MIGRATIONS.length);
    const keys = await testDb.driver.all<{ public_key: string }>(
      "SELECT public_key FROM devices ORDER BY id",
    );
    expect(keys.map((k) => k.public_key)).toEqual(["a".repeat(64), "b".repeat(64)]);
    const tables = await testDb.driver.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'diagnostic_%' ORDER BY name",
    );
    expect(tables.map((t) => t.name)).toEqual(["diagnostic_checks", "diagnostic_runs"]);
  });

  it("enforces the CHECK constraints of devices", async () => {
    testDb = await openTestDb();
    const insert = (label: string | null, role: string, key = "b".repeat(64)) =>
      testDb!.driver.run(
        `INSERT INTO devices (public_key, reported_name, reported_role, reported_type, user_label, in_contacts, created_at, synced_at)
         VALUES (?, 'n', ?, 2, ?, 1, 1, 1)`,
        [key, role, label],
      );

    await expect(insert("x".repeat(65), "repeater")).rejects.toThrow();
    await expect(insert("", "repeater")).rejects.toThrow();
    await expect(insert(null, "gateway")).rejects.toThrow();
    await expect(insert(null, "repeater", "short")).rejects.toThrow();
    await expect(insert("😀".repeat(64), "repeater")).resolves.toEqual({ changes: 1 });
  });

  it("migrates a version 2 database to 3 and keeps its devices with unknown path and position", async () => {
    testDb = await openTestDb({ migrate: 2 });
    await insertDevice(testDb, "a".repeat(64));

    const result = await migrateToLatest(testDb.driver);

    expect(result).toEqual({ from: 2, to: 3 });
    const rows = await testDb.driver.all<Record<string, unknown>>(
      "SELECT public_key, path_hops, adv_lat, adv_lon FROM devices",
    );
    expect(rows).toEqual([
      { public_key: "a".repeat(64), path_hops: null, adv_lat: null, adv_lon: null },
    ]);
    expect(await testDb.driver.all("SELECT * FROM contact_sync_origin")).toEqual([]);
  });

  it("enforces the CHECK constraints of path and position", async () => {
    testDb = await openTestDb();
    const set = (column: string, value: number) =>
      testDb!.driver.run(`UPDATE devices SET ${column} = ?`, [value]);
    await insertDevice(testDb, "a".repeat(64));

    await expect(set("path_hops", 64)).rejects.toThrow();
    await expect(set("path_hops", -1)).rejects.toThrow();
    await expect(set("adv_lat", 90.5)).rejects.toThrow();
    await expect(set("adv_lon", -180.5)).rejects.toThrow();
    await expect(set("path_hops", 63)).resolves.toEqual({ changes: 1 });
    await expect(
      testDb.driver.run(
        "INSERT INTO contact_sync_origin (id, companion_public_key, synced_at) VALUES (2, 'k', 1)",
      ),
    ).rejects.toThrow();
  });
});
