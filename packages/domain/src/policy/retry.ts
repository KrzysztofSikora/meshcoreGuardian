import type { ReasonCode } from "../diagnostics/reason-code";

export const ATTEMPTS_RANGE: readonly [number, number] = [1, 3];

export interface DiagnosticPolicy {
  attempts: number;
  overrideMs: number | null;
}

export const DEFAULT_DIAGNOSTIC_POLICY: DiagnosticPolicy = { attempts: 2, overrideMs: null };

export function assertAttempts(attempts: number): void {
  if (!Number.isInteger(attempts) || attempts < ATTEMPTS_RANGE[0] || attempts > ATTEMPTS_RANGE[1]) {
    throw new RangeError(
      `attempts ${attempts} is outside ${ATTEMPTS_RANGE[0]}-${ATTEMPTS_RANGE[1]}`,
    );
  }
}

/** Only an attempt that was acknowledged and then went unanswered is worth repeating (FR-10 AC4). */
export function shouldRetry(reason: ReasonCode, attemptsUsed: number, allowed: number): boolean {
  return reason === "NO_REPLY" && attemptsUsed < allowed;
}
