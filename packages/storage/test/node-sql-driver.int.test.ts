import { afterEach, describe, expect, it } from "vitest";

import { openTestDb, type TestDb } from "./helpers/open-test-db";

describe("NodeSqlDriver.transaction", () => {
  let testDb: TestDb | undefined;
  afterEach(() => {
    testDb?.close();
    testDb = undefined;
  });

  const count = async (db: TestDb) =>
    (await db.driver.all<{ n: number }>("SELECT count(*) AS n FROM t"))[0]?.n;

  it("commits when the callback resolves", async () => {
    testDb = await openTestDb({ migrate: false });
    await testDb.driver.exec("CREATE TABLE t (id INTEGER)");

    const value = await testDb.driver.transaction(async (tx) => {
      await tx.run("INSERT INTO t VALUES (?)", [1]);
      return "done";
    });

    expect(value).toBe("done");
    expect(await count(testDb)).toBe(1);
  });

  it("rolls back when the callback throws", async () => {
    testDb = await openTestDb({ migrate: false });
    await testDb.driver.exec("CREATE TABLE t (id INTEGER)");

    await expect(
      testDb.driver.transaction(async (tx) => {
        await tx.run("INSERT INTO t VALUES (?)", [1]);
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(await count(testDb)).toBe(0);
  });
});
