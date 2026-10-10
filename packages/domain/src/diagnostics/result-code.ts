/** Outcome of one diagnostic check (PRD FR-06). A timeout is NO_RESPONSE, never "offline". */
export const RESULT_CODES = [
  "RESPONDED",
  "NO_RESPONSE",
  "TRANSPORT_UNAVAILABLE",
  "UNSUPPORTED",
  "NOT_TESTED",
] as const;

export type ResultCode = (typeof RESULT_CODES)[number];

export function isResultCode(value: unknown): value is ResultCode {
  return typeof value === "string" && (RESULT_CODES as readonly string[]).includes(value);
}
