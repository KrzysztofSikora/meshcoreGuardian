import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import type { CheckOutcome, DiagnosticRun } from "@guardian/domain";

import { NodeNotFoundError } from "../src/nodes/node-repository";
import { SqliteDiagnosticRunRepository } from "../src/diagnostics/run-repository";
import { NodeSqlDriver } from "./helpers/node-sql-driver";
import { openTestDb, type TestDb } from "./helpers/open-test-db";

const NODE = "ab".repeat(32);
const OTHER = "cd".repeat(32);

const status = {
  kind: "status",
  battMilliVolts: 4012,
  currTxQueueLen: 1,
  noiseFloor: -110,
  lastRssi: -80,
  nPacketsRecv: 10,
  nPacketsSent: 9,
  totalAirTimeSecs: 3,
  totalUpTimeSecs: 400,
  nSentFlood: 1,
  nSentDirect: 2,
  nRecvFlood: 3,
  nRecvDirect: 4,
  errEvents: 0,
  lastSnrX4: 22,
  nDirectDups: 0,
  nFloodDups: 1,
} as const;

const checks: CheckOutcome[] = [
  {
    kind: "login",
    result: "RESPONDED",
    reason: "ALL_CHECKS_REPLIED",
    attempts: 1,
    timeoutMs: 5_388,
    timeoutSource: "estimate",
    startedAt: 1_000,
    durationMs: 1_100,
    evidence: { kind: "login", permissions: 1, aclPermissions: 0, firmwareLevel: null },
  },
  {
    kind: "status",
    result: "RESPONDED",
    reason: "ALL_CHECKS_REPLIED",
    attempts: 2,
    timeoutMs: 15_000,
    timeoutSource: "default",
    startedAt: 2_200,
    durationMs: 9_000,
    evidence: status,
  },
  {
    kind: "telemetry",
    result: "UNSUPPORTED",
    reason: "MALFORMED_RESPONSE",
    attempts: 1,
    timeoutMs: 20_000,
    timeoutSource: "override",
    startedAt: 12_000,
    durationMs: 500,
    evidence: { kind: "malformed", code: 139, length: 3, hex: "8b0000" },
  },
];

function makeRun(overrides: Partial<DiagnosticRun> = {}): DiagnosticRun {
  return {
    nodePublicKey: NODE,
    companion: { publicKey: "ef".repeat(32), name: "Companion", firmwareVersion: "v1.17.1" },
    startedAt: 1_000,
    finishedAt: 12_500,
    durationMs: 11_500,
    attemptsUsed: 4,
    attemptsPerCheck: 2,
    result: "RESPONDED",
    reason: "PARTIAL_REPLY",
    limitations: [{ check: "telemetry", result: "UNSUPPORTED", reason: "MALFORMED_RESPONSE" }],
    checks,
    ...overrides,
  };
}

async function addNode(db: TestDb, key: string) {
  await db.driver.run(
    `INSERT INTO devices (public_key, reported_name, reported_role, reported_type, in_contacts, created_at, synced_at)
     VALUES (?, 'n', 'repeater', 2, 1, 1, 1)`,
    [key],
  );
}

describe("SqliteDiagnosticRunRepository", () => {
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
    return new SqliteDiagnosticRunRepository(testDb.driver);
  }

  it("round-trips every field of a run and its checks across a restart", async () => {
    const repo = await setup();
    const run = makeRun();

    const id = await repo.save(run);

    const reopened = new DatabaseSync(testDb!.path);
    const again = new SqliteDiagnosticRunRepository(new NodeSqlDriver(reopened));
    expect(await again.get(id)).toEqual({ ...run, id });
    reopened.close();
  });

  it("stores a run without checks and null evidence", async () => {
    const repo = await setup();
    const run = makeRun({
      result: "NOT_TESTED",
      reason: "CANCELLED",
      attemptsUsed: 0,
      limitations: [],
      checks: [{ ...checks[0]!, evidence: null, timeoutMs: null, timeoutSource: null }],
    });

    const id = await repo.save(run);

    expect(await repo.get(id)).toEqual({ ...run, id });
    expect(await repo.get(id + 100)).toBeNull();
  });

  it("returns the newest run per node, with the higher id winning a tie", async () => {
    const repo = await setup();
    await repo.save(makeRun({ finishedAt: 100 }));
    const tieA = await repo.save(makeRun({ finishedAt: 500, reason: "ALL_CHECKS_REPLIED" }));
    const tieB = await repo.save(makeRun({ finishedAt: 500, reason: "LOGIN_REJECTED" }));
    const older = await repo.save(makeRun({ nodePublicKey: OTHER, finishedAt: 300 }));
    await repo.save(makeRun({ nodePublicKey: OTHER, finishedAt: 200 }));

    const latest = await repo.latestPerNode();

    expect([...latest.keys()].sort()).toEqual([NODE, OTHER].sort());
    expect(tieA).toBeLessThan(tieB);
    expect(latest.get(NODE)?.id).toBe(tieB);
    expect(latest.get(NODE)?.reason).toBe("LOGIN_REJECTED");
    expect(latest.get(OTHER)?.id).toBe(older);
    expect(latest.get(NODE)?.checks).toEqual([]);
  });

  it("returns an empty map when nothing was run", async () => {
    const repo = await setup();
    expect((await repo.latestPerNode()).size).toBe(0);
  });

  it("rejects an unknown node and stores nothing", async () => {
    const repo = await setup();

    await expect(repo.save(makeRun({ nodePublicKey: "ee".repeat(32) }))).rejects.toThrow(
      NodeNotFoundError,
    );
    const rows = await testDb!.driver.all("SELECT id FROM diagnostic_runs");
    expect(rows).toHaveLength(0);
  });

  it("rolls the run back when a check fails to insert", async () => {
    const repo = await setup();
    const bad = makeRun({ checks: [checks[0]!, { ...checks[0]!, kind: "bogus" as never }] });

    await expect(repo.save(bad)).rejects.toThrow();

    expect(await testDb!.driver.all("SELECT id FROM diagnostic_runs")).toHaveLength(0);
    expect(await testDb!.driver.all("SELECT run_id FROM diagnostic_checks")).toHaveLength(0);
  });

  it("fails to parse a stored reason that does not belong to its result", async () => {
    const repo = await setup();
    const id = await repo.save(makeRun());
    await testDb!.driver.run("UPDATE diagnostic_runs SET reason = 'NO_REPLY' WHERE id = ?", [id]);

    await expect(repo.get(id)).rejects.toThrow(/NO_REPLY/);
    await expect(repo.latestPerNode()).rejects.toThrow(/NO_REPLY/);
  });

  it("fails to parse a stored check reason and corrupt evidence", async () => {
    const repo = await setup();
    const id = await repo.save(makeRun());
    await testDb!.driver.run(
      "UPDATE diagnostic_checks SET reason = 'CANCELLED' WHERE run_id = ? AND seq = 0",
      [id],
    );
    await expect(repo.get(id)).rejects.toThrow(/CANCELLED/);

    await testDb!.driver.run("UPDATE diagnostic_checks SET reason = 'ALL_CHECKS_REPLIED' WHERE run_id = ? AND seq = 0", [id]);
    await testDb!.driver.run(
      "UPDATE diagnostic_checks SET evidence_json = '{not json' WHERE run_id = ? AND seq = 1",
      [id],
    );
    await expect(repo.get(id)).rejects.toThrow();
  });

  it("enforces result and kind CHECK constraints", async () => {
    const repo = await setup();
    await expect(repo.save(makeRun({ result: "OFFLINE" as never }))).rejects.toThrow();
  });

  it("deletes runs and checks with their device", async () => {
    const repo = await setup();
    await repo.save(makeRun());
    await repo.save(makeRun({ nodePublicKey: OTHER }));

    await testDb!.driver.run("DELETE FROM devices WHERE public_key = ?", [NODE]);

    expect(await testDb!.driver.all("SELECT id FROM diagnostic_runs")).toHaveLength(1);
    expect(await testDb!.driver.all("SELECT run_id FROM diagnostic_checks")).toHaveLength(3);
  });
});
