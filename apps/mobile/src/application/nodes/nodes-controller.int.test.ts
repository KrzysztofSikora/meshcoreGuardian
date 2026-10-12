import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createStore, type StoreApi } from "zustand/vanilla";

import {
  AbortError,
  BusyError,
  CommandRejectedError,
  MalformedFrameError,
  type ContactsResult,
} from "@guardian/meshcore-adapter";
import type {
  ContactReport,
  Node,
  NodeRepository,
  NodeRole,
  SyncOrigin,
  SyncOutcome,
} from "@guardian/domain";

import { SCENARIOS, type ScenarioName } from "../../debug/scenarios";
import { FakeBlePlatform, type Scenario } from "../../platform/fake/fake-ble-platform";
import { InMemoryAppState, InMemoryLastCompanionStore } from "../../platform/fake/in-memory";
import { CompanionSession, type SessionState } from "../connection/companion-session";
import { NodesController } from "./nodes-controller";

const ID = "AA:BB:CC:DD:EE:01";
const NOW = 1_800_000_000_000;

/** Records calls and returns what it was given; the merge rules are tested in packages/storage. */
class MemoryRepository implements NodeRepository {
  syncs: {
    reports: readonly ContactReport[];
    complete: boolean;
    now: number;
    origin: SyncOrigin extends infer O ? Omit<O & object, "at"> : never;
  }[] = [];
  stored: SyncOrigin | null = null;
  reads = 0;
  failWith: Error | null = null;
  nodes: Node[] = [];

  async applySync(
    reports: readonly ContactReport[],
    opts: Parameters<NodeRepository["applySync"]>[1],
  ): Promise<SyncOutcome> {
    if (this.failWith !== null) throw this.failWith;
    this.syncs.push({ reports, ...opts });
    this.stored = { ...opts.origin, at: opts.now };
    return { added: reports.length, updated: 0, markedMissing: 0 };
  }
  async listAll(): Promise<Node[]> {
    this.reads += 1;
    return this.nodes;
  }
  async syncOrigin(): Promise<SyncOrigin | null> {
    return this.stored;
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
    // AC6: a sync asks the radio for contacts and nothing else.
    expect(platform.lastTransport?.writtenFrames.map((frame) => frame[0])).toEqual([
      0x16, 0x01, 0x04,
    ]);
    expect(repo.syncs[0]?.origin.companionPublicKey).toMatch(/^[0-9a-f]{64}$/);
    expect(nodes.getState().origin).toMatchObject({ at: NOW });
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

  it("a failing read on load sets storage error", async () => {
    const { nodes } = setup("connect-ok", open);
    repo.listAll = () => Promise.reject(new Error("corrupt"));
    await nodes.load();
    expect(nodes.getState()).toMatchObject({ storage: "error", nodes: [], loaded: true });
  });

  it("an edit with a repository that cannot open reports STORAGE_ERROR", async () => {
    const { nodes } = setup("connect-ok", () => Promise.reject(new Error("x")));
    expect(await nodes.setRole("k", "chat")).toEqual({ ok: false, reason: "STORAGE_ERROR" });
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

  describe("with a scripted session", () => {
    const report = (n: number): ContactReport => ({
      publicKey: n.toString(16).padStart(64, "0"),
      name: `Node ${n}`,
      type: 2,
      lastHeardAt: null,
      pathHops: null,
      position: null,
    });

    const COMPANION = {
      publicKey: "c".repeat(64),
      name: "companion",
      model: "Heltec V3",
      firmwareVersion: "v1.17.1",
      firmwareVerCode: 13,
      buildDate: "11 Oct 2026",
      position: { lat: 50.06, lon: 19.94 },
    };

    function scripted(outcome: (options?: { signal?: AbortSignal }) => Promise<ContactsResult>) {
      const store = createStore<SessionState>(
        () =>
          ({
            connection: { kind: "connected", companion: COMPANION },
            capabilities: null,
          }) as SessionState,
      );
      let calls = 0;
      const session = {
        store,
        fetchContacts: (options?: { signal?: AbortSignal }) => {
          calls += 1;
          return outcome(options);
        },
      };
      const nodes = new NodesController({
        session,
        repository: open,
        appState: new InMemoryAppState(),
        clock: () => NOW,
      });
      return { nodes, store, calls: () => calls };
    }

    it("a partial sync is stored as incomplete, so no absent node is marked missing", async () => {
      const { nodes } = scripted(async () => ({ contacts: [report(1), report(2)], expected: 3 }));
      await nodes.sync();
      expect(nodes.getState().sync).toEqual({ kind: "partial", at: NOW, received: 2, expected: 3 });
      expect(repo.syncs).toHaveLength(1);
      expect(repo.syncs[0]).toMatchObject({ complete: false, now: NOW });
      expect(repo.syncs[0]?.reports).toHaveLength(2);
    });

    it("stores the companion captured at the start, also when the link drops during the fetch", async () => {
      const dropLink: { store?: StoreApi<SessionState> } = {};
      const handle = scripted(async () => {
        dropLink.store?.setState({ connection: { kind: "disconnected" } });
        return { contacts: [report(1)], expected: 1 };
      });
      dropLink.store = handle.store;
      await handle.nodes.sync();
      expect(repo.syncs[0]?.origin).toEqual({
        companionPublicKey: COMPANION.publicKey,
        position: COMPANION.position,
      });
      expect(handle.nodes.getState().origin).toEqual({
        companionPublicKey: COMPANION.publicKey,
        position: COMPANION.position,
        at: NOW,
      });
    });

    it("a sync while disconnected ends as TRANSPORT_UNAVAILABLE without fetching or storing", async () => {
      const { nodes, store, calls } = scripted(async () => ({ contacts: [], expected: 0 }));
      store.setState({ connection: { kind: "disconnected" } });
      await nodes.sync();
      expect(nodes.getState().sync).toEqual({ kind: "failed", reason: "TRANSPORT_UNAVAILABLE" });
      expect(calls()).toBe(0);
      expect(repo.syncs).toHaveLength(0);
    });

    it("a rejected command ends as UNSUPPORTED", async () => {
      const { nodes } = scripted(() => Promise.reject(new CommandRejectedError(1)));
      await nodes.sync();
      expect(nodes.getState().sync).toEqual({ kind: "failed", reason: "UNSUPPORTED" });
      expect(repo.syncs).toHaveLength(0);
    });

    it("a sync refused because a diagnostic is running ends as BUSY", async () => {
      const { nodes } = scripted(() => Promise.reject(new BusyError("diagnostic")));
      await nodes.sync();
      expect(nodes.getState().sync).toEqual({ kind: "failed", reason: "BUSY" });
    });

    it("an unreadable frame ends as MALFORMED_RESPONSE", async () => {
      const { nodes } = scripted(() => Promise.reject(new MalformedFrameError(3, 1, 10)));
      await nodes.sync();
      expect(nodes.getState().sync).toEqual({ kind: "failed", reason: "MALFORMED_RESPONSE" });
    });

    it("an unknown error is not reported as a lost link", async () => {
      const { nodes } = scripted(() => Promise.reject(new Error("busy")));
      await nodes.sync();
      expect(nodes.getState().sync).toEqual({ kind: "failed", reason: "UNEXPECTED" });
    });

    it("dispose() ends a running sync as idle and unsubscribes", async () => {
      let signal: AbortSignal | undefined;
      const { nodes } = scripted(
        (options) =>
          new Promise((_resolve, reject) => {
            signal = options?.signal;
            signal?.addEventListener("abort", () => reject(new AbortError()));
          }),
      );
      const running = nodes.sync();
      await vi.advanceTimersByTimeAsync(0);
      nodes.dispose();
      await running;
      expect(signal?.aborted).toBe(true);
      expect(nodes.getState().sync).toEqual({ kind: "idle" });
    });

    it("a disposed controller does not sync on the next connection", async () => {
      const { nodes, calls, store } = scripted(async () => ({ contacts: [], expected: 0 }));
      nodes.dispose();
      store.setState({
        connection: { kind: "connected" },
        capabilities: { contacts: { supported: true } },
      } as unknown as Partial<SessionState>);
      await vi.runAllTimersAsync();
      expect(calls()).toBe(0);
    });

    it("dispose() without a running sync does not throw", () => {
      const { nodes } = scripted(async () => ({ contacts: [], expected: 0 }));
      expect(() => nodes.dispose()).not.toThrow();
    });

    it("the controller itself refuses a second sync while one runs", async () => {
      let finish: (result: ContactsResult) => void = () => undefined;
      const { nodes, calls } = scripted(() => new Promise((resolve) => (finish = resolve)));
      const first = nodes.sync();
      await vi.advanceTimersByTimeAsync(0);
      await nodes.sync();
      expect(calls()).toBe(1);
      expect(nodes.getState().sync).toEqual({ kind: "syncing" });
      finish({ contacts: [], expected: 0 });
      await first;
      expect(nodes.getState().sync).toEqual({ kind: "done", at: NOW, total: 0 });
    });
  });
});
