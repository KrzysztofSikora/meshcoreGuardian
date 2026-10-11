import { describe, expect, it } from "vitest";

import { ExpoSqlDriver, type ExpoDatabase } from "./expo-sql-driver";

function stub(log: string[], failOn?: string): ExpoDatabase {
  const step = async (sql: string) => {
    log.push(`start ${sql}`);
    await new Promise((resolve) => setTimeout(resolve, 1));
    if (sql === failOn) throw new Error("boom");
    log.push(`end ${sql}`);
  };
  return {
    execAsync: step,
    runAsync: async (sql) => {
      await step(sql);
      return { changes: 1 };
    },
    getAllAsync: async <T>(sql: string) => {
      await step(sql);
      return [] as T[];
    },
  };
}

describe("ExpoSqlDriver", () => {
  it("runs calls and transactions one at a time", async () => {
    const log: string[] = [];
    const driver = new ExpoSqlDriver(stub(log));
    const tx = driver.transaction(async (inner) => {
      await inner.run("A");
      await inner.run("B");
    });
    const outside = driver.run("C");
    await Promise.all([tx, outside]);
    expect(log.filter((line) => line.startsWith("start "))).toEqual([
      "start BEGIN IMMEDIATE",
      "start A",
      "start B",
      "start COMMIT",
      "start C",
    ]);
    expect(log.indexOf("end COMMIT")).toBeLessThan(log.indexOf("start C"));
  });

  it("rolls back when the transaction function throws and keeps working", async () => {
    const log: string[] = [];
    const driver = new ExpoSqlDriver(stub(log));
    await expect(
      driver.transaction(async (inner) => {
        await inner.run("A");
        throw new Error("nope");
      }),
    ).rejects.toThrow("nope");
    expect(log).toContain("end ROLLBACK");
    expect(log).not.toContain("start COMMIT");
    await expect(driver.all("D")).resolves.toEqual([]);
  });

  it("a failing statement does not block the queue", async () => {
    const log: string[] = [];
    const driver = new ExpoSqlDriver(stub(log, "BAD"));
    await expect(driver.run("BAD")).rejects.toThrow("boom");
    await expect(driver.run("OK")).resolves.toEqual({ changes: 1 });
  });

  it("refuses a nested transaction", async () => {
    const driver = new ExpoSqlDriver(stub([]));
    await expect(driver.transaction((inner) => inner.transaction(async () => 1))).rejects.toThrow(
      "Nested",
    );
  });
});
