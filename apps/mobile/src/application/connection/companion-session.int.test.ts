import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SCENARIOS, type ScenarioName } from "../../debug/scenarios";
import { FakeBlePlatform } from "../../platform/fake/fake-ble-platform";
import { InMemoryAppState, InMemoryLastCompanionStore } from "../../platform/fake/in-memory";

import { CompanionSession, type SessionState } from "./companion-session";

const ID = "AA:BB:CC:DD:EE:01";

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
});
