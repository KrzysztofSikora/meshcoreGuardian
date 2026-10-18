import { z } from "zod";

import {
  CHECK_KINDS,
  samplesFromChecks,
  RESULT_CODES,
  isReasonFor,
  type CheckOutcome,
  type DiagnosticRun,
  type DiagnosticRunRepository,
  type ReasonCode,
  type ResultCode,
} from "@guardian/domain";

import type { SqlDriver } from "../driver";
import { NodeNotFoundError } from "../nodes/node-repository";
import { insertSamples } from "../telemetry/sample-rows";
import { evidenceSchema } from "./evidence";

const result = z.enum(RESULT_CODES);
const kind = z.enum(CHECK_KINDS);

const limitationsSchema = z.array(z.object({ check: kind, result, reason: z.string() }));

class StoredRunError extends Error {
  constructor(message: string) {
    super(`Invalid stored diagnostic: ${message}`);
    this.name = "StoredRunError";
  }
}

function reasonOf(resultCode: ResultCode, reason: string): ReasonCode {
  if (!isReasonFor(resultCode, reason)) {
    throw new StoredRunError(`reason ${reason} does not belong to ${resultCode}`);
  }
  return reason;
}

const jsonColumn = <T extends z.ZodType>(schema: T) =>
  z.string().transform((text, ctx) => {
    try {
      return schema.parse(JSON.parse(text)) as z.output<T>;
    } catch {
      ctx.addIssue({ code: "custom", message: "invalid JSON column" });
      return z.NEVER;
    }
  });

const runRowSchema = z.object({
  id: z.number().int(),
  node_public_key: z.string(),
  companion_public_key: z.string(),
  companion_name: z.string(),
  companion_firmware: z.string(),
  started_at: z.number(),
  finished_at: z.number(),
  duration_ms: z.number(),
  attempts_used: z.number().int(),
  attempts_per_check: z.number().int(),
  result,
  reason: z.string(),
  limitations_json: jsonColumn(limitationsSchema),
});

const checkRowSchema = z.object({
  kind,
  result,
  reason: z.string(),
  attempts: z.number().int(),
  timeout_ms: z.number().nullable(),
  timeout_source: z.enum(["estimate", "default", "override"]).nullable(),
  started_at: z.number().nullable(),
  duration_ms: z.number().nullable(),
  evidence_json: jsonColumn(evidenceSchema).nullable(),
});

function toCheck(raw: unknown): CheckOutcome {
  const row = checkRowSchema.parse(raw);
  return {
    kind: row.kind,
    result: row.result,
    reason: reasonOf(row.result, row.reason),
    attempts: row.attempts,
    timeoutMs: row.timeout_ms,
    timeoutSource: row.timeout_source,
    startedAt: row.started_at,
    durationMs: row.duration_ms,
    evidence: row.evidence_json,
  };
}

function toRun(raw: unknown, checks: CheckOutcome[]): DiagnosticRun {
  const row = runRowSchema.parse(raw);
  return {
    id: row.id,
    nodePublicKey: row.node_public_key,
    companion: {
      publicKey: row.companion_public_key,
      name: row.companion_name,
      firmwareVersion: row.companion_firmware,
    },
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    durationMs: row.duration_ms,
    attemptsUsed: row.attempts_used,
    attemptsPerCheck: row.attempts_per_check,
    result: row.result,
    reason: reasonOf(row.result, row.reason),
    limitations: row.limitations_json.map((l) => ({
      check: l.check,
      result: l.result,
      reason: reasonOf(l.result, l.reason),
    })),
    checks,
  };
}

/** Ids per `IN (...)` query, well under SQLite's bound-variable limit. */
const ID_BATCH = 500;

const RUN_SELECT = `SELECT r.id, d.public_key AS node_public_key, r.companion_public_key,
  r.companion_name, r.companion_firmware, r.started_at, r.finished_at, r.duration_ms,
  r.attempts_used, r.attempts_per_check, r.result, r.reason, r.limitations_json
  FROM diagnostic_runs r JOIN devices d ON d.id = r.device_id`;

export class SqliteDiagnosticRunRepository implements DiagnosticRunRepository {
  constructor(private readonly driver: SqlDriver) {}

  async save(run: DiagnosticRun): Promise<number> {
    return this.driver.transaction(async (tx) => {
      const device = await tx.all<{ id: number }>("SELECT id FROM devices WHERE public_key = ?", [
        run.nodePublicKey,
      ]);
      if (device[0] === undefined) throw new NodeNotFoundError(run.nodePublicKey);
      await tx.run(
        `INSERT INTO diagnostic_runs (device_id, companion_public_key, companion_name,
           companion_firmware, started_at, finished_at, duration_ms, attempts_used,
           attempts_per_check, result, reason, limitations_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          device[0].id,
          run.companion.publicKey,
          run.companion.name,
          run.companion.firmwareVersion,
          run.startedAt,
          run.finishedAt,
          run.durationMs,
          run.attemptsUsed,
          run.attemptsPerCheck,
          run.result,
          run.reason,
          JSON.stringify(run.limitations),
        ],
      );
      const ids = await tx.all<{ id: number }>("SELECT last_insert_rowid() AS id");
      const runId = ids[0]!.id;
      for (const [seq, check] of run.checks.entries()) {
        await tx.run(
          `INSERT INTO diagnostic_checks (run_id, seq, kind, result, reason, attempts, timeout_ms,
             timeout_source, started_at, duration_ms, evidence_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            runId,
            seq,
            check.kind,
            check.result,
            check.reason,
            check.attempts,
            check.timeoutMs,
            check.timeoutSource,
            check.startedAt,
            check.durationMs,
            check.evidence === null ? null : JSON.stringify(check.evidence),
          ],
        );
      }
      await insertSamples(tx, device[0].id, runId, samplesFromChecks(run.checks, run.finishedAt));
      return runId;
    });
  }

  async get(id: number): Promise<DiagnosticRun | null> {
    const rows = await this.driver.all<unknown>(`${RUN_SELECT} WHERE r.id = ?`, [id]);
    if (rows[0] === undefined) return null;
    const checks = await this.driver.all<unknown>(
      `SELECT kind, result, reason, attempts, timeout_ms, timeout_source, started_at, duration_ms,
         evidence_json FROM diagnostic_checks WHERE run_id = ? ORDER BY seq`,
      [id],
    );
    return toRun(rows[0], checks.map(toCheck));
  }

  async latestPerNode(): Promise<Map<string, DiagnosticRun>> {
    const rows = await this.driver.all<unknown>(
      `${RUN_SELECT} WHERE NOT EXISTS (
         SELECT 1 FROM diagnostic_runs n WHERE n.device_id = r.device_id
           AND (n.finished_at > r.finished_at OR (n.finished_at = r.finished_at AND n.id > r.id)))`,
    );
    const latest = new Map<string, DiagnosticRun>();
    for (const row of rows) {
      const run = toRun(row, []);
      latest.set(run.nodePublicKey, run);
    }
    return latest;
  }

  async recentForNode(publicKey: string, limit: number): Promise<DiagnosticRun[]> {
    const rows = await this.driver.all<unknown>(
      `${RUN_SELECT} WHERE d.public_key = ? ORDER BY r.finished_at DESC, r.id DESC LIMIT ?`,
      [publicKey, limit],
    );
    return rows.map((row) => toRun(row, []));
  }

  async forNodeBetween(publicKey: string, from: number, to: number): Promise<DiagnosticRun[]> {
    const rows = await this.driver.all<unknown>(
      `${RUN_SELECT} WHERE d.public_key = ? AND r.finished_at >= ? AND r.finished_at <= ?
       ORDER BY r.finished_at, r.id`,
      [publicKey, from, to],
    );
    const runs = rows.map((row) => runRowSchema.parse(row));
    const checksByRun = new Map<number, CheckOutcome[]>();
    for (let i = 0; i < runs.length; i += ID_BATCH) {
      const ids = runs.slice(i, i + ID_BATCH).map((run) => run.id);
      const checkRows = await this.driver.all<{ run_id: number }>(
        `SELECT run_id, kind, result, reason, attempts, timeout_ms, timeout_source, started_at,
           duration_ms, evidence_json FROM diagnostic_checks
         WHERE run_id IN (${ids.map(() => "?").join(",")}) ORDER BY run_id, seq`,
        ids,
      );
      for (const row of checkRows) {
        const list = checksByRun.get(row.run_id) ?? [];
        list.push(toCheck(row));
        checksByRun.set(row.run_id, list);
      }
    }
    return rows.map((row, index) => toRun(row, checksByRun.get(runs[index]!.id) ?? []));
  }

  async lastRespondedAt(publicKey: string): Promise<number | null> {
    const rows = await this.driver.all<{ at: number | null }>(
      `SELECT MAX(r.finished_at) AS at FROM diagnostic_runs r JOIN devices d ON d.id = r.device_id
       WHERE d.public_key = ? AND r.result = 'RESPONDED'`,
      [publicKey],
    );
    return rows[0]?.at ?? null;
  }
}
