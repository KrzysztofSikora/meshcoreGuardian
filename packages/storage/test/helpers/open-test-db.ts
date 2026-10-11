import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type TestDb = {
  readonly db: DatabaseSync;
  readonly path: string;
  close(): void;
};

/** Opens a fresh file-backed SQLite database in its own temp directory. */
export function openTestDb(): TestDb {
  const dir = mkdtempSync(join(tmpdir(), "guardian-db-"));
  const path = join(dir, "test.db");
  const db = new DatabaseSync(path);
  return {
    db,
    path,
    close() {
      if (db.isOpen) db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
