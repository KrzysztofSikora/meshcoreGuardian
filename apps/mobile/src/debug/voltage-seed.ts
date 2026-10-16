import type { CheckOutcome, DiagnosticRun, RunCompanion } from "@guardian/domain";

const HOUR_MS = 3_600_000;

/** Hours before `now` and the battery reading of each seeded run: 72 h, falling, uneven spacing. */
const POINTS: readonly { hoursAgo: number; milliVolts: number }[] = [
  { hoursAgo: 72, milliVolts: 4080 },
  { hoursAgo: 60, milliVolts: 4062 },
  { hoursAgo: 40, milliVolts: 4035 },
  { hoursAgo: 30, milliVolts: 4021 },
  { hoursAgo: 12, milliVolts: 3995 },
  { hoursAgo: 2, milliVolts: 3980 },
];

function statusCheck(startedAt: number, milliVolts: number): CheckOutcome {
  return {
    kind: "status",
    result: "RESPONDED",
    reason: "ALL_CHECKS_REPLIED",
    attempts: 1,
    timeoutMs: 8000,
    timeoutSource: "default",
    startedAt,
    durationMs: 1200,
    evidence: {
      kind: "status",
      battMilliVolts: milliVolts,
      currTxQueueLen: 0,
      noiseFloor: -110,
      lastRssi: -60,
      nPacketsRecv: 100,
      nPacketsSent: 50,
      totalAirTimeSecs: 30,
      totalUpTimeSecs: 86_400,
      nSentFlood: 0,
      nSentDirect: 0,
      nRecvFlood: 0,
      nRecvDirect: 0,
      errEvents: 0,
      lastSnrX4: 24,
      nDirectDups: 0,
      nFloodDups: 0,
    },
  };
}

/**
 * Six responded runs over 72 h with a falling battery voltage, for the `battery-history` e2e flow
 * and the fake build. Fixed offsets keep the trend (falling, about −0.10 V) stable.
 */
export function voltageSeedRuns(
  now: number,
  nodePublicKey: string,
  companion: RunCompanion,
): DiagnosticRun[] {
  return POINTS.map(({ hoursAgo, milliVolts }) => {
    const startedAt = now - hoursAgo * HOUR_MS - 2000;
    return {
      nodePublicKey,
      companion,
      startedAt,
      finishedAt: startedAt + 1500,
      durationMs: 1500,
      attemptsUsed: 1,
      attemptsPerCheck: 2,
      result: "RESPONDED",
      reason: "ALL_CHECKS_REPLIED",
      limitations: [],
      checks: [statusCheck(startedAt + 100, milliVolts)],
    };
  });
}
