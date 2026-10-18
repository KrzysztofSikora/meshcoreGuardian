import type { ContactReport, DiagnosticRun, RunCompanion } from "@guardian/domain";

import { statusCheck } from "./voltage-seed";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export const LARGE_SEED_NODES = 200;
export const LARGE_SEED_RUNS = 1000;
/** Runs stored on the target node; one run on each of the others. */
export const LARGE_SEED_TARGET_RUNS = LARGE_SEED_RUNS - (LARGE_SEED_NODES - 1);
const SPAN_DAYS = 30;

const hex = (n: number) => n.toString(16).padStart(4, "0");

/** The node the perf flow opens: the first contact, a repeater with the 801-run history. */
export const LARGE_SEED_TARGET = `${hex(1)}`.repeat(16);

/** 200 contacts, repeaters and room servers alternating, keys unique and fixed. */
export function largeSeedContacts(now: number): ContactReport[] {
  return Array.from({ length: LARGE_SEED_NODES }, (_, i) => ({
    publicKey: `${hex(i + 1)}`.repeat(16),
    name: `Seed node ${i + 1}`,
    type: i % 2 === 0 ? 2 : 3,
    lastHeardAt: now - (i + 1) * 60_000,
    pathHops: i % 5,
    position: null,
  }));
}

/**
 * 1,000 responded runs: 801 on the target over 30 days (each with a battery reading) and one on
 * each other node. Deterministic for a given `now`.
 */
export function largeSeedRuns(now: number, companion: RunCompanion): DiagnosticRun[] {
  const run = (nodePublicKey: string, startedAt: number, milliVolts: number): DiagnosticRun => ({
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
  });
  const runs: DiagnosticRun[] = [];
  const spacing = (SPAN_DAYS * DAY_MS - HOUR_MS) / LARGE_SEED_TARGET_RUNS;
  for (let i = 0; i < LARGE_SEED_TARGET_RUNS; i++) {
    const startedAt = Math.round(now - HOUR_MS - (LARGE_SEED_TARGET_RUNS - 1 - i) * spacing);
    // Slow fall with a wobble, 4.10 V to about 3.95 V.
    const milliVolts = Math.round(4100 - (150 * i) / LARGE_SEED_TARGET_RUNS + 10 * Math.sin(i / 7));
    runs.push(run(LARGE_SEED_TARGET, startedAt, milliVolts));
  }
  for (const contact of largeSeedContacts(now).slice(1)) {
    runs.push(run(contact.publicKey, now - HOUR_MS * 2, 4000));
  }
  return runs;
}
