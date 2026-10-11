import type { DatabaseSync, SQLInputValue } from "node:sqlite";

import type { SqlDriver, SqlValue } from "../../src/driver";

/** SqlDriver over node:sqlite, for storage tests only. */
export class NodeSqlDriver implements SqlDriver {
  constructor(
    private readonly db: DatabaseSync,
    private readonly inTransaction = false,
  ) {}

  async exec(sql: string): Promise<void> {
    this.db.exec(sql);
  }

  async run(sql: string, params: readonly SqlValue[] = []): Promise<{ changes: number }> {
    const result = this.db.prepare(sql).run(...(params as SQLInputValue[]));
    return { changes: Number(result.changes) };
  }

  async all<T>(sql: string, params: readonly SqlValue[] = []): Promise<T[]> {
    return this.db.prepare(sql).all(...(params as SQLInputValue[])) as T[];
  }

  async transaction<T>(fn: (tx: SqlDriver) => Promise<T>): Promise<T> {
    if (this.inTransaction) throw new Error("Nested transactions are not supported.");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = await fn(new NodeSqlDriver(this.db, true));
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}
