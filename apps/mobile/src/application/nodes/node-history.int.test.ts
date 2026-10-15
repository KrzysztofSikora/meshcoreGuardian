import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_DIAGNOSTIC_POLICY, type DiagnosticRunRepository } from "@guardian/domain";
import {
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

  async function runTwice(): Promise<void> {
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
    for (let i = 0; i < 2; i++) {
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

  it("a node without runs is ok with nothing in it", async () => {
    const controller = history();
    await controller.load(ROOM_K);
    expect(controller.store.getState().byNode[ROOM_K]).toEqual({
      status: "ok",
      runs: [],
      lastRespondedAt: null,
      samples: [],
    });
  });

  it("a storage failure ends in the error state without a specific cause", async () => {
    const controller = history(async () => {
      throw new Error("disk on fire");
    });
    await controller.load(ROOM_K);
    expect(controller.store.getState().byNode[ROOM_K]).toEqual({
      status: "error",
      runs: [],
      lastRespondedAt: null,
      samples: [],
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
      runs: [],
      lastRespondedAt: null,
      samples: [],
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
