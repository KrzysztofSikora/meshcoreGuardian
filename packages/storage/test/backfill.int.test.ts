import { afterEach, describe, expect, it } from "vitest";

import type { CheckOutcome, DiagnosticRun } from "@guardian/domain";

import { SqliteDiagnosticRunRepository } from "../src/diagnostics/run-repository";
import { migrateToLatest } from "../src/migrate";
import { backfillTelemetrySamples } from "../src/telemetry/backfill";
import { SqliteTelemetryRepository } from "../src/telemetry/telemetry-repository";
import { openTestDb, type TestDb } from "./helpers/open-test-db";

const NODE = "ab".repeat(32);

const statusJson = JSON.stringify({
  kind: "status",
  battMilliVolts: 3353,
  currTxQueueLen: 0,
  noiseFloor: -110,
  lastRssi: -34,
  nPacketsRecv: 1,
  nPacketsSent: 1,
  totalAirTimeSecs: 1,
  totalUpTimeSecs: 2837,
  nSentFlood: 0,
  nSentDirect: 0,
  nRecvFlood: 0,
  nRecvDirect: 0,
  errEvents: 0,
  lastSnrX4: 53,
  nDirectDups: 0,
  nFloodDups: 0,
});
const telemetryJson = JSON.stringify({
  kind: "telemetry",
  values: [{ channel: 1, type: 103, value: 30 }],
  lppHex: "01",
});
const loginJson = JSON.stringify({
  kind: "login",
  permissions: 1,
  aclPermissions: 0,
  firmwareLevel: null,
});

describe("backfillTelemetrySamples", () => {
  let testDb: TestDb | undefined;
  afterEach(() => {
    testDb?.close();
    testDb = undefined;
  });

  async function addRun(id: number, finishedAt: number) {
    await testDb!.driver.run(
      `INSERT INTO diagnostic_runs (id, device_id, companion_public_key, companion_name, companion_firmware,
         started_at, finished_at, duration_ms, attempts_used, attempts_per_check, result, reason)
       VALUES (?, 1, 'k', 'c', 'v1', 1, ?, 1, 1, 2, 'RESPONDED', 'ALL_CHECKS_REPLIED')`,
      [id, finishedAt],
    );
  }
  async function addCheck(
    run: number,
    seq: number,
    kind: string,
    result: string,
    evidence: string | null,
    timing: [number, number] | null = [1_000, 500],
  ) {
    await testDb!.driver.run(
      `INSERT INTO diagnostic_checks (run_id, seq, kind, result, reason, attempts, started_at, duration_ms, evidence_json)
       VALUES (?, ?, ?, ?, 'ALL_CHECKS_REPLIED', 1, ?, ?, ?)`,
      [run, seq, kind, result, timing?.[0] ?? null, timing?.[1] ?? null, evidence],
    );
  }

  async function legacyDb() {
    testDb = await openTestDb({ migrate: 3 });
    await testDb.driver.run(
      `INSERT INTO devices (public_key, reported_name, reported_role, reported_type, in_contacts, created_at, synced_at)
       VALUES (?, 'n', 'repeater', 2, 1, 1, 1)`,
      [NODE],
    );
    await testDb.driver.exec("PRAGMA foreign_keys = ON");
  }

  const rows = () =>
    testDb!.driver.all<{ run_id: number; check_seq: number; source: string; measured_at: number }>(
      "SELECT run_id, check_seq, source, measured_at FROM telemetry_samples ORDER BY run_id, check_seq",
    );

  it("derives samples from responded status and telemetry checks of old runs, once", async () => {
    await legacyDb();
    await addRun(1, 9_000);
    await addCheck(1, 0, "login", "RESPONDED", loginJson);
    await addCheck(1, 1, "status", "RESPONDED", statusJson);
    await addCheck(1, 2, "telemetry", "RESPONDED", telemetryJson);
    await addRun(2, 20_000);
    await addCheck(2, 0, "status", "NO_RESPONSE", null);
    await addCheck(2, 1, "telemetry", "RESPONDED", statusJson.replace("status", "bogus"));
    await addRun(3, 30_000);
    await addCheck(3, 0, "status", "RESPONDED", statusJson, null);
    await migrateToLatest(testDb!.driver);

    const added = await backfillTelemetrySamples(testDb!.driver);

    expect(added).toBe(3);
    expect(await rows()).toEqual([
      { run_id: 1, check_seq: 1, source: "status", measured_at: 1_500 },
      { run_id: 1, check_seq: 2, source: "telemetry", measured_at: 1_500 },
      { run_id: 3, check_seq: 0, source: "status", measured_at: 30_000 },
    ]);
    expect(await backfillTelemetrySamples(testDb!.driver)).toBe(0);
    const latest = await new SqliteTelemetryRepository(testDb!.driver).latestForNode(NODE);
    expect(latest.map((s) => [s.runId, s.source])).toEqual([[3, "status"]]);
  });

  it("keeps the stored seq when the missing check follows a login and a sampled status", async () => {
    await legacyDb();
    await addRun(1, 9_000);
    await addCheck(1, 0, "login", "RESPONDED", loginJson);
    await addCheck(1, 1, "status", "RESPONDED", statusJson);
    await addCheck(1, 2, "telemetry", "RESPONDED", telemetryJson);
    await migrateToLatest(testDb!.driver);
    await testDb!.driver.run(
      `INSERT INTO telemetry_samples (device_id, run_id, check_seq, source, measured_at) VALUES (1, 1, 1, 'status', 1)`,
    );

    expect(await backfillTelemetrySamples(testDb!.driver)).toBe(1);

    expect((await rows()).map((r) => [r.check_seq, r.source])).toEqual([
      [1, "status"],
      [2, "telemetry"],
    ]);
  });

  it("does not duplicate the samples of a run saved after v4", async () => {
    testDb = await openTestDb();
    await testDb.driver.exec("PRAGMA foreign_keys = ON");
    await testDb.driver.run(
      `INSERT INTO devices (public_key, reported_name, reported_role, reported_type, in_contacts, created_at, synced_at)
       VALUES (?, 'n', 'repeater', 2, 1, 1, 1)`,
      [NODE],
    );
    const check: CheckOutcome = {
      kind: "status",
      result: "RESPONDED",
      reason: "ALL_CHECKS_REPLIED",
      attempts: 1,
      timeoutMs: 1,
      timeoutSource: "default",
      startedAt: 1,
      durationMs: 1,
      evidence: JSON.parse(statusJson),
    };
    const run: DiagnosticRun = {
      nodePublicKey: NODE,
      companion: { publicKey: "k", name: "c", firmwareVersion: "v" },
      startedAt: 1,
      finishedAt: 5,
      durationMs: 4,
      attemptsUsed: 1,
      attemptsPerCheck: 2,
      result: "RESPONDED",
      reason: "ALL_CHECKS_REPLIED",
      limitations: [],
      checks: [check],
    };
    await new SqliteDiagnosticRunRepository(testDb.driver).save(run);

    expect(await backfillTelemetrySamples(testDb.driver)).toBe(0);
    expect(await rows()).toHaveLength(1);
  });

  it("returns 0 on an empty database", async () => {
    testDb = await openTestDb();
    expect(await backfillTelemetrySamples(testDb.driver)).toBe(0);
  });
});
