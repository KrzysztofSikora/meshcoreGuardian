import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import type { CheckOutcome, DiagnosticRun } from "@guardian/domain";

import { SqliteDiagnosticRunRepository } from "../src/diagnostics/run-repository";
import { SqliteTelemetryRepository } from "../src/telemetry/telemetry-repository";
import { NodeSqlDriver } from "./helpers/node-sql-driver";
import { openTestDb, type TestDb } from "./helpers/open-test-db";

const NODE = "ab".repeat(32);
const OTHER = "cd".repeat(32);

const statusEvidence = {
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
} as const;

const statusCheck = (at: number): CheckOutcome => ({
  kind: "status",
  result: "RESPONDED",
  reason: "ALL_CHECKS_REPLIED",
  attempts: 1,
  timeoutMs: 15_000,
  timeoutSource: "default",
  startedAt: at,
  durationMs: 700,
  evidence: statusEvidence,
});

const telemetryCheck = (at: number): CheckOutcome => ({
  kind: "telemetry",
  result: "RESPONDED",
  reason: "ALL_CHECKS_REPLIED",
  attempts: 1,
  timeoutMs: 20_000,
  timeoutSource: "default",
  startedAt: at,
  durationMs: 300,
  evidence: {
    kind: "telemetry",
    values: [
      { channel: 1, type: 116, value: 3.35 },
      { channel: 1, type: 103, value: 30 },
    ],
    lppHex: "0174",
  },
});

const noReply = (kind: "status" | "telemetry"): CheckOutcome => ({
  kind,
  result: "NO_RESPONSE",
  reason: "NO_REPLY",
  attempts: 2,
  timeoutMs: 15_000,
  timeoutSource: "default",
  startedAt: 1,
  durationMs: 15_000,
  evidence: null,
});

function makeRun(finishedAt: number, runChecks: CheckOutcome[], node = NODE): DiagnosticRun {
  return {
    nodePublicKey: node,
    companion: { publicKey: "ef".repeat(32), name: "Companion", firmwareVersion: "v1.17.1" },
    startedAt: finishedAt - 1_000,
    finishedAt,
    durationMs: 1_000,
    attemptsUsed: runChecks.length,
    attemptsPerCheck: 2,
    result: "RESPONDED",
    reason: "ALL_CHECKS_REPLIED",
    limitations: [],
    checks: runChecks,
  };
}

async function addNode(db: TestDb, key: string) {
  await db.driver.run(
    `INSERT INTO devices (public_key, reported_name, reported_role, reported_type, in_contacts, created_at, synced_at)
     VALUES (?, 'n', 'repeater', 2, 1, 1, 1)`,
    [key],
  );
}

describe("SqliteTelemetryRepository", () => {
  let testDb: TestDb | undefined;
  afterEach(() => {
    testDb?.close();
    testDb = undefined;
  });

  async function setup() {
    testDb = await openTestDb();
    await testDb.driver.exec("PRAGMA foreign_keys = ON");
    await addNode(testDb, NODE);
    await addNode(testDb, OTHER);
    return {
      runs: new SqliteDiagnosticRunRepository(testDb.driver),
      samples: new SqliteTelemetryRepository(testDb.driver),
    };
  }

  it("round-trips units, scopes, source, run id and measured time", async () => {
    const { runs, samples } = await setup();
    const id = await runs.save(makeRun(10_000, [statusCheck(2_000), telemetryCheck(3_000)]));

    const stored = await samples.latestForNode(NODE);

    expect(stored).toEqual([
      {
        runId: id,
        checkSeq: 0,
        source: "status",
        measuredAt: 2_700,
        voltageV: 3.353,
        uptimeS: 2837,
        rssiDbm: { value: -34, scope: "last_hop" },
        snrDb: { value: 13.25, scope: "last_hop" },
        extra: [{ name: "noise_floor", value: -110, unit: "dBm", channel: null }],
      },
      {
        runId: id,
        checkSeq: 1,
        source: "telemetry",
        measuredAt: 3_300,
        voltageV: 3.35,
        uptimeS: null,
        rssiDbm: null,
        snrDb: null,
        extra: [{ name: "temperature", value: 30, unit: "°C", channel: 1 }],
      },
    ]);
  });

  it("returns [] for a node without samples", async () => {
    const { runs, samples } = await setup();
    await runs.save(makeRun(10_000, [noReply("status")]));
    expect(await samples.latestForNode(NODE)).toEqual([]);
    expect(await samples.latestForNode("ee".repeat(32))).toEqual([]);
  });

  it("picks the newest run that has samples; a later run without samples does not hide it", async () => {
    const { runs, samples } = await setup();
    await runs.save(makeRun(1_000, [statusCheck(100)]));
    const newest = await runs.save(makeRun(5_000, [statusCheck(4_000), telemetryCheck(4_800)]));
    await runs.save(makeRun(9_000, [noReply("status"), noReply("telemetry")]));
    await runs.save(makeRun(99_000, [statusCheck(1)], OTHER));

    const stored = await samples.latestForNode(NODE);

    expect(stored.map((s) => s.runId)).toEqual([newest, newest]);
    expect(stored.map((s) => s.source)).toEqual(["status", "telemetry"]);
  });

  it("keeps the status sample of the newest run when its telemetry got no reply", async () => {
    const { runs, samples } = await setup();
    await runs.save(makeRun(1_000, [statusCheck(100), telemetryCheck(200)]));
    const newest = await runs.save(makeRun(5_000, [statusCheck(4_000), noReply("telemetry")]));

    const stored = await samples.latestForNode(NODE);

    expect(stored.map((s) => [s.runId, s.source])).toEqual([[newest, "status"]]);
  });

  it("breaks a finished_at tie by the higher run id", async () => {
    const { runs, samples } = await setup();
    await runs.save(makeRun(5_000, [statusCheck(100)]));
    const later = await runs.save(makeRun(5_000, [statusCheck(200)]));

    expect((await samples.latestForNode(NODE)).map((s) => s.runId)).toEqual([later]);
  });

  it("returns the same samples after reopening the file", async () => {
    const { runs, samples } = await setup();
    await runs.save(makeRun(10_000, [statusCheck(2_000), telemetryCheck(3_000)]));
    const before = await samples.latestForNode(NODE);

    const reopened = new DatabaseSync(testDb!.path);
    const again = new SqliteTelemetryRepository(new NodeSqlDriver(reopened));
    expect(await again.latestForNode(NODE)).toEqual(before);
    reopened.close();
  });

  it("deletes samples with their device and with their check", async () => {
    const { runs } = await setup();
    await runs.save(makeRun(10_000, [statusCheck(2_000)]));
    await runs.save(makeRun(10_000, [statusCheck(2_000)], OTHER));

    await testDb!.driver.run("DELETE FROM devices WHERE public_key = ?", [NODE]);

    expect(await testDb!.driver.all("SELECT id FROM telemetry_samples")).toHaveLength(1);
    await testDb!.driver.run("DELETE FROM diagnostic_checks");
    expect(await testDb!.driver.all("SELECT id FROM telemetry_samples")).toHaveLength(0);
  });

  it("enforces the CHECK constraints", async () => {
    const { runs } = await setup();
    const id = await runs.save(makeRun(10_000, [statusCheck(2_000), telemetryCheck(3_000)]));
    const update = (set: string) =>
      testDb!.driver.run(`UPDATE telemetry_samples SET ${set} WHERE run_id = ? AND check_seq = 1`, [
        id,
      ]);

    await expect(update("rssi_dbm = -50")).rejects.toThrow();
    await expect(update("snr_scope = 'last_hop'")).rejects.toThrow();
    await expect(update("source = 'bogus'")).rejects.toThrow();
    await expect(update("uptime_s = -1")).rejects.toThrow();
    await expect(update("rssi_dbm = -50, rssi_scope = 'end_to_end'")).rejects.toThrow();
    await expect(update("rssi_dbm = -50, rssi_scope = 'unknown'")).resolves.toEqual({ changes: 1 });
    await expect(
      testDb!.driver.run(
        `INSERT INTO telemetry_samples (device_id, run_id, check_seq, source, measured_at)
         VALUES (1, ?, 1, 'telemetry', 1)`,
        [id],
      ),
    ).rejects.toThrow();
    await expect(
      testDb!.driver.run(
        `INSERT INTO telemetry_samples (device_id, run_id, check_seq, source, measured_at)
         VALUES (1, ?, 7, 'telemetry', 1)`,
        [id],
      ),
    ).rejects.toThrow();
  });

  it("fails to read a row with a broken extra_json", async () => {
    const { runs, samples } = await setup();
    await runs.save(makeRun(10_000, [statusCheck(2_000)]));
    await testDb!.driver.run("UPDATE telemetry_samples SET extra_json = '{oops'");

    await expect(samples.latestForNode(NODE)).rejects.toThrow();
  });

  describe("forRuns", () => {
    it("returns the samples of exactly the given runs by run id then check order", async () => {
      const { runs, samples } = await setup();
      const a = await runs.save(makeRun(10_000, [statusCheck(2_000), telemetryCheck(3_000)]));
      const b = await runs.save(makeRun(20_000, [statusCheck(12_000)]));
      await runs.save(makeRun(30_000, [statusCheck(22_000)]));
      await runs.save(makeRun(15_000, [statusCheck(5_000)], OTHER));

      const stored = await samples.forRuns([b, a]);

      expect(stored.map((s) => [s.runId, s.checkSeq, s.source])).toEqual([
        [a, 0, "status"],
        [a, 1, "telemetry"],
        [b, 0, "status"],
      ]);
      expect(stored[0]?.rssiDbm).toEqual({ value: -34, scope: "last_hop" });
    });

    it("returns [] for no ids, unknown ids and runs without samples", async () => {
      const { runs, samples } = await setup();
      const bare = await runs.save(makeRun(10_000, [noReply("status")]));
      expect(await samples.forRuns([])).toEqual([]);
      expect(await samples.forRuns([bare, 9_999])).toEqual([]);
    });

    it("reads more runs than one query batch holds", async () => {
      const { runs, samples } = await setup();
      const ids: number[] = [];
      for (let i = 0; i < 1_200; i += 1) {
        ids.push(await runs.save(makeRun(10_000 + i, [statusCheck(i)])));
      }
      const stored = await samples.forRuns(ids);
      expect(stored).toHaveLength(1_200);
      expect(stored.map((s) => s.runId)).toEqual(ids);
    });

    it("fails to read a row with a broken extra_json", async () => {
      const { runs, samples } = await setup();
      const id = await runs.save(makeRun(10_000, [statusCheck(2_000)]));
      await testDb!.driver.run("UPDATE telemetry_samples SET extra_json = '{'");
      await expect(samples.forRuns([id])).rejects.toThrow();
    });
  });

  describe("voltageForNode", () => {
    const withVoltage = (mv: number): CheckOutcome => ({
      ...statusCheck(1),
      evidence: { ...statusEvidence, battMilliVolts: mv },
    });

    it("returns both voltage readings of one run with their time and source", async () => {
      const { runs, samples } = await setup();
      const id = await runs.save(makeRun(10_000, [statusCheck(2_000), telemetryCheck(3_000)]));

      expect(await samples.voltageForNode(NODE, 50)).toEqual([
        { runId: id, source: "status", measuredAt: 2_700, voltageV: 3.353 },
        { runId: id, source: "telemetry", measuredAt: 3_300, voltageV: 3.35 },
      ]);
    });

    it("excludes null voltage and does not count such a run towards the limit", async () => {
      const { runs, samples } = await setup();
      const a = await runs.save(makeRun(1_000, [statusCheck(100)]));
      await runs.save(makeRun(5_000, [withVoltage(0)]));
      await runs.save(makeRun(9_000, [noReply("status")]));

      expect((await samples.voltageForNode(NODE, 1)).map((r) => r.runId)).toEqual([a]);
    });

    it("keeps the newest runs, ordered ascending", async () => {
      const { runs, samples } = await setup();
      await runs.save(makeRun(1_000, [statusCheck(100)]));
      const mid = await runs.save(makeRun(5_000, [statusCheck(4_000), telemetryCheck(4_500)]));
      const last = await runs.save(makeRun(9_000, [statusCheck(8_000)]));

      const stored = await samples.voltageForNode(NODE, 2);

      expect(stored.map((r) => [r.runId, r.source])).toEqual([
        [mid, "status"],
        [mid, "telemetry"],
        [last, "status"],
      ]);
    });

    it("breaks a time tie between runs by the higher run id", async () => {
      const { runs, samples } = await setup();
      await runs.save(makeRun(5_000, [statusCheck(100)]));
      const later = await runs.save(makeRun(5_000, [statusCheck(100)]));

      expect((await samples.voltageForNode(NODE, 1)).map((r) => r.runId)).toEqual([later]);
    });

    it("excludes another node's readings and returns [] for an unknown key", async () => {
      const { runs, samples } = await setup();
      const mine = await runs.save(makeRun(1_000, [statusCheck(100)]));
      await runs.save(makeRun(9_000, [statusCheck(100)], OTHER));

      expect((await samples.voltageForNode(NODE, 50)).map((r) => r.runId)).toEqual([mine]);
      expect(await samples.voltageForNode("ee".repeat(32), 50)).toEqual([]);
    });

    it("returns the same readings after reopening the file", async () => {
      const { runs, samples } = await setup();
      await runs.save(makeRun(10_000, [statusCheck(2_000), telemetryCheck(3_000)]));
      const before = await samples.voltageForNode(NODE, 50);

      const reopened = new DatabaseSync(testDb!.path);
      const again = new SqliteTelemetryRepository(new NodeSqlDriver(reopened));
      expect(await again.voltageForNode(NODE, 50)).toEqual(before);
      reopened.close();
    });

    it("fails to read a row with a corrupt source", async () => {
      const { runs, samples } = await setup();
      await runs.save(makeRun(10_000, [statusCheck(2_000)]));
      await testDb!.driver.exec("PRAGMA ignore_check_constraints = ON");
      await testDb!.driver.run("UPDATE telemetry_samples SET source = 'bogus'");

      await expect(samples.voltageForNode(NODE, 50)).rejects.toThrow();
    });
  });
});
