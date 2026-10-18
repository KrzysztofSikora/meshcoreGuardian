import type { CheckKind, CheckOutcome } from "../diagnostics/check";
import type { ReasonCode } from "../diagnostics/reason-code";
import type { ResultCode } from "../diagnostics/result-code";
import type { DiagnosticRun } from "../diagnostics/run";
import { effectiveRole, type Node, type NodeRole } from "../nodes/node";
import type { TimeoutSource } from "../policy/timeout";
import type { SignalScope, TelemetrySample, TelemetrySource } from "../telemetry/samples";
import { exportKey } from "./redact";

export const EXPORT_SCHEMA_VERSION = 1;

export interface ExportInput {
  node: Node;
  /** Runs with their checks. */
  runs: DiagnosticRun[];
  samples: TelemetrySample[];
  /** Epoch ms, inclusive. */
  range: { from: number; to: number };
  generatedAt: number;
  generatedBy: string;
}

export interface ExportSignal {
  value: number;
  scope: SignalScope;
}

export interface ExportRun {
  id: number | null;
  started_at: string;
  finished_at: string;
  duration_ms: number;
  result: ResultCode;
  reason: ReasonCode;
  attempts_used: number;
  attempts_per_check: number;
  companion: {
    /** `null` when the run stored no companion identity. */
    public_key: string | null;
    name: string;
    firmware_version: string;
  };
  limitations: { check: CheckKind; result: ResultCode; reason: ReasonCode }[];
  checks: {
    kind: CheckKind;
    result: ResultCode;
    reason: ReasonCode;
    attempts: number;
    timeout_ms: number | null;
    timeout_source: TimeoutSource | null;
    started_at: string | null;
    duration_ms: number | null;
  }[];
  telemetry: {
    check_seq: number;
    source: TelemetrySource;
    measured_at: string;
    voltage_v: number | null;
    uptime_s: number | null;
    rssi_dbm: ExportSignal | null;
    snr_db: ExportSignal | null;
    extra: { name: string; value: number; unit: string | null; channel: number | null }[];
  }[];
}

/** The JSON export (plan D-1): snake_case keys, ISO 8601 UTC times, durations in ms. */
export interface ExportReport {
  schema_version: typeof EXPORT_SCHEMA_VERSION;
  generated_at: string;
  generated_by: string;
  range: { from: string; to: string };
  redaction: { public_keys: "prefix" | "full" };
  node: {
    public_key: string;
    reported_name: string;
    label: string | null;
    role: NodeRole;
    reported_role: NodeRole;
    last_heard_at: string | null;
  };
  runs: ExportRun[];
}

const iso = (ms: number): string => new Date(ms).toISOString();
const isoOrNull = (ms: number | null): string | null => (ms === null ? null : iso(ms));

function exportCheck(check: CheckOutcome): ExportRun["checks"][number] {
  // Evidence is never exported (plan D-5): raw payload bytes are not ours to share.
  return {
    kind: check.kind,
    result: check.result,
    reason: check.reason,
    attempts: check.attempts,
    timeout_ms: check.timeoutMs,
    timeout_source: check.timeoutSource,
    started_at: isoOrNull(check.startedAt),
    duration_ms: check.durationMs,
  };
}

function exportSample(sample: TelemetrySample): ExportRun["telemetry"][number] {
  return {
    check_seq: sample.checkSeq,
    source: sample.source,
    measured_at: iso(sample.measuredAt),
    voltage_v: sample.voltageV,
    uptime_s: sample.uptimeS,
    rssi_dbm: sample.rssiDbm === null ? null : { ...sample.rssiDbm },
    snr_db: sample.snrDb === null ? null : { ...sample.snrDb },
    extra: sample.extra.map((e) => ({
      name: e.name,
      value: e.value,
      unit: e.unit,
      channel: e.channel,
    })),
  };
}

function exportRun(run: DiagnosticRun, samples: TelemetrySample[], redactKeys: boolean): ExportRun {
  const companionKey = run.companion.publicKey;
  return {
    id: run.id ?? null,
    started_at: iso(run.startedAt),
    finished_at: iso(run.finishedAt),
    duration_ms: run.durationMs,
    result: run.result,
    reason: run.reason,
    attempts_used: run.attemptsUsed,
    attempts_per_check: run.attemptsPerCheck,
    companion: {
      public_key: companionKey === "" ? null : exportKey(companionKey, redactKeys),
      name: run.companion.name,
      firmware_version: run.companion.firmwareVersion,
    },
    limitations: run.limitations.map((l) => ({
      check: l.check,
      result: l.result,
      reason: l.reason,
    })),
    checks: run.checks.map(exportCheck),
    telemetry: [...samples].sort((a, b) => a.checkSeq - b.checkSeq).map(exportSample),
  };
}

/**
 * Builds the report. Runs go oldest first (ties by id); a sample joins the run its `runId` names
 * and is dropped when that run is not in the input.
 */
export function buildReport(input: ExportInput, options: { redactKeys: boolean }): ExportReport {
  const { node } = input;
  const runs = [...input.runs].sort(
    (a, b) => a.finishedAt - b.finishedAt || (a.id ?? 0) - (b.id ?? 0),
  );
  const byRun = new Map<number, TelemetrySample[]>();
  for (const sample of input.samples) {
    if (sample.runId === null) continue;
    const list = byRun.get(sample.runId) ?? [];
    list.push(sample);
    byRun.set(sample.runId, list);
  }
  return {
    schema_version: EXPORT_SCHEMA_VERSION,
    generated_at: iso(input.generatedAt),
    generated_by: input.generatedBy,
    range: { from: iso(input.range.from), to: iso(input.range.to) },
    redaction: { public_keys: options.redactKeys ? "prefix" : "full" },
    node: {
      public_key: exportKey(node.publicKey, options.redactKeys),
      reported_name: node.reportedName,
      label: node.userLabel,
      role: effectiveRole(node),
      reported_role: node.reportedRole,
      last_heard_at: isoOrNull(node.lastHeardAt),
    },
    runs: runs.map((run) =>
      exportRun(run, run.id === undefined ? [] : (byRun.get(run.id) ?? []), options.redactKeys),
    ),
  };
}
