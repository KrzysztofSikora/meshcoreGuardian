import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { migrateToLatest } from "../../src/migrate";
import { MIGRATIONS } from "../../src/migrations/generated";
import { NodeSqlDriver } from "./node-sql-driver";

export type TestDb = {
  readonly db: DatabaseSync;
  readonly driver: NodeSqlDriver;
  readonly path: string;
  close(): void;
};

export type OpenTestDbOptions = {
  /** `true` (default): all migrations; a number stops at that version; `false`: none. */
  migrate?: boolean | number;
};

/** Opens a fresh file-backed SQLite database in its own temp directory. */
export async function openTestDb(options: OpenTestDbOptions = {}): Promise<TestDb> {
  const dir = mkdtempSync(join(tmpdir(), "guardian-db-"));
  const path = join(dir, "test.db");
  const db = new DatabaseSync(path);
  const driver = new NodeSqlDriver(db);
  const migrate = options.migrate ?? true;
  if (migrate !== false) {
    const upTo = migrate === true ? Infinity : migrate;
    await migrateToLatest(
      driver,
      MIGRATIONS.filter((m) => m.version <= upTo),
    );
  }
  return {
    db,
    driver,
    path,
    close() {
      if (db.isOpen) db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
