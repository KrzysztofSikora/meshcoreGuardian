import type { DiagnosticRun } from "./run";

export type StatusKind =
  | "not_tested"
  | "responded"
  | "no_reply"
  | "transport_error"
  | "unsupported"
  | "cancelled"
  | "incomplete";

export interface RunStatus {
  kind: StatusKind;
  /** `null` when the node was never tested. */
  ageMs: number | null;
}

/** The FR-11 status of a node from its latest run. A node without a run is "not tested". */
export function lastRunStatus(
  run: Pick<DiagnosticRun, "result" | "reason" | "finishedAt"> | null,
  now: number,
): RunStatus {
  if (!run) return { kind: "not_tested", ageMs: null };
  const ageMs = Math.max(0, now - run.finishedAt);
  switch (run.result) {
    case "RESPONDED":
      return { kind: "responded", ageMs };
    case "NO_RESPONSE":
      return { kind: "no_reply", ageMs };
    case "TRANSPORT_UNAVAILABLE":
      return { kind: "transport_error", ageMs };
    case "UNSUPPORTED":
      return { kind: "unsupported", ageMs };
    case "NOT_TESTED":
      return { kind: run.reason === "CANCELLED" ? "cancelled" : "incomplete", ageMs };
  }
}

export interface AgeBucket {
  unit: "now" | "minute" | "hour" | "day";
  count: number;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Coarse relative age for display: just now, then whole minutes, hours and days. */
export function ageBucket(ms: number): AgeBucket {
  if (ms < MINUTE) return { unit: "now", count: 0 };
  if (ms < HOUR) return { unit: "minute", count: Math.floor(ms / MINUTE) };
  if (ms < DAY) return { unit: "hour", count: Math.floor(ms / HOUR) };
  return { unit: "day", count: Math.floor(ms / DAY) };
}
