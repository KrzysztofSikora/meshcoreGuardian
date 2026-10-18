import { afterEach, describe, expect, it } from "vitest";

import type { CheckOutcome, DiagnosticRun } from "@guardian/domain";

import { SqliteDataEraser } from "../src/data/data-eraser";
import { SqliteDiagnosticRunRepository } from "../src/diagnostics/run-repository";
import { SqliteNodeRepository } from "../src/nodes/node-repository";
import { SqliteTelemetryRepository } from "../src/telemetry/telemetry-repository";
import { openTestDb, type TestDb } from "./helpers/open-test-db";

const A = "ab".repeat(32);
const B = "cd".repeat(32);

const statusCheck: CheckOutcome = {
  kind: "status",
  result: "RESPONDED",
  reason: "ALL_CHECKS_REPLIED",
  attempts: 1,
  timeoutMs: 15_000,
  timeoutSource: "default",
  startedAt: 2_000,
  durationMs: 900,
  evidence: {
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
  },
};

const run = (nodePublicKey: string): DiagnosticRun => ({
  nodePublicKey,
  companion: { publicKey: "ef".repeat(32), name: "Companion", firmwareVersion: "v1.17.1" },
  startedAt: 1_000,
  finishedAt: 3_000,
  durationMs: 2_000,
  attemptsUsed: 1,
  attemptsPerCheck: 2,
  result: "RESPONDED",
  reason: "ALL_CHECKS_REPLIED",
  limitations: [],
  checks: [statusCheck],
});

const report = (publicKey: string) => ({
  publicKey,
  name: "Node",
  type: 2,
  lastHeardAt: 1,
  pathHops: null,
  position: null,
});

describe("SqliteDataEraser", () => {
  let testDb: TestDb | undefined;
  afterEach(() => {
    testDb?.close();
    testDb = undefined;
  });

  async function setup() {
    testDb = await openTestDb();
    // The eraser must not rely on cascades (settings D-8).
    await testDb.driver.exec("PRAGMA foreign_keys = OFF");
    const nodes = new SqliteNodeRepository(testDb.driver);
    const runs = new SqliteDiagnosticRunRepository(testDb.driver);
    const samples = new SqliteTelemetryRepository(testDb.driver);
    await nodes.applySync([report(A), report(B)], {
      complete: true,
      now: 10,
      origin: { companionPublicKey: "ef".repeat(32), position: null },
    });
    for (const key of [A, B]) {
      await nodes.setLabel(key, `Label ${key.slice(0, 2)}`);
      await nodes.setRole(key, "repeater");
      await nodes.pinToDashboard(key);
      await runs.save(run(key));
    }
    return { nodes, runs, samples, eraser: new SqliteDataEraser(testDb.driver) };
  }

  const count = async (table: string) =>
    (await testDb!.driver.all<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`))[0]!.n;

  it("erases one node's runs, checks, samples, label and role, and keeps the rest", async () => {
    const { nodes, runs, samples, eraser } = await setup();
    expect(await samples.latestForNode(A)).not.toEqual([]);

    await eraser.eraseNodeHistory(A);

    expect(await runs.recentForNode(A, 10)).toEqual([]);
    expect(await samples.latestForNode(A)).toEqual([]);
    expect(await samples.voltageForNode(A, 10)).toEqual([]);
    const a = await nodes.get(A);
    expect(a).not.toBeNull();
    expect(a!.userLabel).toBeNull();
    expect(a!.userRole).toBeNull();
    expect(a!.dashboardPinned).toBe(true);
    const b = await nodes.get(B);
    expect(b!.userLabel).toBe("Label cd");
    expect(await runs.recentForNode(B, 10)).toHaveLength(1);
    expect(await samples.latestForNode(B)).not.toEqual([]);
    expect(await count("diagnostic_checks")).toBe(1);
    expect(await count("telemetry_samples")).toBe(1);
  });

  it("treats an unknown node as a no-op", async () => {
    const { eraser } = await setup();

    await eraser.eraseNodeHistory("ee".repeat(32));

    expect(await count("diagnostic_runs")).toBe(2);
    expect(await count("devices")).toBe(2);
  });

  it("erases everything and leaves a migrated database that still accepts data", async () => {
    const { nodes, runs, eraser } = await setup();

    await eraser.eraseAll();

    for (const table of [
      "telemetry_samples",
      "diagnostic_checks",
      "diagnostic_runs",
      "devices",
      "contact_sync_origin",
    ]) {
      expect(await count(table)).toBe(0);
    }
    expect(await nodes.syncOrigin()).toBeNull();
    await nodes.applySync([report(A)], {
      complete: true,
      now: 20,
      origin: { companionPublicKey: "ef".repeat(32), position: null },
    });
    await expect(runs.save(run(A))).resolves.toBeGreaterThan(0);
  });

  it("rolls back when a statement fails", async () => {
    const { eraser } = await setup();
    // Block the last delete of eraseAll so the earlier ones must be undone.
    await testDb!.driver.exec(
      `CREATE TRIGGER block_origin BEFORE DELETE ON contact_sync_origin
       BEGIN SELECT RAISE(ABORT, 'blocked'); END`,
    );

    await expect(eraser.eraseAll()).rejects.toThrow();

    expect(await count("devices")).toBe(2);
    expect(await count("diagnostic_runs")).toBe(2);
    expect(await count("telemetry_samples")).toBe(2);
  });
});
