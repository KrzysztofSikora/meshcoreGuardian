import type { SqlDriver } from "./driver";
import { MIGRATIONS, type Migration } from "./migrations/generated";

export class SchemaTooNewError extends Error {
  constructor(
    readonly found: number,
    readonly supported: number,
  ) {
    super(`Database schema version ${found} is newer than the supported version ${supported}.`);
    this.name = "SchemaTooNewError";
  }
}

/** Applies every migration above `PRAGMA user_version`, each in its own transaction. */
export async function migrateToLatest(
  driver: SqlDriver,
  migrations: readonly Migration[] = MIGRATIONS,
): Promise<{ from: number; to: number }> {
  const rows = await driver.all<{ user_version: number }>("PRAGMA user_version");
  const from = rows[0]?.user_version ?? 0;
  const latest = migrations.length === 0 ? 0 : Math.max(...migrations.map((m) => m.version));
  if (from > latest) throw new SchemaTooNewError(from, latest);

  let current = from;
  for (const migration of [...migrations].sort((a, b) => a.version - b.version)) {
    if (migration.version <= current) continue;
    await driver.transaction(async (tx) => {
      await tx.exec(migration.sql);
      await tx.exec(`PRAGMA user_version = ${migration.version}`);
    });
    current = migration.version;
  }
  return { from, to: current };
}
