import { backfillTelemetrySamples, migrateToLatest, type SqlDriver } from "@guardian/storage";
import { openDatabaseSync } from "expo-sqlite";

import { ExpoSqlDriver } from "./expo-sql-driver";

const DATABASE_NAME = "guardian.db";

/** Opens the app database, turns on foreign keys and applies pending migrations (plan D-2). */
export async function openGuardianDb(): Promise<SqlDriver> {
  const driver = new ExpoSqlDriver(openDatabaseSync(DATABASE_NAME));
  await driver.exec("PRAGMA foreign_keys = ON");
  await migrateToLatest(driver);
  // Samples for runs stored before schema v4 (D-3). Derived data: a failure must not block start.
  await backfillTelemetrySamples(driver).catch(() => 0);
  return driver;
}
