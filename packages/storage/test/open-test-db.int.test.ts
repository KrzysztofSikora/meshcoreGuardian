import { existsSync } from "node:fs";
import { dirname } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { openTestDb, type TestDb } from "./helpers/open-test-db";

describe("openTestDb", () => {
  let testDb: TestDb | undefined;

  afterEach(() => {
    if (testDb && existsSync(testDb.path)) testDb.close();
    testDb = undefined;
  });

  it("opens a file-backed database that persists rows", () => {
    testDb = openTestDb();
    testDb.db.exec("CREATE TABLE node (id TEXT PRIMARY KEY, name TEXT NOT NULL)");
    testDb.db.prepare("INSERT INTO node (id, name) VALUES (?, ?)").run("a1", "Repeater");

    const row = testDb.db.prepare("SELECT id, name FROM node WHERE id = ?").get("a1");

    expect(row).toEqual({ id: "a1", name: "Repeater" });
    expect(existsSync(testDb.path)).toBe(true);
  });

  it("gives every call its own database", () => {
    const first = openTestDb();
    const second = openTestDb();
    try {
      expect(first.path).not.toBe(second.path);
    } finally {
      first.close();
      second.close();
    }
  });

  it("removes the temp directory on close", () => {
    testDb = openTestDb();
    const dir = dirname(testDb.path);

    testDb.close();

    expect(existsSync(dir)).toBe(false);
  });
});
