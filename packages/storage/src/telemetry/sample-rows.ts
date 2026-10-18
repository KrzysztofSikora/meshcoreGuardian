import { z } from "zod";

import {
  SIGNAL_SCOPES,
  TELEMETRY_SOURCES,
  type Signal,
  type VoltageReading,
  type TelemetrySample,
} from "@guardian/domain";

import type { SqlDriver } from "../driver";

const scope = z.enum(SIGNAL_SCOPES);

const extraSchema = z.array(
  z.object({
    name: z.string(),
    value: z.number(),
    unit: z.string().nullable(),
    channel: z.number().nullable(),
  }),
);

const extraColumn = z.string().transform((text, ctx) => {
  try {
    return extraSchema.parse(JSON.parse(text));
  } catch {
    ctx.addIssue({ code: "custom", message: "invalid extra_json" });
    return z.NEVER;
  }
});

const sampleRowSchema = z.object({
  run_id: z.number().int(),
  check_seq: z.number().int(),
  source: z.enum(TELEMETRY_SOURCES),
  measured_at: z.number(),
  voltage_v: z.number().nullable(),
  uptime_s: z.number().nullable(),
  rssi_dbm: z.number().nullable(),
  rssi_scope: scope.nullable(),
  snr_db: z.number().nullable(),
  snr_scope: scope.nullable(),
  extra_json: extraColumn,
});

export const SAMPLE_COLUMNS = `run_id, check_seq, source, measured_at, voltage_v, uptime_s,
  rssi_dbm, rssi_scope, snr_db, snr_scope, extra_json`;

const readingRowSchema = z.object({
  run_id: z.number().int(),
  source: z.enum(TELEMETRY_SOURCES),
  measured_at: z.number(),
  voltage_v: z.number(),
});

const signal = (value: number | null, at: z.infer<typeof scope> | null): Signal | null =>
  value === null || at === null ? null : { value, scope: at };

/** Parses a stored row; a row that breaks the schema throws, like a bad stored run. */
export function toSample(raw: unknown): TelemetrySample {
  const row = sampleRowSchema.parse(raw);
  return {
    runId: row.run_id,
    checkSeq: row.check_seq,
    source: row.source,
    measuredAt: row.measured_at,
    voltageV: row.voltage_v,
    uptimeS: row.uptime_s,
    rssiDbm: signal(row.rssi_dbm, row.rssi_scope),
    snrDb: signal(row.snr_db, row.snr_scope),
    extra: row.extra_json,
  };
}

/** Parses a voltage reading row; a bad row throws. */
export function toVoltageReading(raw: unknown): VoltageReading {
  const row = readingRowSchema.parse(raw);
  return {
    runId: row.run_id,
    source: row.source,
    measuredAt: row.measured_at,
    voltageV: row.voltage_v,
  };
}

/** Inserts the samples of one run; call inside the run's transaction. */
export async function insertSamples(
  tx: SqlDriver,
  deviceId: number,
  runId: number,
  samples: readonly TelemetrySample[],
): Promise<void> {
  for (const s of samples) {
    await tx.run(
      `INSERT INTO telemetry_samples (device_id, ${SAMPLE_COLUMNS})
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        deviceId,
        runId,
        s.checkSeq,
        s.source,
        s.measuredAt,
        s.voltageV,
        s.uptimeS,
        s.rssiDbm?.value ?? null,
        s.rssiDbm?.scope ?? null,
        s.snrDb?.value ?? null,
        s.snrDb?.scope ?? null,
        JSON.stringify(s.extra),
      ],
    );
  }
}
