import type { DataEraser } from "@guardian/domain";

import type { SqlDriver } from "../driver";

/**
 * Deletes child rows explicitly, so it does not depend on `PRAGMA foreign_keys`, and does each
 * action in one transaction (settings D-8).
 */
export class SqliteDataEraser implements DataEraser {
  constructor(private readonly driver: SqlDriver) {}

  async eraseNodeHistory(publicKey: string): Promise<void> {
    await this.driver.transaction(async (tx) => {
      const device = "(SELECT id FROM devices WHERE public_key = ?)";
      const runs = `(SELECT id FROM diagnostic_runs WHERE device_id = ${device})`;
      await tx.run(`DELETE FROM telemetry_samples WHERE device_id = ${device}`, [publicKey]);
      await tx.run(`DELETE FROM diagnostic_checks WHERE run_id IN ${runs}`, [publicKey]);
      await tx.run(`DELETE FROM diagnostic_runs WHERE device_id = ${device}`, [publicKey]);
      await tx.run("UPDATE devices SET user_label = NULL, user_role = NULL WHERE public_key = ?", [
        publicKey,
      ]);
    });
  }

  async eraseAll(): Promise<void> {
    await this.driver.transaction(async (tx) => {
      for (const table of [
        "telemetry_samples",
        "diagnostic_checks",
        "diagnostic_runs",
        "devices",
        "contact_sync_origin",
      ]) {
        await tx.run(`DELETE FROM ${table}`);
      }
    });
  }
}
