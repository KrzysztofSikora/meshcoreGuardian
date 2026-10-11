export type SqlValue = string | number | null;

/** Minimal async SQL port. Drivers: expo-sqlite in the app, node:sqlite in storage tests. */
export interface SqlDriver {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: readonly SqlValue[]): Promise<{ changes: number }>;
  all<T>(sql: string, params?: readonly SqlValue[]): Promise<T[]>;
  /** Commits when `fn` resolves, rolls back when it throws. Queries must go through `tx`. */
  transaction<T>(fn: (tx: SqlDriver) => Promise<T>): Promise<T>;
}
