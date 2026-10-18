import type { ExportReport, ExportRun } from "./report";

export const CSV_COLUMNS = [
  "schema_version",
  "node_public_key",
  "node_name",
  "node_label",
  "run_id",
  "started_at",
  "finished_at",
  "duration_ms",
  "result",
  "reason",
  "attempts_used",
  "attempts_per_check",
  "companion_public_key",
  "companion_name",
  "companion_firmware",
  "voltage_v",
  "uptime_s",
  "rssi_dbm",
  "rssi_scope",
  "snr_db",
  "snr_scope",
  "noise_floor_dbm",
  "checks",
  "limitations",
] as const;

export function toJson(report: ExportReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

type Cell = string | number | null;

/** A spreadsheet runs a text cell that starts with one of these as a formula (plan D-7). */
const FORMULA_START = /^[=+\-@\t\r]/;

function csvCell(cell: Cell): string {
  if (cell === null) return "";
  if (typeof cell === "number") return String(cell);
  const text = FORMULA_START.test(cell) ? `'${cell}` : cell;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function firstNonNull<T>(run: ExportRun, pick: (t: ExportRun["telemetry"][number]) => T | null) {
  for (const sample of run.telemetry) {
    const value = pick(sample);
    if (value !== null) return value;
  }
  return null;
}

const outcomes = (items: { check: string; result: string; reason: string }[]): string =>
  items.map((i) => `${i.check}=${i.result}/${i.reason}`).join(";");

function csvRow(report: ExportReport, run: ExportRun): Cell[] {
  const rssi = firstNonNull(run, (t) => t.rssi_dbm);
  const snr = firstNonNull(run, (t) => t.snr_db);
  const noise = firstNonNull(run, (t) => t.extra.find((e) => e.name === "noise_floor") ?? null);
  const { node } = report;
  return [
    report.schema_version,
    node.public_key,
    node.reported_name,
    node.label,
    run.id,
    run.started_at,
    run.finished_at,
    run.duration_ms,
    run.result,
    run.reason,
    run.attempts_used,
    run.attempts_per_check,
    run.companion.public_key,
    run.companion.name,
    run.companion.firmware_version,
    firstNonNull(run, (t) => t.voltage_v),
    firstNonNull(run, (t) => t.uptime_s),
    rssi?.value ?? null,
    rssi?.scope ?? null,
    snr?.value ?? null,
    snr?.scope ?? null,
    noise?.value ?? null,
    outcomes(run.checks.map((c) => ({ check: c.kind, result: c.result, reason: c.reason }))),
    outcomes(run.limitations),
  ];
}

/** One row per run (plan D-2): RFC 4180, CRLF line ends, a header row. */
export function toCsv(report: ExportReport): string {
  const lines = [
    [...CSV_COLUMNS].map(csvCell).join(","),
    ...report.runs.map((run) => csvRow(report, run).map(csvCell).join(",")),
  ];
  return `${lines.join("\r\n")}\r\n`;
}
