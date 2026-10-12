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
  TransportUnavailableError,
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
import type { AirtimeNoticeStore, RunPorts, RunSession } from "./ports";
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
    expect(runs.saved[0]!.companion.name).not.toBe("");
    expect(runs.saved[0]!.companion.publicKey).toHaveLength(64);
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
    expect(runs.saved[0]!.companion).toEqual({ publicKey: "", name: "", firmwareVersion: "" });
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
    expect(runs.saved[0]!.checks.map((c) => [c.reason, c.attempts])).toEqual([
      ["CAPABILITY_MISSING", 0],
    ]);
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
    expect(state.latest[ROOM_K]?.id).toBeUndefined();
  });

  it("starts with nothing loaded, no run and a healthy store", () => {
    const { controller } = setup([{}]);
    expect(controller.getState()).toEqual({
      latest: {},
      loaded: false,
      active: null,
      notice: null,
      last: null,
      refusal: null,
      storage: "ok",
    });
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

describe("RunController edge cases", () => {
  const caps = (telemetry: boolean) =>
    ({
      contacts: { supported: true },
      login: { supported: true },
      status: { supported: true },
      telemetry: { supported: telemetry },
      trace: { supported: true },
    }) as const;

  function build(
    runChecks: RunSession["runChecks"],
    options: {
      connected?: boolean;
      capabilities?: ReturnType<typeof caps> | null;
      notice?: AirtimeNoticeStore;
      repository?: RunPorts["repository"];
      appState?: InMemoryAppState;
    } = {},
  ) {
    const store = createStore<SessionState>(
      () =>
        ({
          connection:
            options.connected === false
              ? { kind: "disconnected" }
              : {
                  kind: "connected",
                  companion: { publicKey: "cd".repeat(32), name: "C", firmwareVersion: "v1.17.1" },
                },
          capabilities: options.capabilities === undefined ? caps(true) : options.capabilities,
        }) as unknown as SessionState,
    );
    const runs = new MemoryRuns();
    const appState = options.appState ?? new InMemoryAppState();
    const controller = new RunController({
      session: { store, runChecks },
      appState,
      notice: options.notice ?? new InMemoryAirtimeNoticeStore(true),
      repository: options.repository ?? (async () => runs),
      password: async () => "",
      policy: () => DEFAULT_DIAGNOSTIC_POLICY,
      clock: Date.now,
    });
    return { controller, runs, appState };
  }

  const outcome = (
    kind: CheckOutcome["kind"],
    result: CheckOutcome["result"],
    reason: CheckOutcome["reason"],
    attempts = 1,
  ): CheckOutcome => ({
    kind,
    result,
    reason,
    attempts,
    timeoutMs: 5000,
    timeoutSource: "estimate",
    startedAt: 1,
    durationMs: 10,
    evidence: null,
  });
  const replied = (kind: CheckOutcome["kind"]) => outcome(kind, "RESPONDED", "ALL_CHECKS_REPLIED");
  const never: RunSession["runChecks"] = () => new Promise(() => undefined);

  it("cancel with no run in flight does nothing", () => {
    const { controller } = build(never);
    expect(() => controller.cancel()).not.toThrow();
  });

  it("a second start while the first waits is refused and sends nothing", async () => {
    const runChecks = vi.fn(never);
    const { controller } = build(runChecks);
    void controller.start(ROOM_K);
    await vi.waitFor(() => expect(runChecks).toHaveBeenCalledTimes(1));
    await controller.start(OTHER);
    expect(runChecks).toHaveBeenCalledTimes(1);
    expect(controller.getState().refusal?.text.key).toBe("diagnostic.refusal.busy");
  });

  it("a start while the airtime notice check is pending is busy, and confirm while running too", async () => {
    let answer!: (seen: boolean) => void;
    const runChecks = vi.fn(never);
    const notice: AirtimeNoticeStore = {
      seen: () => new Promise((resolve) => (answer = resolve)),
      markSeen: async () => undefined,
    };
    const { controller } = build(runChecks, { notice });
    void controller.start(ROOM_K);
    await vi.waitFor(() => expect(answer).toBeTypeOf("function"));
    controller.store.setState({ notice: OTHER });
    await controller.confirmNotice();
    expect(runChecks).not.toHaveBeenCalled();
    expect(controller.getState().refusal).toEqual({
      publicKey: OTHER,
      text: { key: "diagnostic.refusal.busy" },
    });
  });

  it("a run started from the notice also blocks a second start", async () => {
    const runChecks = vi.fn(never);
    const { controller } = build(runChecks, {
      notice: { seen: async () => false, markSeen: async () => undefined },
    });
    await controller.start(ROOM_K);
    void controller.confirmNotice();
    await vi.waitFor(() => expect(runChecks).toHaveBeenCalledTimes(1));
    await controller.start(OTHER);
    expect(runChecks).toHaveBeenCalledTimes(1);
    expect(controller.getState().refusal?.text.key).toBe("diagnostic.refusal.busy");
  });

  it("runs even if the notice cannot be remembered", async () => {
    const runChecks = vi.fn(async () => [
      replied("login"),
      replied("status"),
      replied("telemetry"),
    ]);
    const { controller, runs } = build(runChecks, {
      notice: {
        seen: async () => false,
        markSeen: async () => {
          throw new Error("storage");
        },
      },
    });
    await controller.start(ROOM_K);
    await controller.confirmNotice();
    expect(runs.saved).toHaveLength(1);
  });

  it("does not keep the skipped check when fewer checks ran than planned", async () => {
    const { controller, runs } = build(async () => [replied("login")], {
      capabilities: caps(false),
    });
    await controller.start(ROOM_K);
    expect(runs.saved[0]!.checks.map((c) => c.kind)).toEqual(["login"]);
  });

  it("confirmNotice without a notice sends nothing and remembers nothing", async () => {
    const runChecks = vi.fn(never);
    const markSeen = vi.fn(async () => undefined);
    const { controller } = build(runChecks, {
      notice: { seen: async () => false, markSeen },
    });
    await controller.confirmNotice();
    expect(markSeen).not.toHaveBeenCalled();
    expect(runChecks).not.toHaveBeenCalled();
  });

  it("confirmNotice in the background keeps the notice and sends nothing", async () => {
    const runChecks = vi.fn(never);
    const { controller, appState } = build(runChecks, {
      notice: { seen: async () => false, markSeen: async () => undefined },
    });
    await controller.start(ROOM_K);
    expect(controller.getState().notice).toBe(ROOM_K);
    appState.set("background");
    await controller.confirmNotice();
    expect(controller.getState().notice).toBe(ROOM_K);
    expect(runChecks).not.toHaveBeenCalled();
  });

  it("treats an unreadable notice flag as not seen: shows the notice, sends nothing", async () => {
    const runChecks = vi.fn(never);
    const { controller } = build(runChecks, {
      notice: {
        seen: async () => {
          throw new Error("storage");
        },
        markSeen: async () => undefined,
      },
    });
    await controller.start(ROOM_K);
    expect(controller.getState().notice).toBe(ROOM_K);
    expect(runChecks).not.toHaveBeenCalled();
  });

  it.each([
    ["disconnected, capabilities still present", { connected: false }],
    ["connected, capabilities unknown", { capabilities: null }],
  ])("%s is NOT_CONNECTED and sends nothing", async (_name, options) => {
    const runChecks = vi.fn(never);
    const { controller, runs } = build(runChecks, options);
    await controller.start(ROOM_K);
    expect(runChecks).not.toHaveBeenCalled();
    expect(runs.saved[0]).toMatchObject({
      result: "TRANSPORT_UNAVAILABLE",
      reason: "NOT_CONNECTED",
    });
  });

  it("a link that is gone when the run starts is NOT_CONNECTED, not an unexpected error", async () => {
    const { controller, runs } = build(async () => {
      throw new TransportUnavailableError();
    });
    await controller.start(ROOM_K);
    expect(runs.saved[0]).toMatchObject({
      result: "TRANSPORT_UNAVAILABLE",
      reason: "NOT_CONNECTED",
      attemptsUsed: 0,
    });
  });

  it("keeps the skipped check only for a run that went through", async () => {
    const through = build(async () => [replied("login"), replied("status")], {
      capabilities: caps(false),
    });
    await through.controller.start(ROOM_K);
    expect(through.runs.saved[0]!.checks.map((c) => c.kind)).toEqual([
      "login",
      "status",
      "telemetry",
    ]);

    const stopped = build(
      async () => [replied("login"), outcome("status", "NO_RESPONSE", "NO_REPLY", 2)],
      { capabilities: caps(false) },
    );
    await stopped.controller.start(ROOM_K);
    expect(stopped.runs.saved[0]!.checks.map((c) => c.kind)).toEqual(["login", "status"]);
    expect(stopped.runs.saved[0]).toMatchObject({ result: "RESPONDED", reason: "PARTIAL_REPLY" });
  });

  it("a cancelled check in the outcomes makes the run cancelled even if the signal was not aborted", async () => {
    const { controller, runs } = build(async () => [
      replied("login"),
      outcome("status", "NOT_TESTED", "CANCELLED", 1),
    ]);
    await controller.start(ROOM_K);
    expect(runs.saved[0]).toMatchObject({ result: "NOT_TESTED", reason: "CANCELLED" });
  });

  it("reports a storage that cannot open: no results, the error flag, loaded, and get is null", async () => {
    const { controller } = build(never, {
      repository: async () => {
        throw new Error("no db");
      },
    });
    await controller.load();
    expect(controller.getState()).toMatchObject({ loaded: true, storage: "error", latest: {} });
    expect(await controller.get(1)).toBeNull();
  });

  it("reports a failing read of the newest runs", async () => {
    const failing = new MemoryRuns();
    failing.latestPerNode = async () => {
      throw new Error("read");
    };
    const { controller } = build(never, { repository: async () => failing });
    await controller.load();
    expect(controller.getState()).toMatchObject({ loaded: true, storage: "error" });
  });

  it("get returns null when the read of one run fails", async () => {
    const failing = new MemoryRuns();
    failing.get = async () => {
      throw new Error("read");
    };
    const { controller } = build(never, { repository: async () => failing });
    expect(await controller.get(1)).toBeNull();
  });
});

describe("CompanionSession.runChecks", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const request = (signal?: AbortSignal) => ({
    publicKey: ROOM_K,
    checks: ["login", "status", "telemetry"] as const,
    password: "",
    policy: DEFAULT_DIAGNOSTIC_POLICY,
    ...(signal === undefined ? {} : { signal }),
  });

  it("is refused when not connected", async () => {
    const { session, platform } = setup([{}]);
    await expect(session.runChecks(request())).rejects.toBeInstanceOf(TransportUnavailableError);
    expect(remoteWrites(platform)).toBe(0);
  });

  it("is refused while the handshake is still running", async () => {
    const { session, platform } = setup([{}]);
    const connecting = session.connect(ID);
    let refused = 0;
    for (let step = 0; step < 20 && session.getState().connection.kind === "connecting"; step++) {
      await expect(session.runChecks(request())).rejects.toBeInstanceOf(TransportUnavailableError);
      refused++;
      await vi.advanceTimersByTimeAsync(1);
    }
    expect(refused).toBeGreaterThan(0);
    await vi.runAllTimersAsync();
    await connecting;
    expect(remoteWrites(platform)).toBe(0);
  });

  it("writes nothing when the caller's signal is already aborted", async () => {
    const { session, platform } = setup([{}]);
    await connect(session);
    const abort = new AbortController();
    abort.abort();
    const outcomes = await session.runChecks(request(abort.signal));
    expect(outcomes).toEqual([]);
    expect(remoteWrites(platform)).toBe(0);
  });

  it("aborts the request in flight when the caller's signal aborts", async () => {
    const { session, platform } = setup([{ login: "no-reply" }]);
    await connect(session);
    const abort = new AbortController();
    const done = session.runChecks(request(abort.signal));
    await vi.advanceTimersByTimeAsync(1_000);
    abort.abort();
    const outcomes = await done;
    expect(outcomes.map((o) => [o.kind, o.reason])).toEqual([["login", "CANCELLED"]]);
    expect(writesOf(platform, 0x1b)).toBe(0);
  });

  it("aborts the run when the user disconnects", async () => {
    const { session } = setup([{ login: "no-reply" }]);
    await connect(session);
    const done = session.runChecks(request());
    await vi.advanceTimersByTimeAsync(1_000);
    await session.disconnect();
    const outcomes = await done;
    expect(outcomes.map((o) => o.reason)).toEqual(["CANCELLED"]);
  });

  it("stops listening to the caller's signal once the run ended", async () => {
    const { session } = setup([{}]);
    await connect(session);
    const listeners = new Set<unknown>();
    const signal = {
      aborted: false,
      addEventListener: (_type: string, listener: unknown) => listeners.add(listener),
      removeEventListener: (_type: string, listener: unknown) => listeners.delete(listener),
    } as unknown as AbortSignal;
    const done = session.runChecks(request(signal));
    await vi.runAllTimersAsync();
    await done;
    expect(listeners.size).toBe(0);
  });

  it("keeps the cooldown across a reconnect (plan D-7)", async () => {
    const { session } = setup([{}, {}]);
    await connect(session);
    const first = session.runChecks(request());
    await vi.runAllTimersAsync();
    await first;
    await session.disconnect();
    await connect(session);
    const second = session.runChecks(request());
    const assertion = expect(second).rejects.toMatchObject({ name: "CooldownError" });
    await vi.runAllTimersAsync();
    await assertion;
  });
});
