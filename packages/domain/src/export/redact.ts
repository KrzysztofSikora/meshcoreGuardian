import { keyPrefix } from "../nodes/node";
import { CSV_COLUMNS } from "./serialize";

export const EXPORT_FORMATS = ["json", "csv"] as const;

export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/** A public key as it goes into the file: the 4-byte hex prefix when redacting, else unchanged. */
export function exportKey(publicKey: string, redactKeys: boolean): string {
  return redactKeys ? keyPrefix(publicKey) : publicKey;
}

/** The keys of each JSON group, in file order. A test ties these to a built report. */
export const JSON_FIELDS = [
  {
    group: "report",
    keys: ["schema_version", "generated_at", "generated_by", "range", "redaction", "node", "runs"],
  },
  {
    group: "node",
    keys: ["public_key", "reported_name", "label", "role", "reported_role", "last_heard_at"],
  },
  {
    group: "runs",
    keys: [
      "id",
      "started_at",
      "finished_at",
      "duration_ms",
      "result",
      "reason",
      "attempts_used",
      "attempts_per_check",
      "companion",
      "limitations",
      "checks",
      "telemetry",
    ],
  },
  { group: "runs[].companion", keys: ["public_key", "name", "firmware_version"] },
  {
    group: "runs[].checks",
    keys: [
      "kind",
      "result",
      "reason",
      "attempts",
      "timeout_ms",
      "timeout_source",
      "started_at",
      "duration_ms",
    ],
  },
  {
    group: "runs[].telemetry",
    keys: [
      "check_seq",
      "source",
      "measured_at",
      "voltage_v",
      "uptime_s",
      "rssi_dbm",
      "snr_db",
      "extra",
    ],
  },
] as const;

export type Redaction = "PUBLIC_KEYS_PREFIX" | "PUBLIC_KEYS_FULL";
export type NeverIncluded = "CREDENTIALS" | "RAW_FRAMES";

export type ExportManifest = {
  redactions: Redaction[];
  neverIncluded: NeverIncluded[];
} & (
  | { format: "csv"; fields: string[] }
  | { format: "json"; fields: { group: string; keys: string[] }[] }
);

/** What the preview shows before sharing (FR-13 AC2): the fields of the file and its redactions. */
export function exportManifest(format: ExportFormat, redactKeys: boolean): ExportManifest {
  const common = {
    redactions: [redactKeys ? "PUBLIC_KEYS_PREFIX" : "PUBLIC_KEYS_FULL"] as Redaction[],
    neverIncluded: ["CREDENTIALS", "RAW_FRAMES"] as NeverIncluded[],
  };
  if (format === "csv") return { ...common, format, fields: [...CSV_COLUMNS] };
  return {
    ...common,
    format,
    fields: JSON_FIELDS.map((g) => ({ group: g.group, keys: [...g.keys] })),
  };
}
