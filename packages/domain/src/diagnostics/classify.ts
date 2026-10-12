import type { CheckKind, CheckOutcome } from "./check";
import type { ReasonCode } from "./reason-code";
import type { ResultCode } from "./result-code";

export interface Limitation {
  check: CheckKind;
  result: ResultCode;
  reason: ReasonCode;
}

export type Preflight = "NOT_CONNECTED" | "CAPABILITY_MISSING" | "UNEXPECTED_ERROR";

export interface RunClassification {
  result: ResultCode;
  reason: ReasonCode;
  limitations: Limitation[];
}

export interface ClassifyContext {
  cancelled: boolean;
  /** The run could not start; no check was sent. */
  preflight?: Preflight;
}

const PREFLIGHT_RESULT = {
  NOT_CONNECTED: "TRANSPORT_UNAVAILABLE",
  CAPABILITY_MISSING: "UNSUPPORTED",
  UNEXPECTED_ERROR: "NOT_TESTED",
} as const satisfies Record<Preflight, ResultCode>;

function limitationsOf(outcomes: readonly CheckOutcome[]): Limitation[] {
  return outcomes
    .filter((o) => o.result !== "RESPONDED")
    .map((o) => ({ check: o.kind, result: o.result, reason: o.reason }));
}

/**
 * Best evidence wins (FR-06): one reply from the node is a response whatever else failed, and
 * every check that did not reply stays visible as a limitation. A timeout is never more than
 * `NO_RESPONSE`/`NO_REPLY`. Cancel always wins over the rest (D-3); unknown shapes are neutral (D-11).
 */
export function classifyRun(
  outcomes: readonly CheckOutcome[],
  context: ClassifyContext,
): RunClassification {
  const limitations = limitationsOf(outcomes);
  const done = (result: ResultCode, reason: ReasonCode): RunClassification => ({
    result,
    reason,
    limitations,
  });

  if (context.preflight) {
    return {
      result: PREFLIGHT_RESULT[context.preflight],
      reason: context.preflight,
      limitations: [],
    };
  }
  if (context.cancelled) return done("NOT_TESTED", "CANCELLED");

  // Skipped checks (0 attempts, capability missing) are limitations, not evidence of a failure.
  const executed = outcomes.filter((o) => o.reason !== "CAPABILITY_MISSING");
  if (executed.length === 0) {
    return outcomes.length > 0
      ? done("UNSUPPORTED", "CAPABILITY_MISSING")
      : done("NOT_TESTED", "UNEXPECTED_ERROR");
  }

  if (executed.some((o) => o.reason === "LOGIN_REJECTED")) {
    return done("RESPONDED", "LOGIN_REJECTED");
  }
  if (executed.some((o) => o.result === "RESPONDED")) {
    return executed.every((o) => o.result === "RESPONDED")
      ? done("RESPONDED", "ALL_CHECKS_REPLIED")
      : done("RESPONDED", "PARTIAL_REPLY");
  }
  for (const result of ["TRANSPORT_UNAVAILABLE", "UNSUPPORTED"] as const) {
    const found = executed.find((o) => o.result === result);
    if (found) return done(result, found.reason);
  }
  if (executed.some((o) => o.result === "NO_RESPONSE")) return done("NO_RESPONSE", "NO_REPLY");
  return done("NOT_TESTED", "UNEXPECTED_ERROR");
}
