import {
  CHECK_KINDS,
  NODE_ROLES,
  RESULT_CODES,
  SIGNAL_SCOPES,
  TELEMETRY_SOURCES,
} from "@guardian/domain";
import { z } from "zod";

const iso = z.iso.datetime();
const isoOrNull = iso.nullable();
const resultCode = z.enum(RESULT_CODES);
const checkKind = z.enum(CHECK_KINDS);
const reason = z.string().min(1);
const nodeRole = z.enum(NODE_ROLES);
const signal = z.strictObject({ value: z.number(), scope: z.enum(SIGNAL_SCOPES) }).nullable();

const run = z.strictObject({
  id: z.number().int().nullable(),
  started_at: iso,
  finished_at: iso,
  duration_ms: z.number(),
  result: resultCode,
  reason,
  attempts_used: z.number().int(),
  attempts_per_check: z.number().int(),
  companion: z.strictObject({
    public_key: z.string().nullable(),
    name: z.string(),
    firmware_version: z.string(),
  }),
  limitations: z.array(z.strictObject({ check: checkKind, result: resultCode, reason })),
  checks: z.array(
    z.strictObject({
      kind: checkKind,
      result: resultCode,
      reason,
      attempts: z.number().int(),
      timeout_ms: z.number().nullable(),
      timeout_source: z.enum(["estimate", "default", "override"]).nullable(),
      started_at: isoOrNull,
      duration_ms: z.number().nullable(),
    }),
  ),
  telemetry: z.array(
    z.strictObject({
      check_seq: z.number().int(),
      source: z.enum(TELEMETRY_SOURCES),
      measured_at: iso,
      voltage_v: z.number().nullable(),
      uptime_s: z.number().nullable(),
      rssi_dbm: signal,
      snr_db: signal,
      extra: z.array(
        z.strictObject({
          name: z.string(),
          value: z.number(),
          unit: z.string().nullable(),
          channel: z.number().int().nullable(),
        }),
      ),
    }),
  ),
});

const PREFIX = /^[0-9a-f]{8}$/;
const FULL = /^[0-9a-f]{64}$/;

/**
 * The JSON export as it leaves the app (plan D-8). The key refinement ties the file to its own
 * `redaction` flag: a prefix file never holds a full key, a full file never holds a prefix.
 * A run stored without a companion identity exports `null`, which is not checked.
 */
export const exportReportSchema = z
  .strictObject({
    schema_version: z.literal(1),
    generated_at: iso,
    generated_by: z.string(),
    range: z.strictObject({ from: iso, to: iso }),
    redaction: z.strictObject({ public_keys: z.enum(["prefix", "full"]) }),
    node: z.strictObject({
      public_key: z.string(),
      reported_name: z.string(),
      label: z.string().nullable(),
      role: nodeRole,
      reported_role: nodeRole,
      last_heard_at: isoOrNull,
    }),
    runs: z.array(run),
  })
  .superRefine((report, ctx) => {
    const pattern = report.redaction.public_keys === "prefix" ? PREFIX : FULL;
    if (!pattern.test(report.node.public_key))
      ctx.addIssue({ code: "custom", path: ["node", "public_key"], message: "key form" });
    report.runs.forEach((r, i) => {
      const key = r.companion.public_key;
      if (key !== null && !pattern.test(key))
        ctx.addIssue({
          code: "custom",
          path: ["runs", i, "companion", "public_key"],
          message: "key form",
        });
    });
  });
