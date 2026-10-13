import type { Capabilities } from "../companion/capabilities";
import type { TimeoutSource } from "../policy/timeout";
import type { ReasonCode } from "./reason-code";
import type { ResultCode } from "./result-code";

export const CHECK_KINDS = ["login", "status", "telemetry"] as const;

export type CheckKind = (typeof CHECK_KINDS)[number];

/** Decoded evidence of one check. The adapter's decoded frames satisfy these shapes structurally. */
export type CheckEvidence =
  | {
      kind: "login";
      permissions: number;
      aclPermissions: number | null;
      firmwareLevel: number | null;
      /** Whether a non-empty password was sent with the login; absent in runs stored before S-05. */
      passwordSent?: boolean | undefined;
    }
  | {
      kind: "status";
      battMilliVolts: number;
      currTxQueueLen: number;
      noiseFloor: number;
      lastRssi: number;
      nPacketsRecv: number;
      nPacketsSent: number;
      totalAirTimeSecs: number;
      totalUpTimeSecs: number;
      nSentFlood: number;
      nSentDirect: number;
      nRecvFlood: number;
      nRecvDirect: number;
      errEvents: number;
      lastSnrX4: number;
      nDirectDups: number;
      nFloodDups: number;
    }
  | {
      kind: "telemetry";
      values: {
        channel: number;
        type: number;
        value: number | { latitude: number; longitude: number; altitude: number };
      }[];
      lppHex: string;
    }
  | { kind: "malformed"; code: number; length: number; hex: string }
  | { kind: "rejected"; code: number | null };

export interface CheckOutcome {
  kind: CheckKind;
  result: ResultCode;
  reason: ReasonCode;
  attempts: number;
  timeoutMs: number | null;
  timeoutSource: TimeoutSource | null;
  startedAt: number | null;
  durationMs: number | null;
  evidence: CheckEvidence | null;
}

export type CheckPlan =
  { run: CheckKind[]; skipped: CheckOutcome[] } | { unsupported: CheckOutcome };

function unsupportedCheck(kind: CheckKind): CheckOutcome {
  return {
    kind,
    result: "UNSUPPORTED",
    reason: "CAPABILITY_MISSING",
    attempts: 0,
    timeoutMs: null,
    timeoutSource: null,
    startedAt: null,
    durationMs: null,
    evidence: null,
  };
}

/**
 * The checks a run sends, in order (D-2): login, status, telemetry. A missing login capability
 * drops the login; a missing telemetry capability is stored as a skipped check; without status
 * there is nothing to test.
 */
export function planChecks(capabilities: Capabilities): CheckPlan {
  if (!capabilities.status.supported) return { unsupported: unsupportedCheck("status") };
  const run: CheckKind[] = [];
  const skipped: CheckOutcome[] = [];
  if (capabilities.login.supported) run.push("login");
  run.push("status");
  if (capabilities.telemetry.supported) run.push("telemetry");
  else skipped.push(unsupportedCheck("telemetry"));
  return { run, skipped };
}

/** A run goes on only while the node keeps answering and has not rejected the login (D-2). */
export function continuesAfter(outcome: Pick<CheckOutcome, "result" | "reason">): boolean {
  return outcome.result === "RESPONDED" && outcome.reason !== "LOGIN_REJECTED";
}
