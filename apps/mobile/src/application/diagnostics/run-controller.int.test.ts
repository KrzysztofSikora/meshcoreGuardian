import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStore } from "zustand/vanilla";

import {
  DEFAULT_DIAGNOSTIC_POLICY,
  type CheckOutcome,
  type DiagnosticRun,
  type DiagnosticRunRepository,
} from "@guardian/domain";
import {
  DIAG_CONTACTS_FRAMES,
  FakeTransport,
  HANDSHAKE_FRAMES,
  remoteScript,
  withFirmware,
  type RemoteScriptSpec,
  type ScriptFrame,
} from "@guardian/meshcore-adapter";

import { SCENARIOS } from "../../debug/scenarios";
import type { BleLink } from "../connection/ports";
import { FakeBlePlatform } from "../../platform/fake/fake-ble-platform";
import {
  InMemoryAirtimeNoticeStore,
  InMemoryAppState,
  InMemoryLastCompanionStore,
} from "../../platform/fake/in-memory";
import { CompanionSession, type SessionState } from "../connection/companion-session";
import type { RunSession } from "./ports";
import { RunController } from "./run-controller";

const ID = "AA:BB:CC:DD:EE:01";
const ROOM_K = "7c73a8cd01d92e249bf6ed13af3f60499260e408c674ad5e11a44000d87acc28";
const OTHER = "ab".repeat(32);
const START = 1_800_000_000_000;

class MemoryRuns implements DiagnosticRunRepository {
  saved: DiagnosticRun[] = [];
  failWith: Error | null = null;

  async save(run: DiagnosticRun): Promise<number> {
    if (this.failWith !== null) throw this.failWith;
    this.saved.push(run);
    return this.saved.length;
  }
  async get(id: number): Promise<DiagnosticRun | null> {
    const run = this.saved[id - 1];
    return run === undefined ? null : { ...run, id };
  }
  async latestPerNode(): Promise<Map<string, DiagnosticRun>> {
    return new Map(this.saved.map((run, index) => [run.nodePublicKey, { ...run, id: index + 1 }]));
  }
}

/** A companion whose handshake works and whose remote exchanges follow `specs`, one per run. */
class DiagPlatform extends FakeBlePlatform {
  transport: FakeTransport | null = null;

  constructor(
    private readonly specs: RemoteScriptSpec[],
    private readonly firmware?: { verCode: number; version: string },
  ) {
    super(SCENARIOS["connect-ok"]);
  }

  override async connect(): Promise<BleLink> {
    const handshake =
      this.firmware === undefined
        ? HANDSHAKE_FRAMES
        : withFirmware(HANDSHAKE_FRAMES, this.firmware);
    const frames: ScriptFrame[] = [
      ...handshake,
      ...DIAG_CONTACTS_FRAMES,
      ...this.specs.flatMap((spec) => remoteScript(spec)),
    ];
    this.transport = FakeTransport.fromFrames(frames);
    return { transport: this.transport, mtu: 185 };
  }
}

function writesOf(platform: DiagPlatform, code: number): number {
  return (platform.transport?.writtenFrames ?? []).filter((frame) => frame[0] === code).length;
}
const remoteWrites = (platform: DiagPlatform) =>
  [0x1a, 0x1b, 0x27].reduce((sum, code) => sum + writesOf(platform, code), 0);

function setup(
  specs: RemoteScriptSpec[],
  options: { noticeSeen?: boolean; firmware?: { verCode: number; version: string } } = {},
) {
  const platform = new DiagPlatform(specs, options.firmware);
  const appState = new InMemoryAppState();
  const session = new CompanionSession({
    platform,
    appState,
    lastCompanionStore: new InMemoryLastCompanionStore(),
  });
  const runs = new MemoryRuns();
  const notice = new InMemoryAirtimeNoticeStore(options.noticeSeen ?? true);
  const controller = new RunController({
    session,
    appState,
    notice,
    repository: async () => runs,
    password: async () => "",
    policy: () => DEFAULT_DIAGNOSTIC_POLICY,
    clock: Date.now,
  });
  return { platform, appState, session, runs, notice, controller };
}

async function connect(session: CompanionSession): Promise<void> {
  const done = session.connect(ID);
  await vi.runAllTimersAsync();
  await done;
}

describe("RunController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs login, status and telemetry, publishes progress and stores the run (FR-05 AC1, AC4)", async () => {
    const { session, controller, runs } = setup([{}]);
    await connect(session);
    const steps: string[] = [];
    controller.store.subscribe((state) => {
      if (state.active !== null)
        steps.push(`${state.active.step}:${state.active.attempt}/${state.active.of}`);
    });
    const t0 = Date.now();
    const done = controller.start(ROOM_K);
    await vi.runAllTimersAsync();
    await done;

    expect([...new Set(steps)]).toEqual(["login:0/2", "login:1/2", "status:1/2", "telemetry:1/2"]);
    expect(runs.saved).toHaveLength(1);
    const run = runs.saved[0]!;
    expect(run).toMatchObject({
      nodePublicKey: ROOM_K,
      result: "RESPONDED",
      reason: "ALL_CHECKS_REPLIED",
      attemptsUsed: 3,
      attemptsPerCheck: 2,
      startedAt: t0,
    });
    expect(run.companion.name).not.toBe("");
    expect(run.companion.publicKey).toHaveLength(64);
    expect(run.finishedAt).toBeGreaterThan(t0);
    expect(run.durationMs).toBe(run.finishedAt - t0);
    expect(run.checks.map((c) => [c.kind, c.result])).toEqual([
      ["login", "RESPONDED"],
      ["status", "RESPONDED"],
      ["telemetry", "RESPONDED"],
    ]);
    const state = controller.getState();
    expect(state.active).toBeNull();
    expect(state.last).toEqual({
      publicKey: ROOM_K,
      runId: 1,
      result: "RESPONDED",
      reason: "ALL_CHECKS_REPLIED",
    });
    expect(state.latest[ROOM_K]?.id).toBe(1);
  });

  it("sends nothing until start is called (FR-10 AC6)", async () => {
    const { session, controller, platform } = setup([{}]);
    await connect(session);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(remoteWrites(platform)).toBe(0);
    expect(controller.getState().active).toBeNull();
  });

  it("start in the background is refused without a write (FR-10 AC6, TR-18)", async () => {
    const { session, controller, platform, appState, runs } = setup([{}]);
    await connect(session);
    appState.set("background");
    await controller.start(ROOM_K);
    expect(remoteWrites(platform)).toBe(0);
    expect(runs.saved).toHaveLength(0);
    expect(controller.getState().notice).toBeNull();
  });

  it("cancel aborts the request in flight and stores NOT_TESTED/CANCELLED (FR-05 AC3)", async () => {
    const { session, controller, platform, runs } = setup([{ login: "no-reply" }]);
    await connect(session);
    const done = controller.start(ROOM_K);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(controller.getState().active?.attempt).toBe(1);
    controller.cancel();
    await vi.runAllTimersAsync();
    await done;

    expect(writesOf(platform, 0x1a)).toBe(1);
    expect(writesOf(platform, 0x1b)).toBe(0);
    expect(runs.saved[0]).toMatchObject({ result: "NOT_TESTED", reason: "CANCELLED" });
    expect(controller.getState().active).toBeNull();
  });

  it("a dropped link is stored as TRANSPORT_UNAVAILABLE, not as no response (FR-06 AC2)", async () => {
    const { session, controller, platform, runs } = setup([{}]);
    await connect(session);
    platform.transport!.dropAfterWrites(platform.transport!.writtenFrames.length + 1);
    const done = controller.start(ROOM_K);
    await vi.runAllTimersAsync();
    await done;
    expect(runs.saved[0]).toMatchObject({
      result: "TRANSPORT_UNAVAILABLE",
      reason: "LINK_LOST",
    });
  });

  it("silence on every attempt is NO_RESPONSE with exactly the allowed attempts", async () => {
    const { session, controller, platform, runs } = setup([
      { login: "no-reply" },
      { login: "no-reply" },
    ]);
    await connect(session);
    const done = controller.start(ROOM_K);
    await vi.runAllTimersAsync();
    await done;
    expect(runs.saved[0]).toMatchObject({
      result: "NO_RESPONSE",
      reason: "NO_REPLY",
      attemptsUsed: 2,
    });
    expect(writesOf(platform, 0x1a)).toBe(2);
    expect(writesOf(platform, 0x1b)).toBe(0);
  });

  it("a second start while a run is active is refused and stores nothing (FR-10 AC1)", async () => {
    const { session, controller, runs } = setup([{}]);
    await connect(session);
    const first = controller.start(ROOM_K);
    await vi.advanceTimersByTimeAsync(100);
    await controller.start(OTHER);
    expect(controller.getState().refusal).toEqual({
      publicKey: OTHER,
      text: { key: "diagnostic.refusal.busy" },
    });
    await vi.runAllTimersAsync();
    await first;
    expect(runs.saved).toHaveLength(1);
  });

  it("refuses a node asked less than 60 s ago, with a countdown, and allows it after (FR-10 AC2)", async () => {
    const { session, controller, runs } = setup([{}, {}]);
    await connect(session);
    const first = controller.start(ROOM_K);
    await vi.runAllTimersAsync();
    await first;
    const finished = runs.saved[0]!.finishedAt;

    vi.setSystemTime(finished + 59_000);
    await controller.start(ROOM_K);
    expect(controller.getState().refusal).toEqual({
      publicKey: ROOM_K,
      text: { key: "diagnostic.refusal.cooldown", params: { seconds: 1 } },
    });
    expect(runs.saved).toHaveLength(1);

    vi.setSystemTime(finished + 60_000);
    const again = controller.start(ROOM_K);
    await vi.runAllTimersAsync();
    await again;
    expect(runs.saved).toHaveLength(2);
    expect(controller.getState().refusal).toBeNull();
  });

  it("shows the airtime notice before the first run and remembers it (FR-10 AC5)", async () => {
    const { session, controller, platform, notice, runs } = setup([{}, {}], { noticeSeen: false });
    await connect(session);
    await controller.start(ROOM_K);
    expect(controller.getState().notice).toBe(ROOM_K);
    expect(remoteWrites(platform)).toBe(0);
    expect(await notice.seen()).toBe(false);

    controller.dismissNotice();
    expect(controller.getState().notice).toBeNull();
    expect(await notice.seen()).toBe(false);
    expect(remoteWrites(platform)).toBe(0);

    await controller.start(ROOM_K);
    const done = controller.confirmNotice();
    await vi.runAllTimersAsync();
    await done;
    expect(await notice.seen()).toBe(true);
    expect(runs.saved).toHaveLength(1);

    vi.setSystemTime(runs.saved[0]!.finishedAt + 61_000);
    const next = controller.start(OTHER);
    await vi.runAllTimersAsync();
    await next;
    expect(controller.getState().notice).toBeNull();
    expect(runs.saved).toHaveLength(2);
  });

  it("without a connection stores NOT_CONNECTED, sends nothing and starts no cooldown", async () => {
    const { controller, runs } = setup([{}]);
    await controller.start(ROOM_K);
    expect(runs.saved[0]).toMatchObject({
      result: "TRANSPORT_UNAVAILABLE",
      reason: "NOT_CONNECTED",
      attemptsUsed: 0,
    });
    await controller.start(ROOM_K);
    expect(runs.saved).toHaveLength(2);
    expect(controller.getState().refusal).toBeNull();
  });

  it("a companion without the status capability is UNSUPPORTED and sends nothing", async () => {
    const { session, controller, platform, runs } = setup([{}], {
      firmware: { verCode: 0, version: "v0.9.0" },
    });
    await connect(session);
    await controller.start(ROOM_K);
    expect(runs.saved[0]).toMatchObject({
      result: "UNSUPPORTED",
      reason: "CAPABILITY_MISSING",
      attemptsUsed: 0,
    });
    expect(remoteWrites(platform)).toBe(0);
  });

  it("a missing telemetry capability is stored as a skipped check and a limitation", async () => {
    const { session, controller, platform, runs } = setup([{}], {
      firmware: { verCode: 4, version: "v1.4.0" },
    });
    await connect(session);
    const done = controller.start(ROOM_K);
    await vi.runAllTimersAsync();
    await done;
    expect(writesOf(platform, 0x27)).toBe(0);
    const run = runs.saved[0]!;
    expect(run).toMatchObject({ result: "RESPONDED", reason: "ALL_CHECKS_REPLIED" });
    expect(run.checks.map((c) => [c.kind, c.reason, c.attempts])).toEqual([
      ["login", "ALL_CHECKS_REPLIED", 1],
      ["status", "ALL_CHECKS_REPLIED", 1],
      ["telemetry", "CAPABILITY_MISSING", 0],
    ]);
    expect(run.limitations).toEqual([
      { check: "telemetry", result: "UNSUPPORTED", reason: "CAPABILITY_MISSING" },
    ]);
  });

  it("a run that stops early does not store the later checks", async () => {
    const { session, controller, runs } = setup([{ login: "no-reply" }, { login: "no-reply" }]);
    await connect(session);
    const done = controller.start(ROOM_K);
    await vi.runAllTimersAsync();
    await done;
    expect(runs.saved[0]!.checks.map((c) => c.kind)).toEqual(["login"]);
  });

  it("keeps the result when it cannot be saved and says so", async () => {
    const { session, controller, runs } = setup([{}]);
    await connect(session);
    runs.failWith = new Error("disk full");
    const done = controller.start(ROOM_K);
    await vi.runAllTimersAsync();
    await done;
    const state = controller.getState();
    expect(state.storage).toBe("error");
    expect(state.last).toMatchObject({ runId: null, result: "RESPONDED" });
    expect(state.latest[ROOM_K]?.result).toBe("RESPONDED");
  });

  it("load reads the newest run per node once and get returns the checks", async () => {
    const { session, controller, runs } = setup([{}]);
    await connect(session);
    const done = controller.start(ROOM_K);
    await vi.runAllTimersAsync();
    await done;
    const fresh = new RunController({
      session,
      appState: new InMemoryAppState(),
      notice: new InMemoryAirtimeNoticeStore(true),
      repository: async () => runs,
      password: async () => "",
      policy: () => DEFAULT_DIAGNOSTIC_POLICY,
      clock: Date.now,
    });
    await fresh.load();
    await fresh.load();
    expect(fresh.getState().loaded).toBe(true);
    expect(fresh.getState().latest[ROOM_K]?.result).toBe("RESPONDED");
    expect((await fresh.get(1))?.checks).toHaveLength(3);
    expect(await fresh.get(99)).toBeNull();
  });
});

describe("RunController with a failing session", () => {
  function stub(runChecks: RunSession["runChecks"]) {
    const store = createStore<SessionState>(
      () =>
        ({
          connection: {
            kind: "connected",
            companion: { publicKey: "cd".repeat(32), name: "C", firmwareVersion: "v1.17.1" },
          },
          capabilities: {
            contacts: { supported: true },
            login: { supported: true },
            status: { supported: true },
            telemetry: { supported: true },
            trace: { supported: true },
          },
        }) as unknown as SessionState,
    );
    const runs = new MemoryRuns();
    const controller = new RunController({
      session: { store, runChecks },
      appState: new InMemoryAppState(),
      notice: new InMemoryAirtimeNoticeStore(true),
      repository: async () => runs,
      password: async () => "",
      policy: () => DEFAULT_DIAGNOSTIC_POLICY,
      clock: Date.now,
    });
    return { controller, runs };
  }

  it("an unknown error is NOT_TESTED/UNEXPECTED_ERROR, never a link loss (D-11)", async () => {
    const { controller, runs } = stub(async () => {
      throw new Error("boom");
    });
    await controller.start(ROOM_K);
    expect(runs.saved[0]).toMatchObject({ result: "NOT_TESTED", reason: "UNEXPECTED_ERROR" });
  });

  it("a client that is busy elsewhere is a refusal, not a stored run", async () => {
    const { BusyError } = await import("@guardian/meshcore-adapter");
    const { controller, runs } = stub(async () => {
      throw new BusyError("contacts");
    });
    await controller.start(ROOM_K);
    expect(runs.saved).toHaveLength(0);
    expect(controller.getState().refusal?.text.key).toBe("diagnostic.refusal.busy");
    expect(controller.getState().active).toBeNull();
  });

  it("a cooldown held by the client is a refusal with its remaining seconds", async () => {
    const { CooldownError } = await import("@guardian/meshcore-adapter");
    const { controller, runs } = stub(async () => {
      throw new CooldownError(12_001);
    });
    await controller.start(ROOM_K);
    expect(runs.saved).toHaveLength(0);
    expect(controller.getState().refusal?.text).toEqual({
      key: "diagnostic.refusal.cooldown",
      params: { seconds: 13 },
    });
  });

  it("a replied check followed by cancel is cancelled and keeps the reply (D-3)", async () => {
    const reply: CheckOutcome = {
      kind: "login",
      result: "RESPONDED",
      reason: "ALL_CHECKS_REPLIED",
      attempts: 1,
      timeoutMs: 5000,
      timeoutSource: "estimate",
      startedAt: 1,
      durationMs: 10,
      evidence: null,
    };
    let release!: () => void;
    const { controller, runs } = stub(
      () => new Promise<CheckOutcome[]>((resolve) => (release = () => resolve([reply]))),
    );
    const done = controller.start(ROOM_K);
    await vi.waitFor(() => expect(controller.getState().active).not.toBeNull());
    controller.cancel();
    release();
    await done;
    expect(runs.saved[0]).toMatchObject({ result: "NOT_TESTED", reason: "CANCELLED" });
    expect(runs.saved[0]!.checks).toHaveLength(1);
  });
});
