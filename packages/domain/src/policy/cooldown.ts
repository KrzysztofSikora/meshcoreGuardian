export const COOLDOWN_MS = 60_000;

/** Milliseconds until a node may be tested again, from the time of its last request. */
export function cooldownRemainingAt(lastRequestAt: number | null, now: number): number {
  if (lastRequestAt === null) return 0;
  return Math.min(COOLDOWN_MS, Math.max(0, lastRequestAt + COOLDOWN_MS - now));
}

/** Only a run that wrote at least one request used airtime, so only it starts a cooldown (D-7). */
export function cooldownRemaining(
  lastRun: { attemptsUsed: number; finishedAt: number } | null,
  now: number,
): number {
  if (lastRun === null || lastRun.attemptsUsed <= 0) return 0;
  return cooldownRemainingAt(lastRun.finishedAt, now);
}
