import type {
  DiagnosticRun,
  RunStatus,
  Signal,
  TelemetrySample,
  TelemetryValue,
} from "@guardian/domain";
import { lastRunStatus } from "@guardian/domain";

import type { Text } from "./presenter";

export interface TelemetryRow {
  label: Text;
  value: Text;
}

export interface TelemetryGroup {
  title: Text;
  measured: Text | null;
  rows: TelemetryRow[];
}

export type TelemetryCardModel =
  { empty: Text } | { heading: Text; fromRun: Text; groups: TelemetryGroup[]; note: Text | null };

export interface RecentRunRow {
  time: Text;
  status: RunStatus;
  duration: Text;
}

const NA: Text = { key: "telemetry.na" };

/** Two decimals at most, no trailing zeros: 3.35, 30, 12.5 (D-14). */
function plain(value: number): string {
  return String(Number(value.toFixed(2)));
}

function withUnit(value: string, unit: string | null): Text {
  return unit === null
    ? { key: "telemetry.valueUnitUnknown", params: { value } }
    : { key: "telemetry.value", params: { value, unit } };
}

export function lastResponseText(at: number | null, formatTime: (ms: number) => string): Text {
  return at === null
    ? { key: "node.lastResponseNone" }
    : { key: "node.lastResponse", params: { time: formatTime(at) } };
}

export function uptimeText(seconds: number): Text {
  const total = Math.max(0, Math.trunc(seconds));
  return {
    key: "telemetry.uptime",
    params: {
      days: Math.floor(total / 86_400),
      hours: Math.floor((total % 86_400) / 3600),
      minutes: Math.floor((total % 3600) / 60),
    },
  };
}

function signalRow(
  field: "rssi" | "snr",
  signal: Signal | null,
  unit: string,
  format: (n: number) => string,
): TelemetryRow {
  return signal === null
    ? { label: { key: `telemetry.field.${field}.none` }, value: NA }
    : {
        label: { key: `telemetry.field.${field}.${signal.scope}` },
        value: withUnit(format(signal.value), unit),
      };
}

function extraRow(extra: TelemetryValue): TelemetryRow {
  const unknown = /^lpp_(\d+)$/.exec(extra.name);
  const params: Record<string, string | number> = {
    name: unknown === null ? extra.name : "unknown",
  };
  if (unknown !== null) params.type = Number(unknown[1]);
  if (extra.channel !== null) params.channel = extra.channel;
  return {
    label: { key: extra.channel === null ? "telemetry.extra" : "telemetry.extraChannel", params },
    value: withUnit(plain(extra.value), extra.unit),
  };
}

function voltageRow(voltageV: number | null): TelemetryRow {
  return {
    label: { key: "telemetry.field.voltage" },
    value: voltageV === null ? NA : withUnit(voltageV.toFixed(2), "V"),
  };
}

function statusGroup(sample: TelemetrySample, formatTime: (ms: number) => string): TelemetryGroup {
  return {
    title: { key: "telemetry.source.status" },
    measured: { key: "telemetry.measured", params: { time: formatTime(sample.measuredAt) } },
    rows: [
      voltageRow(sample.voltageV),
      {
        label: { key: "telemetry.field.uptime" },
        value: sample.uptimeS === null ? NA : uptimeText(sample.uptimeS),
      },
      signalRow("rssi", sample.rssiDbm, "dBm", plain),
      signalRow("snr", sample.snrDb, "dB", (n) => n.toFixed(2)),
      ...sample.extra.map(extraRow),
    ],
  };
}

function telemetryGroup(
  sample: TelemetrySample,
  formatTime: (ms: number) => string,
): TelemetryGroup {
  const rows = [
    ...(sample.voltageV === null ? [] : [voltageRow(sample.voltageV)]),
    ...sample.extra.map(extraRow),
  ];
  return {
    title: { key: "telemetry.source.telemetry" },
    measured: { key: "telemetry.measured", params: { time: formatTime(sample.measuredAt) } },
    rows:
      rows.length > 0
        ? rows
        : [{ label: { key: "telemetry.field.values" }, value: { key: "telemetry.noValues" } }],
  };
}

/** The run holds no sample for this source (no reply, skipped or cancelled): say so rather than drop the group. */
function missingGroup(source: "status" | "telemetry"): TelemetryGroup {
  return {
    title: { key: `telemetry.source.${source}` },
    measured: null,
    rows: [{ label: { key: "telemetry.field.reply" }, value: { key: "telemetry.notInRun" } }],
  };
}

/**
 * The "latest telemetry" card (D-7): the samples of one run, one group per source. A value the
 * response lacked is "N/A", never 0 (FR-07 AC2). `runAt` is the run's finish time when known.
 */
export function telemetryCard(
  samples: readonly TelemetrySample[],
  formatTime: (ms: number) => string,
  runAt: number | null = null,
): TelemetryCardModel {
  const status = samples.find((s) => s.source === "status");
  const telemetry = samples.find((s) => s.source === "telemetry");
  if (status === undefined && telemetry === undefined) return { empty: { key: "telemetry.empty" } };
  const at = runAt ?? Math.min(...samples.map((s) => s.measuredAt));
  const groups = [
    status === undefined ? missingGroup("status") : statusGroup(status, formatTime),
    telemetry === undefined ? missingGroup("telemetry") : telemetryGroup(telemetry, formatTime),
  ];
  const showsSignal = status !== undefined && (status.rssiDbm !== null || status.snrDb !== null);
  return {
    heading: { key: "telemetry.heading" },
    fromRun: { key: "telemetry.fromRun", params: { time: formatTime(at) } },
    groups,
    note: showsSignal ? { key: "telemetry.lastHopNote" } : null,
  };
}

function durationText(ms: number): Text {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return seconds < 60
    ? { key: "history.durationSeconds", params: { seconds } }
    : {
        key: "history.durationMinutes",
        params: { minutes: Math.floor(seconds / 60), seconds: seconds % 60 },
      };
}

export function recentRunRow(
  run: Pick<DiagnosticRun, "result" | "reason" | "finishedAt" | "durationMs">,
  formatTime: (ms: number) => string,
  now: number,
): RecentRunRow {
  return {
    time: { key: "history.time", params: { time: formatTime(run.finishedAt) } },
    status: lastRunStatus(run, now),
    duration: durationText(run.durationMs),
  };
}
