import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_DIAGNOSTIC_POLICY, type DiagnosticRunRepository } from "@guardian/domain";
import {
  SqliteDataEraser,
  SqliteDiagnosticRunRepository,
  SqliteNodeRepository,
  SqliteTelemetryRepository,
} from "@guardian/storage";
import { openTestDb, type TestDb } from "@guardian/storage/testing";

import { SCENARIOS } from "../../debug/scenarios";
import { FakeBlePlatform } from "../../platform/fake/fake-ble-platform";
import {
  InMemoryAirtimeNoticeStore,
  InMemoryAppState,
  InMemoryLastCompanionStore,
} from "../../platform/fake/in-memory";
import { CompanionSession } from "../connection/companion-session";
import { RunController } from "../diagnostics/run-controller";
import { NodeHistoryController } from "./node-history";
import { NodesController } from "./nodes-controller";

const ID = "AA:BB:CC:DD:EE:01";
const ROOM_K = "7c73a8cd01d92e249bf6ed13af3f60499260e408c674ad5e11a44000d87acc28";

describe("NodeHistoryController (FR-07, FR-08 AC2)", () => {
  let testDb: TestDb;

  beforeEach(async () => {
    vi.useFakeTimers();
    testDb = await openTestDb();
  });
  afterEach(() => {
    vi.useRealTimers();
    testDb.close();
  });

  const history = (runs?: () => Promise<DiagnosticRunRepository>) =>
    new NodeHistoryController({
      runs: runs ?? (async () => new SqliteDiagnosticRunRepository(testDb.driver)),
      telemetry: async () => new SqliteTelemetryRepository(testDb.driver),
    });

  async function runTwice(count = 2): Promise<void> {
    const platform = new FakeBlePlatform(SCENARIOS["diag-ok"]);
    const appState = new InMemoryAppState();
    const session = new CompanionSession({
      platform,
      appState,
      lastCompanionStore: new InMemoryLastCompanionStore(),
    });
    const nodes = new NodesController({
      session,
      appState,
      clock: Date.now,
      repository: async () => new SqliteNodeRepository(testDb.driver),
    });
    const runs = new RunController({
      session,
      appState,
      clock: Date.now,
      repository: async () => new SqliteDiagnosticRunRepository(testDb.driver),
      notice: new InMemoryAirtimeNoticeStore(true),
      password: async () => "",
      adminPassword: async () => undefined,
      policy: () => DEFAULT_DIAGNOSTIC_POLICY,
    });
    const connecting = session.connect(ID);
    await vi.runAllTimersAsync();
    await connecting;
    await vi.runAllTimersAsync();
    expect(nodes.getState().sync.kind).toBe("done");
    for (let i = 0; i < count; i++) {
      const running = runs.start(ROOM_K);
      await vi.runAllTimersAsync();
      await running;
      expect(runs.getState().last?.result).toBe("RESPONDED");
      vi.advanceTimersByTime(10 * 60_000);
    }
  }

  it("returns runs newest first, the last response and the latest samples of a stored run", async () => {
    await runTwice();
    const controller = history();
    await controller.load(ROOM_K);
    const node = controller.store.getState().byNode[ROOM_K]!;
    expect(node.status).toBe("ok");
    expect(node.runs).toHaveLength(2);
    expect(node.runs[0]!.finishedAt).toBeGreaterThan(node.runs[1]!.finishedAt);
    expect(node.runs[0]!.checks).toEqual([]);
    expect(node.lastRespondedAt).toBe(node.runs[0]!.finishedAt);
    expect(node.samples.map((s) => s.source)).toEqual(["status", "telemetry"]);
    expect(node.samples.every((s) => s.runId === node.runs[0]!.id)).toBe(true);
  });

  it("forgets cached history of one node or of all, and reads fresh data on the next load (settings D-8)", async () => {
    await runTwice(1);
    const controller = history();
    await controller.load(ROOM_K);
    await controller.load("ab".repeat(32));
    expect(controller.store.getState().byNode[ROOM_K]!.runs).toHaveLength(1);

    controller.forget("ab".repeat(32));
    expect(Object.keys(controller.store.getState().byNode)).toEqual([ROOM_K]);

    await new SqliteDataEraser(testDb.driver).eraseNodeHistory(ROOM_K);
    controller.forget(null);
    expect(controller.store.getState().byNode).toEqual({});
    await controller.load(ROOM_K);
    const node = controller.store.getState().byNode[ROOM_K]!;
    expect(node).toMatchObject({ status: "ok", runs: [], samples: [], voltage: [] });
  });

  it("holds one status voltage point per stored run, oldest first (FR-12 AC1)", async () => {
    await runTwice();
    const controller = history();
    await controller.load(ROOM_K);
    const { runs, voltage } = controller.store.getState().byNode[ROOM_K]!;
    expect(voltage).toHaveLength(2);
    expect(voltage.map((p) => p.source)).toEqual(["status", "status"]);
    expect(voltage.map((p) => p.runId)).toEqual([runs[1]!.id, runs[0]!.id]);
    expect(voltage[0]!.at).toBeLessThan(voltage[1]!.at);
    expect(voltage[0]!.voltageV).toBeGreaterThan(0);
  });

  it("samples without any voltage leave the voltage empty (FR-12 AC4)", async () => {
    await runTwice(0);
    const status = {
      kind: "status" as const,
      result: "RESPONDED" as const,
      reason: "ALL_CHECKS_REPLIED" as const,
      attempts: 1,
      timeoutMs: 15_000,
      timeoutSource: "default" as const,
      startedAt: 1000,
      durationMs: 500,
      evidence: {
        kind: "status" as const,
        battMilliVolts: 0,
        currTxQueueLen: 0,
        noiseFloor: -110,
        lastRssi: -34,
        nPacketsRecv: 1,
        nPacketsSent: 1,
        totalAirTimeSecs: 1,
        totalUpTimeSecs: 5,
        nSentFlood: 0,
        nSentDirect: 0,
        nRecvFlood: 0,
        nRecvDirect: 0,
        errEvents: 0,
        lastSnrX4: 0,
        nDirectDups: 0,
        nFloodDups: 0,
      },
    };
    await new SqliteDiagnosticRunRepository(testDb.driver).save({
      nodePublicKey: ROOM_K,
      companion: { publicKey: "ef".repeat(32), name: "Companion", firmwareVersion: "v1.17.1" },
      startedAt: 500,
      finishedAt: 2000,
      durationMs: 1500,
      attemptsUsed: 1,
      attemptsPerCheck: 2,
      result: "RESPONDED",
      reason: "ALL_CHECKS_REPLIED",
      limitations: [],
      checks: [status],
    });
    const controller = history();
    await controller.load(ROOM_K);
    const node = controller.store.getState().byNode[ROOM_K]!;
    expect(node.samples).toHaveLength(1);
    expect(node.samples[0]!.voltageV).toBeNull();
    expect(node.voltage).toEqual([]);
  });

  it("a failing voltage read ends in the error state and keeps the previous data", async () => {
    await runTwice();
    let fail = false;
    const controller = new NodeHistoryController({
      runs: async () => new SqliteDiagnosticRunRepository(testDb.driver),
      telemetry: async () => {
        const real = new SqliteTelemetryRepository(testDb.driver);
        return {
          latestForNode: (key) => real.latestForNode(key),
          forRuns: (ids) => real.forRuns(ids),
          voltageForNode: (key, n) =>
            fail ? Promise.reject(new Error("disk on fire")) : real.voltageForNode(key, n),
        };
      },
    });
    await controller.load(ROOM_K);
    const good = controller.store.getState().byNode[ROOM_K]!;
    expect(good.voltage).toHaveLength(2);
    fail = true;
    await controller.load(ROOM_K);
    expect(controller.store.getState().byNode[ROOM_K]).toEqual({ ...good, status: "error" });
  });

  it("a node without runs is ok with nothing in it", async () => {
    const controller = history();
    await controller.load(ROOM_K);
    expect(controller.store.getState().byNode[ROOM_K]).toEqual({
      status: "ok",
      loaded: true,
      runs: [],
      lastRespondedAt: null,
      samples: [],
      voltage: [],
    });
  });

  it("a storage failure ends in the error state without a specific cause", async () => {
    const controller = history(async () => {
      throw new Error("disk on fire");
    });
    await controller.load(ROOM_K);
    expect(controller.store.getState().byNode[ROOM_K]).toEqual({
      status: "error",
      loaded: false,
      runs: [],
      lastRespondedAt: null,
      samples: [],
      voltage: [],
    });
  });

  it("shows loading with nothing on a first read, and keeps the previous data while reloading", async () => {
    await runTwice();
    let release: () => void = () => {};
    let gate: Promise<void> = Promise.resolve();
    const controller = history(async () => {
      await gate;
      return new SqliteDiagnosticRunRepository(testDb.driver);
    });
    gate = new Promise<void>((resolve) => (release = resolve));
    const first = controller.load(ROOM_K);
    expect(controller.store.getState().byNode[ROOM_K]).toEqual({
      status: "loading",
      loaded: false,
      runs: [],
      lastRespondedAt: null,
      samples: [],
      voltage: [],
    });
    release();
    await first;
    const loaded = controller.store.getState().byNode[ROOM_K]!;
    expect(loaded.status).toBe("ok");

    gate = new Promise<void>((resolve) => (release = resolve));
    const again = controller.load(ROOM_K);
    expect(controller.store.getState().byNode[ROOM_K]).toEqual(loaded);
    release();
    await again;
  });

  it("a failed reload keeps the data of the last good read and flags the error (R2)", async () => {
    await runTwice();
    let fail = false;
    const controller = history(async () => {
      if (fail) throw new Error("disk on fire");
      return new SqliteDiagnosticRunRepository(testDb.driver);
    });
    await controller.load(ROOM_K);
    const good = controller.store.getState().byNode[ROOM_K]!;
    expect(good.runs).toHaveLength(2);
    fail = true;
    await controller.load(ROOM_K);
    expect(controller.store.getState().byNode[ROOM_K]).toEqual({ ...good, status: "error" });
  });

  it("two concurrent loads of one node share one read", async () => {
    let opened = 0;
    const controller = history(async () => {
      opened += 1;
      return new SqliteDiagnosticRunRepository(testDb.driver);
    });
    await Promise.all([controller.load(ROOM_K), controller.load(ROOM_K)]);
    expect(opened).toBe(1);
    await controller.load(ROOM_K);
    expect(opened).toBe(2);
  });
});
