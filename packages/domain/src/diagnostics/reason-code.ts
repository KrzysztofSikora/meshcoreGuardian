import type { ResultCode } from "./result-code";

/**
 * Why a run or a check ended with its result. Stored values; the database constrains `result`
 * only, so adding a reason here is additive. Every result × reason pair needs a rule (rules.ts).
 */
export const REASONS_BY_RESULT = {
  RESPONDED: ["ALL_CHECKS_REPLIED", "PARTIAL_REPLY", "LOGIN_REJECTED"],
  NO_RESPONSE: ["NO_REPLY"],
  TRANSPORT_UNAVAILABLE: ["NOT_CONNECTED", "LINK_LOST", "COMPANION_NO_ACK"],
  UNSUPPORTED: ["CAPABILITY_MISSING", "COMMAND_REJECTED", "MALFORMED_RESPONSE"],
  NOT_TESTED: ["CANCELLED", "UNEXPECTED_ERROR"],
} as const satisfies Record<ResultCode, readonly string[]>;

export type ReasonsOf<R extends ResultCode> = (typeof REASONS_BY_RESULT)[R][number];

export type ReasonCode = ReasonsOf<ResultCode>;

export function isReasonFor(result: ResultCode, reason: unknown): reason is ReasonsOf<ResultCode> {
  return (
    typeof reason === "string" && (REASONS_BY_RESULT[result] as readonly string[]).includes(reason)
  );
}
