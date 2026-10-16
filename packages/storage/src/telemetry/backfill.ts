import {
  samplesFromChecks,
  type CheckOutcome,
  type ResultCode,
} from "@guardian/domain";

import type { SqlDriver } from "../driver";
import { evidenceSchema } from "../diagnostics/evidence";
import { insertSamples } from "./sample-rows";

interface PendingRun {
  id: number;
  device_id: number;
  finished_at: number;
}

interface CheckRow {
  run_id: number;
  seq: number;
  kind: CheckOutcome["kind"];
  result: ResultCode;
  started_at: number | null;
  duration_ms: number | null;
  evidence_json: string | null;
}

function parseEvidence(text: string | null): CheckOutcome["evidence"] {
  if (text === null) return null;
  try {
    const parsed = evidenceSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Stores the samples of runs saved before schema v4 (D-3). Idempotent: only responded status or
 * telemetry checks without a sample are added, so a crash half way is repaired at the next start.
 * A check whose stored evidence does not parse is skipped, never fatal. Returns the rows added.
 */
export async function backfillTelemetrySamples(driver: SqlDriver): Promise<number> {
  const pending = await driver.all<PendingRun>(
    `SELECT DISTINCT r.id, r.device_id, r.finished_at FROM diagnostic_runs r
     JOIN diagnostic_checks c ON c.run_id = r.id
     WHERE c.result = 'RESPONDED' AND c.kind IN ('status', 'telemetry')
       AND NOT EXISTS (SELECT 1 FROM telemetry_samples s WHERE s.run_id = c.run_id AND s.check_seq = c.seq)
     ORDER BY r.id`,
  );
  if (pending.length === 0) return 0;
  return driver.transaction(async (tx) => {
    let added = 0;
    for (const run of pending) {
      // Every check in stored order: `checkSeq` is the index (plan-review finding 2).
      const rows = await tx.all<CheckRow>(
        `SELECT run_id, seq, kind, result, started_at, duration_ms, evidence_json
         FROM diagnostic_checks WHERE run_id = ? ORDER BY seq`,
        [run.id],
      );
      const checks: CheckOutcome[] = rows.map((row) => ({
        kind: row.kind,
        result: row.result,
        // The mapping reads neither reason nor timeouts; they are not needed here.
        reason: "ALL_CHECKS_REPLIED",
        attempts: 0,
        timeoutMs: null,
        timeoutSource: null,
        startedAt: row.started_at,
        durationMs: row.duration_ms,
        evidence: parseEvidence(row.evidence_json),
      }));
      const existing = await tx.all<{ check_seq: number }>(
        "SELECT check_seq FROM telemetry_samples WHERE run_id = ?",
        [run.id],
      );
      const have = new Set(existing.map((e) => e.check_seq));
      const missing = samplesFromChecks(checks, run.finished_at).filter(
        (s) => !have.has(s.checkSeq),
      );
      await insertSamples(tx, run.device_id, run.id, missing);
      added += missing.length;
    }
    return added;
  });
}
