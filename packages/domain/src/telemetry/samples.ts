import type { CheckEvidence, CheckOutcome } from "../diagnostics/check";
import { lppMeaning } from "./lpp";

export const TELEMETRY_SOURCES = ["status", "telemetry"] as const;
export const SIGNAL_SCOPES = ["last_hop", "unknown"] as const;

export type TelemetrySource = (typeof TELEMETRY_SOURCES)[number];
export type SignalScope = (typeof SIGNAL_SCOPES)[number];

export interface TelemetryValue {
  name: string;
  value: number;
  unit: string | null;
  channel: number | null;
}

export interface Signal {
  value: number;
  scope: SignalScope;
}

/** One responded status or telemetry check (D-1). `null` means the response did not contain it. */
export interface TelemetrySample {
  /** Null until the repository stores the run. */
  runId: number | null;
  /** Index of the check in the run (its stored `seq`). */
  checkSeq: number;
  source: TelemetrySource;
  /** When the reply reached the app (D-4), epoch ms. */
  measuredAt: number;
  voltageV: number | null;
  uptimeS: number | null;
  rssiDbm: Signal | null;
  snrDb: Signal | null;
  extra: TelemetryValue[];
}

const finite = (n: number): boolean => Number.isFinite(n);

function statusSample(
  evidence: Extract<CheckEvidence, { kind: "status" }>,
): Pick<TelemetrySample, "voltageV" | "uptimeS" | "rssiDbm" | "snrDb" | "extra"> {
  // 0 mV means "not measured" (D-5, UNVERIFIED): a node that answers is not at 0 V.
  const voltageV =
    finite(evidence.battMilliVolts) && evidence.battMilliVolts > 0
      ? evidence.battMilliVolts / 1000
      : null;
  const uptimeS =
    finite(evidence.totalUpTimeSecs) && evidence.totalUpTimeSecs >= 0
      ? Math.trunc(evidence.totalUpTimeSecs)
      : null;
  const rssiDbm: Signal | null = finite(evidence.lastRssi)
    ? { value: evidence.lastRssi, scope: "last_hop" }
    : null;
  const snrDb: Signal | null = finite(evidence.lastSnrX4)
    ? { value: evidence.lastSnrX4 / 4, scope: "last_hop" }
    : null;
  const extra: TelemetryValue[] = finite(evidence.noiseFloor)
    ? [{ name: "noise_floor", value: evidence.noiseFloor, unit: "dBm", channel: null }]
    : [];
  return { voltageV, uptimeS, rssiDbm, snrDb, extra };
}

function telemetrySample(
  evidence: Extract<CheckEvidence, { kind: "telemetry" }>,
): Pick<TelemetrySample, "voltageV" | "uptimeS" | "rssiDbm" | "snrDb" | "extra"> {
  let voltageV: number | null = null;
  const extra: TelemetryValue[] = [];
  for (const { channel, type, value } of evidence.values) {
    if (typeof value === "object") {
      const { latitude, longitude, altitude } = value;
      const parts: [string, number, string][] = [
        ["latitude", latitude, "°"],
        ["longitude", longitude, "°"],
        ["altitude", altitude, "m"],
      ];
      for (const [name, part, unit] of parts) {
        if (finite(part)) extra.push({ name, value: part, unit, channel });
      }
      continue;
    }
    if (!finite(value)) continue;
    if (channel === 1 && type === 116 && voltageV === null) {
      voltageV = value;
      continue;
    }
    const { name, unit } = lppMeaning(type);
    extra.push({ name, value, unit, channel });
  }
  return { voltageV, uptimeS: null, rssiDbm: null, snrDb: null, extra };
}

/**
 * One sample per responded status or telemetry check (D-1). `checkSeq` is the index in `checks`,
 * so callers must pass every check of the run in stored order. Total: a value that is not a
 * usable number becomes null instead of failing the run's save.
 */
export function samplesFromChecks(
  checks: readonly CheckOutcome[],
  fallbackAt: number,
): TelemetrySample[] {
  const samples: TelemetrySample[] = [];
  checks.forEach((check, checkSeq) => {
    if (check.result !== "RESPONDED" || check.evidence === null) return;
    const measuredAt =
      check.startedAt !== null && check.durationMs !== null
        ? check.startedAt + check.durationMs
        : fallbackAt;
    const { evidence } = check;
    if (check.kind === "status" && evidence.kind === "status") {
      samples.push({
        runId: null,
        checkSeq,
        source: "status",
        measuredAt,
        ...statusSample(evidence),
      });
    } else if (check.kind === "telemetry" && evidence.kind === "telemetry") {
      samples.push({
        runId: null,
        checkSeq,
        source: "telemetry",
        measuredAt,
        ...telemetrySample(evidence),
      });
    }
  });
  return samples;
}
