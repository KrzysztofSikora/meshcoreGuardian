export const TIMEOUT_CAP_MS = 30_000;
export const TIMEOUT_FLOOR_MS = 5_000;
export const TIMEOUT_DEFAULT_MS = 15_000;
export const TIMEOUT_MARGIN = 2;
export const OVERRIDE_RANGE_MS: readonly [number, number] = [5_000, 60_000];

export type TimeoutSource = "estimate" | "default" | "override";

/**
 * How long to wait for one attempt (FR-10 AC3): a user override, else the companion's estimate
 * times a margin within [floor, cap], else a default. An out-of-range override is a programming
 * error; settings validate it first.
 */
export function attemptTimeout(input: {
  estimateMs?: number | null | undefined;
  overrideMs?: number | null | undefined;
}): { ms: number; source: TimeoutSource } {
  const { estimateMs, overrideMs } = input;
  if (overrideMs !== null && overrideMs !== undefined) {
    if (!(overrideMs >= OVERRIDE_RANGE_MS[0] && overrideMs <= OVERRIDE_RANGE_MS[1])) {
      throw new RangeError(
        `timeout override ${overrideMs} ms is outside ${OVERRIDE_RANGE_MS[0]}-${OVERRIDE_RANGE_MS[1]} ms`,
      );
    }
    return { ms: overrideMs, source: "override" };
  }
  if (estimateMs !== null && estimateMs !== undefined && estimateMs > 0) {
    const ms = Math.min(TIMEOUT_CAP_MS, Math.max(TIMEOUT_FLOOR_MS, estimateMs * TIMEOUT_MARGIN));
    return { ms, source: "estimate" };
  }
  return { ms: TIMEOUT_DEFAULT_MS, source: "default" };
}
