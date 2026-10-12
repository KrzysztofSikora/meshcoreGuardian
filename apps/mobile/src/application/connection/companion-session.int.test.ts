import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AbortError,
  CooldownError,
  FakeTransport,
  HANDSHAKE_FRAMES,
  TransportUnavailableError,
} from "@guardian/meshcore-adapter";

import { SCENARIOS, type ScenarioName } from "../../debug/scenarios";
import { FakeBlePlatform } from "../../platform/fake/fake-ble-platform";
import type { BleLink } from "./ports";
import { InMemoryAppState, InMemoryLastCompanionStore } from "../../platform/fake/in-memory";

import { CompanionSession, type SessionState } from "./companion-session";

const ID = "AA:BB:CC:DD:EE:01";
const KEY = "7c73a8cd01d92e249bf6ed13af3f60499260e408c674ad5e11a44000d87acc28";
const POLICY = { attempts: 1, overrideMs: null };

function setup(name: ScenarioName) {
  const platform = new FakeBlePlatform(SCENARIOS[name]);
  const appState = new InMemoryAppState();
  const store = new InMemoryLastCompanionStore();
  const session = new CompanionSession({ platform, appState, lastCompanionStore: store });
  const kinds: string[] = [];
  session.store.subscribe((state: SessionState) => {
    if (kinds[kinds.length - 1] !== state.connection.kind) kinds.push(state.connection.kind);
  });
  return { platform, appState, store, session, kinds };
}

async function connectOk(name: ScenarioName = "connect-ok") {
  const ctx = setup(name);
  await ctx.session.initialize();
  const done = ctx.session.connect(ID);
  await vi.runAllTimersAsync();
  await done;
  return ctx;
}

describe("CompanionSession", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("scans, lists the device, connects and derives capabilities (FR-01 AC4, FR-03 AC1)", async () => {
    const { session, platform } = setup("connect-ok");
    await session.initialize();
    await session.startScan();
    await vi.advanceTimersByTimeAsync(500);
    expect(session.getState().scan.devices).toEqual([SCENARIOS["connect-ok"].devices[0]]);
    expect(platform.calls.scan).toBe(1);

    const done = session.connect(ID);
    await vi.runAllTimersAsync();
    await done;
    const state = session.getState();
    expect(state.connection.kind).toBe("connected");
    expect(state.scan.status).toBe("done");
    expect(state.capabilities?.contacts).toEqual({ supported: true });
    expect(state.capabilities?.telemetry).toEqual({ supported: true });
    expect(state.firmwareTested).toBe(true);
    expect(state.mtu).toBe(185);
  });

  it("deduplicates devices and stops the scan at 10 s", async () => {
    const { session } = setup("connect-ok");
    await session.initialize();
    await session.startScan();
    expect(session.getState().scan.status).toBe("scanning");
    await vi.advanceTimersByTimeAsync(9_999);
    expect(session.getState().scan.status).toBe("scanning");
    await vi.advanceTimersByTimeAsync(1);
    expect(session.getState().scan.status).toBe("done");
    expect(session.getState().scan.devices).toHaveLength(1);
  });

  it("never scans without permission (FR-01 AC2)", async () => {
    const { session, platform } = setup("permission-denied");
    await session.initialize();
    await session.startScan();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(platform.calls.scan).toBe(0);
    expect(session.getState().permission).toBe("denied");
    expect(session.getState().scan.status).toBe("idle");
  });

  it("reports Bluetooth off instead of an empty finished scan (FR-01 AC3)", async () => {
    const { session, platform } = setup("bluetooth-off");
    await session.initialize();
    await session.startScan();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(session.getState().bluetooth).toBe("off");
    expect(session.getState().scan.status).toBe("idle");
    expect(platform.calls.scan).toBe(0);
  });

  it("connecting with Bluetooth off fails with BLUETOOTH_OFF", async () => {
    const { session, platform } = setup("bluetooth-off");
    await session.initialize();
    await session.connect(ID);
    expect(session.getState().connection).toEqual({ kind: "failed", reason: "BLUETOOTH_OFF" });
    expect(platform.calls.connect).toBe(0);
  });

  it("connect error fails, Retry connects (FR-01 AC5)", async () => {
    const { session, kinds } = setup("connect-fail");
    await session.initialize();
    await session.connect(ID, "MeshCore-companion");
    expect(session.getState().connection).toEqual({ kind: "failed", reason: "CONNECT_ERROR" });
    const done = session.retry();
    await vi.runAllTimersAsync();
    await done;
    expect(session.getState().connection.kind).toBe("connected");
    expect(kinds).toEqual(["disconnected", "connecting", "failed", "connecting", "connected"]);
  });

  it("initialize() on a remounted screen keeps the failed target for Retry (R1)", async () => {
    const { session, platform, store } = setup("connect-fail");
    await store.save({ id: "OTHER:ID", name: "Other" });
    await session.initialize();
    await session.connect(ID, "MeshCore-companion");
    expect(session.getState().connection.kind).toBe("failed");
    await session.initialize();
    const done = session.retry();
    await vi.runAllTimersAsync();
    await done;
    expect(platform.calls.connect).toBe(2);
    expect(session.getState().connection.kind).toBe("connected");
    expect(session.getState().lastCompanion?.id).toBe(ID);
  });

  it("a native scan error ends as failed, not as an empty done list (R2)", async () => {
    const { session, platform } = setup("connect-ok");
    await session.initialize();
    platform.failNextScan();
    await session.startScan();
    await vi.advanceTimersByTimeAsync(500);
    expect(session.getState().scan.status).toBe("failed");
    expect(session.getState().scan.devices).toEqual([]);
    // The 10 s timer must not turn it into "done" afterwards.
    await vi.advanceTimersByTimeAsync(20_000);
    expect(session.getState().scan.status).toBe("failed");
    // A new scan is possible.
    await session.startScan();
    await vi.advanceTimersByTimeAsync(500);
    expect(session.getState().scan.devices).toHaveLength(1);
  });

  it("every state is exactly one of the four kinds", async () => {
    const { kinds } = await connectOk();
    for (const kind of kinds) {
      expect(["disconnected", "connecting", "connected", "failed"]).toContain(kind);
    }
  });

  it("BLE link that never opens fails with CONNECT_TIMEOUT after 15 s", async () => {
    const { session, platform } = setup("connect-ok");
    platform.setScenario({ ...SCENARIOS["connect-ok"], attempts: ["connect-timeout", "ok"] });
    await session.initialize();
    const done = session.connect(ID);
    await vi.advanceTimersByTimeAsync(14_999);
    expect(session.getState().connection.kind).toBe("connecting");
    await vi.advanceTimersByTimeAsync(1);
    await done;
    expect(session.getState().connection).toEqual({ kind: "failed", reason: "CONNECT_TIMEOUT" });
  });

  it("a silent companion fails with HANDSHAKE_NO_RESPONSE", async () => {
    const { session, platform } = setup("connect-ok");
    platform.setScenario({ ...SCENARIOS["connect-ok"], attempts: ["silent"] });
    await session.initialize();
    const done = session.connect(ID);
    await vi.advanceTimersByTimeAsync(30_000);
    await done;
    expect(session.getState().connection).toEqual({
      kind: "failed",
      reason: "HANDSHAKE_NO_RESPONSE",
    });
  });

  it("a drop while connected is Disconnected at once; Reconnect works (FR-02 AC1, AC2)", async () => {
    const { session, platform } = setup("link-drop");
    await session.initialize();
    const done = session.connect(ID, "MeshCore-companion");
    await vi.advanceTimersByTimeAsync(1_000);
    await done;
    expect(session.getState().connection.kind).toBe("connected");
    await vi.advanceTimersByTimeAsync(3_000);
    expect(session.getState().connection).toEqual({ kind: "disconnected" });
    expect(session.getState().linkLostNote).toBe(true);

    const again = session.reconnect();
    await vi.advanceTimersByTimeAsync(200);
    await again;
    expect(session.getState().connection.kind).toBe("connected");
    expect(session.getState().linkLostNote).toBe(false);
    expect(platform.calls.connect).toBe(2);
  });

  it("a drop during the handshake fails with LINK_LOST", async () => {
    const { session, platform } = setup("connect-ok");
    // The recorded reply takes ~100 ms, the drop comes at 20 ms.
    platform.setScenario({ ...SCENARIOS["connect-ok"], attempts: [{ dropAfterMs: 20 }] });
    await session.initialize();
    const done = session.connect(ID);
    await vi.runAllTimersAsync();
    await done;
    expect(session.getState().connection).toEqual({ kind: "failed", reason: "LINK_LOST" });
  });

  it("does not reconnect on its own after a drop (FR-10 AC6)", async () => {
    const { session, platform } = setup("link-drop");
    await session.initialize();
    const done = session.connect(ID);
    await vi.advanceTimersByTimeAsync(3_100);
    await done;
    const connects = platform.calls.connect;
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(platform.calls.connect).toBe(connects);
    expect(session.getState().connection.kind).toBe("disconnected");
  });

  it("starts nothing in the background and aborts a running scan (FR-02 AC3)", async () => {
    const { session, platform, appState } = setup("connect-ok");
    await session.initialize();
    await session.startScan();
    appState.set("background");
    expect(session.getState().scan.status).toBe("done");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(session.getState().scan.devices).toEqual([]);

    await session.startScan();
    await session.connect(ID);
    expect(platform.calls.scan).toBe(1);
    expect(platform.calls.connect).toBe(0);
    expect(session.getState().connection).toEqual({ kind: "disconnected" });
  });

  it("saves the last companion and offers it to reconnect()", async () => {
    const { store, session } = await connectOk();
    expect(await store.load()).toEqual({ id: ID, name: expect.any(String) });
    const fresh = new CompanionSession({
      platform: new FakeBlePlatform(SCENARIOS["connect-ok"]),
      appState: new InMemoryAppState(),
      lastCompanionStore: store,
    });
    await fresh.initialize();
    expect(fresh.getState().lastCompanion?.id).toBe(ID);
    const done = fresh.reconnect();
    await vi.runAllTimersAsync();
    await done;
    expect(fresh.getState().connection.kind).toBe("connected");
    await session.dispose();
    await fresh.dispose();
  });

  it("refuses a second connect while connecting", async () => {
    const { session, platform } = setup("connect-ok");
    await session.initialize();
    const first = session.connect(ID);
    const second = session.connect(ID);
    await vi.runAllTimersAsync();
    await Promise.all([first, second]);
    expect(platform.calls.connect).toBe(1);
    expect(session.getState().connection.kind).toBe("connected");
  });

  it("marks unsupported capabilities and untested firmware (FR-03 AC2, AC3)", async () => {
    const { session } = await connectOk("unsupported-capability");
    const state = session.getState();
    expect(state.connection.kind).toBe("connected");
    expect(state.capabilities?.telemetry).toEqual({
      supported: false,
      reason: "FIRMWARE_TOO_OLD",
      firmwareVersion: "v1.4.0",
    });
    expect(state.capabilities?.contacts).toEqual({ supported: true });
    expect(state.firmwareTested).toBe(false);
  });

  it("disconnect() cancels a running attempt", async () => {
    const { session } = setup("connect-ok");
    await session.initialize();
    const done = session.connect(ID);
    await session.disconnect();
    await vi.runAllTimersAsync();
    await done;
    expect(session.getState().connection).toEqual({ kind: "disconnected" });
  });

  it("reset returns to the first-launch state", async () => {
    const { session } = await connectOk();
    expect(session.getState().connection.kind).toBe("connected");
    await session.reset();
    const state = session.getState();
    expect(state.connection).toEqual({ kind: "disconnected" });
    expect(state.capabilities).toBeNull();
    expect(state.scan).toEqual({ status: "idle", devices: [] });
  });

  it("starts in an unknown, idle state before initialize", () => {
    const { session } = setup("connect-ok");
    expect(session.getState()).toMatchObject({
      permission: "unknown",
      bluetooth: "unknown",
      linkLostNote: false,
      lastCompanion: null,
      connection: { kind: "disconnected" },
    });
  });

  it("requests permission and opens settings through the platform", async () => {
    const { session, platform } = setup("permission-denied");
    await session.initialize();
    await session.requestPermission();
    await session.openSettings();
    expect(platform.calls.requestPermissions).toBe(1);
    expect(platform.calls.openSettings).toBe(1);
    expect(session.getState().permission).toBe("denied");
    platform.setScenario(SCENARIOS["connect-ok"]);
    await session.requestPermission();
    expect(session.getState().permission).toBe("granted");
  });

  it("connecting without permission stays disconnected and never touches the radio", async () => {
    const { session, platform } = setup("permission-denied");
    await session.initialize();
    await session.connect(ID);
    expect(session.getState().connection).toEqual({ kind: "disconnected" });
    expect(platform.calls.connect).toBe(0);
  });

  it("lists a device announced twice only once and does not scan twice", async () => {
    const { session, platform } = setup("connect-ok");
    const device = { id: ID, name: "MeshCore-companion" };
    platform.setScenario({ ...SCENARIOS["connect-ok"], devices: [device, device] });
    await session.initialize();
    await session.startScan();
    await vi.advanceTimersByTimeAsync(500);
    expect(session.getState().scan.devices).toEqual([device]);

    await session.startScan(); // already scanning: no second radio scan
    expect(platform.calls.scan).toBe(1);
  });

  it("an old scan timer does not stop a newer scan", async () => {
    const { session } = setup("connect-ok");
    await session.initialize();
    await session.startScan();
    await vi.advanceTimersByTimeAsync(5_000);
    session.stopScan();
    await session.startScan();
    await vi.advanceTimersByTimeAsync(5_500);
    expect(session.getState().scan.status).toBe("scanning");
    await vi.advanceTimersByTimeAsync(4_500);
    expect(session.getState().scan.status).toBe("done");
  });

  it("keeps the saved companion across a failed save and a failed load", async () => {
    const platform = new FakeBlePlatform(SCENARIOS["connect-ok"]);
    const failing = {
      load: () => Promise.reject(new Error("storage")),
      save: () => Promise.reject(new Error("storage")),
    };
    const session = new CompanionSession({
      platform,
      appState: new InMemoryAppState(),
      lastCompanionStore: failing,
    });
    await session.initialize();
    expect(session.getState().lastCompanion).toBeNull();
    const done = session.connect(ID);
    await vi.runAllTimersAsync();
    await done;
    expect(session.getState().connection.kind).toBe("connected");
    expect(session.getState().lastCompanion).toEqual({ id: ID, name: expect.any(String) });
  });

  it("a deliberate disconnect after a link drop clears the link-lost note", async () => {
    const { session } = setup("link-drop");
    await session.initialize();
    const done = session.connect(ID);
    await vi.advanceTimersByTimeAsync(3_100);
    await done;
    expect(session.getState().linkLostNote).toBe(true);
    await session.disconnect();
    expect(session.getState().linkLostNote).toBe(false);
  });

  describe("with a scripted transport", () => {
    class ScriptedPlatform extends FakeBlePlatform {
      transports: FakeTransport[] = [];
      constructor(private readonly configure: (t: FakeTransport) => FakeTransport) {
        super(SCENARIOS["connect-ok"]);
      }
      override async connect(_id: string, _signal: AbortSignal): Promise<BleLink> {
        this.calls.connect += 1;
        const transport = this.configure(FakeTransport.fromFrames(HANDSHAKE_FRAMES));
        this.transports.push(transport);
        return { transport, mtu: 23 };
      }
    }

    function scripted(configure: (t: FakeTransport) => FakeTransport) {
      const platform = new ScriptedPlatform(configure);
      const session = new CompanionSession({
        platform,
        appState: new InMemoryAppState(),
        lastCompanionStore: new InMemoryLastCompanionStore(),
      });
      return { platform, session };
    }

    it("a malformed handshake reply fails with HANDSHAKE_MALFORMED", async () => {
      const { session } = scripted((t) => t.corrupt(0));
      await session.initialize();
      const done = session.connect(ID);
      await vi.runAllTimersAsync();
      await done;
      expect(session.getState().connection).toEqual({
        kind: "failed",
        reason: "HANDSHAKE_MALFORMED",
      });
    });

    it("dispose stops the scan, cancels the attempt and closes the transport", async () => {
      const { session, platform } = scripted((t) => t);
      await session.initialize();
      const done = session.connect(ID);
      await vi.runAllTimersAsync();
      await done;
      await session.startScan();
      await session.dispose();
      expect(platform.transports[0]?.closed).toBe(true);
      expect(session.getState().scan.status).toBe("done");
    });

    describe("fetchContacts", () => {
      async function connected() {
        const ctx = scripted((t) => t.silence(0x04));
        await ctx.session.initialize();
        const done = ctx.session.connect(ID);
        await vi.runAllTimersAsync();
        await done;
        expect(ctx.session.getState().connection.kind).toBe("connected");
        return ctx;
      }
      const writes = (platform: { transports: FakeTransport[] }) =>
        (platform.transports[0]?.writtenFrames ?? []).filter((f) => f[0] === 0x04).length;

      it("aborting the caller's signal ends the fetch with AbortError and frees the session", async () => {
        const { session, platform } = await connected();
        const controller = new AbortController();
        const first = session.fetchContacts({ signal: controller.signal });
        const settled = expect(first).rejects.toBeInstanceOf(AbortError);
        await vi.advanceTimersByTimeAsync(10);
        controller.abort();
        await settled;
        const second = session.fetchContacts();
        const secondSettled = expect(second).rejects.not.toBeInstanceOf(AbortError);
        await vi.advanceTimersByTimeAsync(0);
        expect(writes(platform)).toBe(2);
        await vi.runAllTimersAsync();
        await secondSettled;
      });

      it("a finished fetch detaches the caller's listener", async () => {
        const { session } = await connected();
        const controller = new AbortController();
        const removed = vi.spyOn(controller.signal, "removeEventListener");
        const settled = expect(
          session.fetchContacts({ signal: controller.signal }),
        ).rejects.toBeDefined();
        await vi.runAllTimersAsync();
        await settled;
        expect(removed).toHaveBeenCalledWith("abort", expect.any(Function));
      });

      it("an already aborted signal rejects without a write", async () => {
        const { session, platform } = await connected();
        const controller = new AbortController();
        controller.abort();
        await expect(session.fetchContacts({ signal: controller.signal })).rejects.toBeInstanceOf(
          AbortError,
        );
        expect(writes(platform)).toBe(0);
      });

      it("dispose() during a fetch ends it with AbortError", async () => {
        const { session } = await connected();
        const running = session.fetchContacts();
        const settled = expect(running).rejects.toBeInstanceOf(AbortError);
        await vi.advanceTimersByTimeAsync(10);
        await session.dispose();
        await settled;
      });

      it("disconnect() during a fetch ends it with AbortError", async () => {
        const { session } = await connected();
        const running = session.fetchContacts();
        const settled = expect(running).rejects.toBeInstanceOf(AbortError);
        await vi.advanceTimersByTimeAsync(10);
        await session.disconnect();
        await settled;
      });

      it("rejects with TransportUnavailableError while connecting", async () => {
        const { session } = scripted((t) => t);
        await session.initialize();
        const done = session.connect(ID);
        await vi.advanceTimersByTimeAsync(20);
        expect(session.getState().connection.kind).toBe("connecting");
        await expect(session.fetchContacts()).rejects.toBeInstanceOf(TransportUnavailableError);
        await vi.runAllTimersAsync();
        await done;
      });
    });

    it("dispose unsubscribes from app state", async () => {
      const appState = new InMemoryAppState();
      const platform = new FakeBlePlatform(SCENARIOS["connect-ok"]);
      const session = new CompanionSession({
        platform,
        appState,
        lastCompanionStore: new InMemoryLastCompanionStore(),
      });
      await session.initialize();
      await session.startScan();
      await session.dispose();
      await session.startScan();
      expect(session.getState().scan.status).toBe("scanning");
      appState.set("background");
      expect(session.getState().scan.status).toBe("scanning");
    });
  });

  it("fetchContacts rejects with TransportUnavailableError when not connected", async () => {
    const { session } = setup("connect-ok");
    await session.initialize();
    await expect(session.fetchContacts()).rejects.toBeInstanceOf(TransportUnavailableError);
  });

  it("runChecks rejects with TransportUnavailableError when not connected", async () => {
    const { session } = setup("connect-ok");
    await session.initialize();
    await expect(
      session.runChecks({ publicKey: KEY, checks: ["login"], password: "", policy: POLICY }),
    ).rejects.toBeInstanceOf(TransportUnavailableError);
  });

  describe("runChecks", () => {
    it("a user disconnect ends the run as cancelled, with no further write", async () => {
      const { session } = await connectOk();
      const running = session.runChecks({
        publicKey: KEY,
        checks: ["login", "status"],
        password: "",
        policy: POLICY,
      });
      await vi.advanceTimersByTimeAsync(100);
      await session.disconnect();
      await vi.runAllTimersAsync();
      const outcomes = await running;
      expect(outcomes).toHaveLength(1);
      expect(outcomes[0]).toMatchObject({ result: "NOT_TESTED", reason: "CANCELLED" });
    });

    it("the cooldown survives a reconnect (FR-10 AC2)", async () => {
      const { session } = await connectOk();
      const first = session.runChecks({
        publicKey: KEY,
        checks: ["login"],
        password: "",
        policy: POLICY,
      });
      await vi.runAllTimersAsync();
      await first;
      await session.disconnect();
      const done = session.connect(ID);
      await vi.runAllTimersAsync();
      await done;
      await expect(
        session.runChecks({ publicKey: KEY, checks: ["login"], password: "", policy: POLICY }),
      ).rejects.toBeInstanceOf(CooldownError);
    });
  });
});
