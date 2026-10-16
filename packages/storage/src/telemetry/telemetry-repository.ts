import type { TelemetryRepository, TelemetrySample, VoltageReading } from "@guardian/domain";

import type { SqlDriver } from "../driver";
import { SAMPLE_COLUMNS, toSample, toVoltageReading } from "./sample-rows";

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

  async voltageForNode(publicKey: string, runs: number): Promise<VoltageReading[]> {
    const rows = await this.driver.all<unknown>(
      `SELECT s.run_id, s.source, s.measured_at, s.voltage_v
       FROM telemetry_samples s JOIN devices d ON d.id = s.device_id
       WHERE d.public_key = ? AND s.voltage_v IS NOT NULL AND s.run_id IN (
         SELECT run_id FROM telemetry_samples
         WHERE device_id = d.id AND voltage_v IS NOT NULL
         GROUP BY run_id ORDER BY MAX(measured_at) DESC, run_id DESC LIMIT ?)
       ORDER BY s.measured_at, s.run_id, s.check_seq`,
      [publicKey, runs],
    );
    return rows.map(toVoltageReading);
  }
}
