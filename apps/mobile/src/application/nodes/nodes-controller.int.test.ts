import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ContactReport, Node, NodeRepository, NodeRole, SyncOutcome } from "@guardian/domain";

import { SCENARIOS, type ScenarioName } from "../../debug/scenarios";
import { FakeBlePlatform, type Scenario } from "../../platform/fake/fake-ble-platform";
import { InMemoryAppState, InMemoryLastCompanionStore } from "../../platform/fake/in-memory";
import { CompanionSession } from "../connection/companion-session";
import { NodesController } from "./nodes-controller";

const ID = "AA:BB:CC:DD:EE:01";
const NOW = 1_800_000_000_000;

/** Records calls and returns what it was given; the merge rules are tested in packages/storage. */
class MemoryRepository implements NodeRepository {
  syncs: { reports: readonly ContactReport[]; complete: boolean; now: number }[] = [];
  reads = 0;
  failWith: Error | null = null;
  nodes: Node[] = [];

  async applySync(
    reports: readonly ContactReport[],
    opts: { complete: boolean; now: number },
  ): Promise<SyncOutcome> {
    if (this.failWith !== null) throw this.failWith;
    this.syncs.push({ reports, ...opts });
    return { added: reports.length, updated: 0, markedMissing: 0 };
  }
  async listAll(): Promise<Node[]> {
    this.reads += 1;
    return this.nodes;
  }
  async get(publicKey: string): Promise<Node | null> {
    return this.nodes.find((node) => node.publicKey === publicKey) ?? null;
  }
  async setLabel(): Promise<void> {
    if (this.failWith !== null) throw this.failWith;
    this.labelCalls += 1;
  }
  async setRole(_key: string, _role: NodeRole | null): Promise<void> {
    if (this.failWith !== null) throw this.failWith;
  }
  async pinToDashboard(): Promise<void> {
    if (this.failWith !== null) throw this.failWith;
  }
  labelCalls = 0;
}

function setup(name: ScenarioName | Scenario, repository: () => Promise<NodeRepository>) {
  const platform = new FakeBlePlatform(typeof name === "string" ? SCENARIOS[name] : name);
  const appState = new InMemoryAppState();
  const session = new CompanionSession({
    platform,
    appState,
    lastCompanionStore: new InMemoryLastCompanionStore(),
  });
  const nodes = new NodesController({ session, repository, appState, clock: () => NOW });
  return { platform, appState, session, nodes };
}

function contactWrites(platform: FakeBlePlatform): number {
  return (platform.lastTransport?.writtenFrames ?? []).filter((frame) => frame[0] === 0x04).length;
}

async function connect(session: CompanionSession): Promise<void> {
  const done = session.connect(ID);
  await vi.runAllTimersAsync();
  await done;
}

describe("NodesController", () => {
  let repo: MemoryRepository;
  const open = () => Promise.resolve(repo);

  beforeEach(() => {
    vi.useFakeTimers();
    repo = new MemoryRepository();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("syncs once after connecting and stores a complete sync (FR-04 AC1)", async () => {
    const { session, nodes, platform } = setup("connect-ok", open);
    await connect(session);
    await vi.runAllTimersAsync();
    expect(nodes.getState().sync).toEqual({ kind: "done", at: NOW, total: 31 });
    expect(repo.syncs).toHaveLength(1);
    expect(repo.syncs[0]).toMatchObject({ complete: true, now: NOW });
    expect(repo.syncs[0]?.reports).toHaveLength(31);
    expect(contactWrites(platform)).toBe(1);
  });

  it("a store update without a new connection does not sync again; a reconnect does", async () => {
    const { session, nodes } = setup("connect-ok", open);
    await connect(session);
    await vi.runAllTimersAsync();
    session.store.setState({ mtu: 100 });
    await vi.runAllTimersAsync();
    expect(repo.syncs).toHaveLength(1);
    await session.disconnect();
    await connect(session);
    await vi.runAllTimersAsync();
    expect(repo.syncs).toHaveLength(2);
    expect(nodes.getState().sync.kind).toBe("done");
  });

  it("does not sync when the contacts capability is unsupported", async () => {
    const { session, nodes, platform } = setup(
      { ...SCENARIOS["connect-ok"], attempts: [{ firmware: { verCode: 0, version: "v0.9.0" } }] },
      open,
    );
    await connect(session);
    await vi.runAllTimersAsync();
    expect(nodes.getState().sync).toEqual({ kind: "idle" });
    expect(contactWrites(platform)).toBe(0);
  });

  it("does not sync on its own while the app is in the background (TR-18)", async () => {
    const { session, appState, nodes, platform } = setup("connect-ok", open);
    await session.initialize();
    const done = session.connect(ID);
    appState.set("background");
    await vi.runAllTimersAsync();
    await done;
    expect(session.getState().connection.kind).toBe("connected");
    expect(nodes.getState().sync).toEqual({ kind: "idle" });
    expect(contactWrites(platform)).toBe(0);
  });

  it("a second sync() while one runs does nothing; a manual sync runs after it", async () => {
    const { session, nodes, platform } = setup("connect-ok", open);
    await connect(session);
    await vi.runAllTimersAsync(); // the automatic sync
    expect(contactWrites(platform)).toBe(1);
    const again = nodes.sync();
    void nodes.sync();
    expect(nodes.getState().sync).toEqual({ kind: "syncing" });
    await vi.runAllTimersAsync();
    await again;
    expect(contactWrites(platform)).toBe(2);
    expect(nodes.getState().sync).toMatchObject({ kind: "done", total: 31 });
  });

  it("a drop mid-sync fails with TRANSPORT_UNAVAILABLE and stores nothing", async () => {
    const { session, nodes, platform } = setup("connect-ok", open);
    await connect(session);
    await vi.runAllTimersAsync(); // the automatic sync is done
    const sync = nodes.sync();
    await vi.advanceTimersByTimeAsync(500);
    platform.lastTransport?.drop();
    await vi.runAllTimersAsync();
    await sync;
    expect(nodes.getState().sync).toEqual({ kind: "failed", reason: "TRANSPORT_UNAVAILABLE" });
    expect(repo.syncs).toHaveLength(1);
  });

  it("silence ends as NO_RESPONSE and stores nothing", async () => {
    const { session, nodes, platform } = setup("connect-ok", open);
    await connect(session);
    await vi.runAllTimersAsync();
    platform.lastTransport?.silence(0x04);
    const sync = nodes.sync();
    await vi.runAllTimersAsync();
    await sync;
    expect(nodes.getState().sync).toEqual({ kind: "failed", reason: "NO_RESPONSE" });
    expect(repo.syncs).toHaveLength(1);
  });

  it("a user disconnect mid-sync ends as idle, not as a failure", async () => {
    const { session, nodes } = setup("connect-ok", open);
    await connect(session);
    await vi.runAllTimersAsync();
    const sync = nodes.sync();
    await vi.advanceTimersByTimeAsync(500);
    await session.disconnect();
    await vi.runAllTimersAsync();
    await sync;
    expect(nodes.getState().sync).toEqual({ kind: "idle" });
    expect(repo.syncs).toHaveLength(1);
  });

  it("a repository error ends as STORAGE_ERROR", async () => {
    const { session, nodes } = setup("connect-ok", open);
    repo.failWith = new Error("disk full");
    await connect(session);
    await vi.runAllTimersAsync();
    expect(nodes.getState().sync).toEqual({ kind: "failed", reason: "STORAGE_ERROR" });
  });

  it("a repository that cannot open sets storage error and sends no 0x04", async () => {
    const { session, nodes, platform } = setup("connect-ok", () => Promise.reject(new Error("x")));
    await connect(session);
    await vi.runAllTimersAsync();
    expect(nodes.getState()).toMatchObject({ storage: "error", nodes: [], loaded: true });
    expect(nodes.getState().sync).toEqual({ kind: "idle" });
    expect(contactWrites(platform)).toBe(0);
  });

  it("load() twice reads once", async () => {
    const { nodes } = setup("connect-ok", open);
    await Promise.all([nodes.load(), nodes.load()]);
    await nodes.load();
    expect(repo.reads).toBe(1);
    expect(nodes.getState().loaded).toBe(true);
  });

  it("setLabel too long is refused without a write; a failing write reports STORAGE_ERROR", async () => {
    const { nodes } = setup("connect-ok", open);
    expect(await nodes.setLabel("k", "x".repeat(65))).toEqual({ ok: false, reason: "TOO_LONG" });
    expect(repo.labelCalls).toBe(0);
    expect(await nodes.setLabel("k", "Hilltop")).toEqual({ ok: true });
    expect(repo.labelCalls).toBe(1);
    repo.failWith = new Error("locked");
    expect(await nodes.setRole("k", "repeater")).toEqual({ ok: false, reason: "STORAGE_ERROR" });
    expect(await nodes.pin("k")).toEqual({ ok: false, reason: "STORAGE_ERROR" });
  });
});
