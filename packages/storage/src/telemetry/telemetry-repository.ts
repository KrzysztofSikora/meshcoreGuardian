import type { TelemetryRepository, TelemetrySample } from "@guardian/domain";

import type { SqlDriver } from "../driver";
import { SAMPLE_COLUMNS, toSample } from "./sample-rows";

export class SqliteTelemetryRepository implements TelemetryRepository {
  constructor(private readonly driver: SqlDriver) {}

  async latestForNode(publicKey: string): Promise<TelemetrySample[]> {
    const rows = await this.driver.all<unknown>(
      `SELECT ${SAMPLE_COLUMNS} FROM telemetry_samples WHERE run_id = (
         SELECT r.id FROM diagnostic_runs r JOIN devices d ON d.id = r.device_id
         WHERE d.public_key = ? AND EXISTS (SELECT 1 FROM telemetry_samples s WHERE s.run_id = r.id)
         ORDER BY r.finished_at DESC, r.id DESC LIMIT 1)
       ORDER BY check_seq`,
      [publicKey],
    );
    return rows.map(toSample);
  }
}
