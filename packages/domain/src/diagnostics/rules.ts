import type { ReasonsOf } from "./reason-code";
import type { ResultCode } from "./result-code";

/** An i18n catalog key; the text lives in the app catalog, never in the domain. */
export type Key = string;

export interface Rule {
  summary: Key;
  explanation: Key;
  /** Possible causes; none is confirmed. */
  causes: Key[];
  /** Shown above the causes when they are guesses (FR-09 AC3). */
  causesNote: Key | null;
  nextSteps: Key[];
  limitations: Key[];
}

interface Parts {
  causes?: readonly string[];
  note?: boolean;
  nextSteps: readonly string[];
  limitations?: readonly string[];
}

function rule(result: string, reason: string, parts: Parts): Rule {
  const base = `diagnostic.rule.${result}.${reason}`;
  const keys = (field: string, names: readonly string[] = []) =>
    names.map((name) => `${base}.${field}.${name}`);
  return {
    summary: `${base}.summary`,
    explanation: `${base}.explanation`,
    causes: keys("causes", parts.causes),
    causesNote: parts.note ? `${base}.causesNote` : null,
    nextSteps: keys("nextSteps", parts.nextSteps),
    limitations: keys("limitations", parts.limitations),
  };
}

/** One rule per result × reason. A missing pair is a type error. */
export const RULES: { [R in ResultCode]: { [K in ReasonsOf<R>]: Rule } } = {
  RESPONDED: {
    ALL_CHECKS_REPLIED: rule("RESPONDED", "ALL_CHECKS_REPLIED", { nextSteps: ["review"] }),
    PARTIAL_REPLY: rule("RESPONDED", "PARTIAL_REPLY", {
      causes: ["route", "congestion"],
      note: true,
      nextSteps: ["retry"],
      limitations: ["unanswered"],
    }),
    LOGIN_REJECTED: rule("RESPONDED", "LOGIN_REJECTED", {
      causes: ["password", "permissions"],
      nextSteps: ["credentials", "other"],
      limitations: ["noSession"],
    }),
  },
  NO_RESPONSE: {
    NO_REPLY: rule("NO_RESPONSE", "NO_REPLY", {
      causes: ["route", "congestion", "device"],
      note: true,
      nextSteps: ["wait", "closer"],
      limitations: ["unknownCause"],
    }),
  },
  TRANSPORT_UNAVAILABLE: {
    NOT_CONNECTED: rule("TRANSPORT_UNAVAILABLE", "NOT_CONNECTED", {
      nextSteps: ["connect"],
    }),
    LINK_LOST: rule("TRANSPORT_UNAVAILABLE", "LINK_LOST", {
      causes: ["range", "companion"],
      note: true,
      nextSteps: ["reconnect"],
      limitations: ["notSent"],
    }),
    COMPANION_NO_ACK: rule("TRANSPORT_UNAVAILABLE", "COMPANION_NO_ACK", {
      causes: ["companion"],
      note: true,
      nextSteps: ["reconnect"],
      limitations: ["notSent"],
    }),
  },
  UNSUPPORTED: {
    CAPABILITY_MISSING: rule("UNSUPPORTED", "CAPABILITY_MISSING", {
      nextSteps: ["update"],
      limitations: ["firmware"],
    }),
    COMMAND_REJECTED: rule("UNSUPPORTED", "COMMAND_REJECTED", {
      causes: ["firmware", "contact"],
      note: true,
      nextSteps: ["sync", "update"],
      limitations: ["rejected"],
    }),
    MALFORMED_RESPONSE: rule("UNSUPPORTED", "MALFORMED_RESPONSE", {
      causes: ["firmware", "corrupt"],
      note: true,
      nextSteps: ["retry", "report"],
      limitations: ["unreadable"],
    }),
  },
  NOT_TESTED: {
    CANCELLED: rule("NOT_TESTED", "CANCELLED", { nextSteps: ["again"] }),
    UNEXPECTED_ERROR: rule("NOT_TESTED", "UNEXPECTED_ERROR", {
      nextSteps: ["again"],
      limitations: ["unknown"],
    }),
  },
};

export function ruleFor(result: ResultCode, reason: string): Rule | null {
  const byReason = RULES[result] as Record<string, Rule>;
  return Object.hasOwn(byReason, reason) ? byReason[reason]! : null;
}
