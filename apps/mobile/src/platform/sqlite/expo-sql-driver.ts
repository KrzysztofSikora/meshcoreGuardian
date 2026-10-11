import type { SqlDriver, SqlValue } from "@guardian/storage";

/** The part of expo-sqlite's `SQLiteDatabase` the driver uses; tests pass a stub. */
export interface ExpoDatabase {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, params: SqlValue[]): Promise<{ changes: number }>;
  getAllAsync<T>(sql: string, params: SqlValue[]): Promise<T[]>;
}

/** Statements on one connection with no transaction handling of their own. */
class Statements implements SqlDriver {
  constructor(protected readonly db: ExpoDatabase) {}

  exec(sql: string): Promise<void> {
    return this.db.execAsync(sql);
  }

  async run(sql: string, params: readonly SqlValue[] = []): Promise<{ changes: number }> {
    const { changes } = await this.db.runAsync(sql, [...params]);
    return { changes };
  }

  all<T>(sql: string, params: readonly SqlValue[] = []): Promise<T[]> {
    return this.db.getAllAsync<T>(sql, [...params]);
  }

  transaction<T>(_fn: (tx: SqlDriver) => Promise<T>): Promise<T> {
    return Promise.reject(new Error("Nested transactions are not supported"));
  }
}

/**
 * `SqlDriver` over one expo-sqlite connection (plan D-4, plan-review #2). Every call and every
 * transaction runs one at a time, so a user edit waits for a sync instead of failing with
 * "database is locked", and `PRAGMA foreign_keys` set on this connection always applies.
 */
export class ExpoSqlDriver extends Statements {
  private tail: Promise<unknown> = Promise.resolve();

  private serial<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task, task);
    this.tail = result.catch(() => undefined);
    return result;
  }

  override exec(sql: string): Promise<void> {
    return this.serial(() => super.exec(sql));
  }

  override run(sql: string, params?: readonly SqlValue[]): Promise<{ changes: number }> {
    return this.serial(() => super.run(sql, params));
  }

  override all<T>(sql: string, params?: readonly SqlValue[]): Promise<T[]> {
    return this.serial(() => super.all<T>(sql, params));
  }

  override transaction<T>(fn: (tx: SqlDriver) => Promise<T>): Promise<T> {
    return this.serial(async () => {
      await this.db.execAsync("BEGIN IMMEDIATE");
      try {
        const result = await fn(new Statements(this.db));
        await this.db.execAsync("COMMIT");
        return result;
      } catch (error) {
        await this.db.execAsync("ROLLBACK").catch(() => undefined);
        throw error;
      }
    });
  }
}
