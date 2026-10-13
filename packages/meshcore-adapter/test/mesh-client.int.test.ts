import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AbortError,
  type AbortSignalLike,
  FakeTransport,
  HANDSHAKE_FRAMES,
  HandshakeTimeoutError,
  MalformedFrameError,
  MeshClient,
  type MeshTransport,
  TransportUnavailableError,
} from "../src";

import { deviceInfoFrame, selfInfoFrame } from "./support/frames";

const DEVICE_QUERY = 0x16;
const APP_START = 0x01;

/** A minimal abortable signal (the adapter has no DOM or Node types). */
function abortable(aborted = false) {
  const listeners = new Set<() => void>();
  const signal: AbortSignalLike & { aborted: boolean } = {
    aborted,
    addEventListener: (type, listener) => {
      if (type === "abort") listeners.add(listener);
    },
    removeEventListener: (type, listener) => {
      if (type === "abort") listeners.delete(listener);
    },
  };
  return {
    signal,
    listenerCount: () => listeners.size,
    abort() {
      signal.aborted = true;
      for (const listener of [...listeners]) listener();
    },
  };
}

describe("MeshClient.handshake", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup(configure: (t: FakeTransport) => FakeTransport = (t) => t) {
    const transport = configure(FakeTransport.fromFrames(HANDSHAKE_FRAMES));
    return { transport, client: new MeshClient(transport) };
  }

  /** Starts the handshake and keeps the outcome observable without unhandled rejections. */
  function run(client: MeshClient, signal?: AbortSignalLike) {
    const outcome = client.handshake(signal === undefined ? {} : { signal }).then(
      (value) => ({ value }) as const,
      (error: unknown) => ({ error }) as const,
    );
    return outcome;
  }

  it("returns the companion identity and writes device query then app start", async () => {
    const { transport, client } = setup();
    const outcome = run(client);
    await vi.advanceTimersByTimeAsync(500);
    const result = await outcome;
    if (!("value" in result)) throw result.error;
    expect(result.value).toMatchObject({
      firmwareVersion: "v1.17.1-d929643",
      firmwareVerCode: 13,
      model: "Heltec V3",
      name: "companion",
    });
    expect(result.value.publicKey).toMatch(/^[0-9a-f]{64}$/);
    expect(transport.writtenFrames.map((f) => f[0])).toEqual([DEVICE_QUERY, APP_START]);
  });

  it("reports the companion position from self info, and null for 0,0", async () => {
    for (const [lat, lon, expected] of [
      [52_229_675, 21_012_228, { lat: 52.229675, lon: 21.012228 }],
      [0, 0, null],
    ] as const) {
      const listeners = new Set<(frame: Uint8Array) => void>();
      const transport: MeshTransport = {
        write: async (bytes) => {
          const reply = bytes[0] === DEVICE_QUERY ? deviceInfoFrame() : selfInfoFrame("Base", lat, lon);
          for (const listener of [...listeners]) listener(reply);
        },
        close: async () => undefined,
        onFrame: (callback) => {
          listeners.add(callback);
          return () => listeners.delete(callback);
        },
        onDisconnect: () => () => undefined,
      };
      const info = await new MeshClient(transport).handshake();
      expect(info.position).toEqual(expected);
    }
  });

  it("times out the device query at 30 s and not before", async () => {
    const { client } = setup((t) => t.silence(DEVICE_QUERY));
    const outcome = run(client);
    await vi.advanceTimersByTimeAsync(29_999);
    let settled = false;
    void outcome.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const result = await outcome;
    expect(result).toMatchObject({ error: expect.any(HandshakeTimeoutError) });
    expect((result as { error: HandshakeTimeoutError }).error.step).toBe("deviceQuery");
  });

  it("times out app start at 5 s", async () => {
    const { client } = setup((t) => t.silence(APP_START));
    const outcome = run(client);
    await vi.advanceTimersByTimeAsync(95 + 4_999);
    let settled = false;
    void outcome.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const result = await outcome;
    expect((result as { error: HandshakeTimeoutError }).error).toMatchObject({
      name: "HandshakeTimeoutError",
      step: "appStart",
    });
  });

  it("passes a malformed device info through", async () => {
    const { client } = setup((t) => t.corrupt(0));
    const outcome = run(client);
    await vi.advanceTimersByTimeAsync(500);
    expect(await outcome).toMatchObject({ error: expect.any(MalformedFrameError) });
  });

  it("fails with TransportUnavailableError in the tick of the drop, and never resolves late", async () => {
    const { client } = setup((t) => t.dropAfterWrites(1));
    const outcome = run(client);
    await vi.advanceTimersByTimeAsync(0);
    expect(await outcome).toMatchObject({ error: expect.any(TransportUnavailableError) });
    await vi.advanceTimersByTimeAsync(60_000);
  });

  it("reports a drop to onDisconnect listeners and ends a waiting handshake", async () => {
    const { transport, client } = setup((t) => t.silence(DEVICE_QUERY));
    const onDisconnect = vi.fn();
    client.onDisconnect(onDisconnect);
    const outcome = run(client);
    await vi.advanceTimersByTimeAsync(1_000);
    transport.drop();
    expect(onDisconnect).toHaveBeenCalledTimes(1);
    expect(await outcome).toMatchObject({ error: expect.any(TransportUnavailableError) });
  });

  it("rejects with AbortError and writes nothing when the signal is already aborted", async () => {
    const { transport, client } = setup();
    const controller = abortable(true);
    expect(await run(client, controller.signal)).toMatchObject({ error: expect.any(AbortError) });
    expect(transport.writtenFrames).toEqual([]);
  });

  it("rejects with AbortError when aborted while waiting, and writes no further frame", async () => {
    const { transport, client } = setup((t) => t.silence(DEVICE_QUERY));
    const controller = abortable();
    const outcome = run(client, controller.signal);
    await vi.advanceTimersByTimeAsync(1_000);
    controller.abort();
    expect(await outcome).toMatchObject({ error: expect.any(AbortError) });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(transport.writtenFrames).toHaveLength(1);
  });

  it("refuses a concurrent handshake", async () => {
    const { client } = setup();
    const first = run(client);
    await expect(client.handshake()).rejects.toThrow("busy");
    await vi.advanceTimersByTimeAsync(500);
    expect(await first).toHaveProperty("value");
  });

  it("fails fast after close", async () => {
    const { transport, client } = setup();
    await client.close();
    expect(transport.closed).toBe(true);
    await expect(client.handshake()).rejects.toBeInstanceOf(TransportUnavailableError);
    expect(transport.writtenFrames).toEqual([]);
  });

  it("close ends a waiting handshake and later accepts a new one", async () => {
    const { client } = setup((t) => t.silence(DEVICE_QUERY));
    const outcome = run(client);
    await vi.advanceTimersByTimeAsync(1_000);
    await client.close();
    expect(await outcome).toMatchObject({
      error: expect.objectContaining({
        name: "TransportUnavailableError",
        message: "Client closed",
      }),
    });
    // The failed handshake released the single-flight guard.
    await expect(client.handshake()).rejects.toBeInstanceOf(TransportUnavailableError);
  });

  it("onDisconnect listeners can unsubscribe and are not called after close", async () => {
    const { transport, client } = setup();
    const kept = vi.fn();
    const removed = vi.fn();
    client.onDisconnect(kept);
    client.onDisconnect(removed)();
    transport.drop();
    expect(kept).toHaveBeenCalledTimes(1);
    expect(removed).not.toHaveBeenCalled();
    const afterClose = vi.fn();
    client.onDisconnect(afterClose);
    await client.close();
    expect(afterClose).not.toHaveBeenCalled();
  });

  it("releases the abort listener and the single-flight guard after a handshake", async () => {
    const { client } = setup();
    const controller = abortable();
    const outcome = run(client, controller.signal);
    await vi.advanceTimersByTimeAsync(500);
    expect(await outcome).toHaveProperty("value");
    expect(controller.listenerCount()).toBe(0);
    // Not "busy": a finished handshake allows the next call (here it stops at the aborted signal).
    expect(await run(client, abortable(true).signal)).toMatchObject({
      error: expect.any(AbortError),
    });
  });
});

/** A hand-written port double: it can fail writes and push any frame, which FakeTransport cannot. */
class StubTransport implements MeshTransport {
  frameListeners = new Set<(frame: Uint8Array) => void>();
  writes: Uint8Array[] = [];
  constructor(private readonly onWrite: (frame: Uint8Array, t: StubTransport) => Promise<void>) {}
  write(frame: Uint8Array): Promise<void> {
    this.writes.push(frame);
    return this.onWrite(frame, this);
  }
  push(frame: Uint8Array): void {
    for (const listener of [...this.frameListeners]) listener(frame);
  }
  onFrame(callback: (frame: Uint8Array) => void) {
    this.frameListeners.add(callback);
    return () => void this.frameListeners.delete(callback);
  }
  disconnectListeners = new Set<() => void>();
  onDisconnect(callback: () => void) {
    this.disconnectListeners.add(callback);
    return () => void this.disconnectListeners.delete(callback);
  }
  async close(): Promise<void> {}
}

describe("MeshClient with a hand-written transport (R3)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const settle = <T>(promise: Promise<T>) =>
    promise.then(
      (value) => ({ value }) as const,
      (error: unknown) => ({ error }) as const,
    );

  it("a plain Error from write fails at once with TransportUnavailableError, not after 30 s", async () => {
    const transport = new StubTransport(() => Promise.reject(new Error("GATT write failed")));
    const client = new MeshClient(transport);
    const outcome = settle(client.handshake());
    await vi.advanceTimersByTimeAsync(0);
    expect(await outcome).toMatchObject({ error: expect.any(TransportUnavailableError) });
  });

  it("ignores frames of another kind and malformed frames without a waiting step", async () => {
    const replies = HANDSHAKE_FRAMES.filter((f) => f.dir === "rx").map((f) => hex(f.hex));
    const [deviceInfo, selfInfo] = replies;
    const okFrame = Uint8Array.of(0x00);
    const transport = new StubTransport(async (frame, t) => {
      if (frame[0] === DEVICE_QUERY) {
        t.push(okFrame); // not the awaited kind: ignored
        t.push(deviceInfo!);
      } else if (frame[0] === APP_START) t.push(selfInfo!);
    });
    const client = new MeshClient(transport);
    const outcome = settle(client.handshake());
    await vi.advanceTimersByTimeAsync(0);
    const result = await outcome;
    expect(result).toHaveProperty("value");
    // Nothing is waiting any more: a stray frame, even a broken one, is dropped silently.
    expect(() => transport.push(selfInfo!)).not.toThrow();
    expect(() => transport.push(Uint8Array.of(0x05))).not.toThrow();
  });

  it("a malformed frame during a step fails with MalformedFrameError", async () => {
    const transport = new StubTransport(async (_frame, t) => {
      t.push(Uint8Array.of(0x0d)); // device info marker, truncated
    });
    const client = new MeshClient(transport);
    const outcome = settle(client.handshake());
    await vi.advanceTimersByTimeAsync(0);
    expect(await outcome).toMatchObject({ error: expect.any(MalformedFrameError) });
  });

  it("a finished step's timer does not fail the next step (R5)", async () => {
    const [deviceInfo, selfInfo] = handshakeReplies();
    const transport = new StubTransport(async (frame, t) => {
      if (frame[0] === DEVICE_QUERY) t.push(deviceInfo!);
      else if (frame[0] === APP_START) setTimeout(() => t.push(selfInfo!), 500);
    });
    const client = new MeshClient(transport, {
      deviceQueryTimeoutMs: 100,
      appStartTimeoutMs: 1000,
    });
    const outcome = settle(client.handshake());
    await vi.advanceTimersByTimeAsync(600);
    expect(await outcome).toHaveProperty("value");
  });

  it("an aborted step leaves no timer that fails a later handshake (R5)", async () => {
    const [deviceInfo, selfInfo] = handshakeReplies();
    let replyLate = false;
    const transport = new StubTransport(async (frame, t) => {
      if (frame[0] === DEVICE_QUERY && replyLate) setTimeout(() => t.push(deviceInfo!), 70);
      else if (frame[0] === APP_START) t.push(selfInfo!);
    });
    const client = new MeshClient(transport, {
      deviceQueryTimeoutMs: 100,
      appStartTimeoutMs: 1000,
    });
    const controller = abortable();
    const first = settle(client.handshake({ signal: controller.signal }));
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    expect(await first).toMatchObject({ error: expect.any(AbortError) });
    await vi.advanceTimersByTimeAsync(50);
    replyLate = true;
    const second = settle(client.handshake());
    // The aborted step's timer would fire at 100 ms; the new step's reply arrives at 120 ms.
    await vi.advanceTimersByTimeAsync(90);
    expect(await second).toHaveProperty("value");
  });

  it("after close() nothing reaches the client and a handshake is refused (R5)", async () => {
    const transport = new StubTransport(async () => undefined);
    const client = new MeshClient(transport);
    const onDisconnect = vi.fn();
    client.onDisconnect(onDisconnect);
    await client.close();
    expect(transport.frameListeners.size).toBe(0);
    expect(transport.disconnectListeners.size).toBe(0);
    await expect(client.handshake()).rejects.toBeInstanceOf(TransportUnavailableError);
    expect(transport.writes).toHaveLength(0);
    expect(onDisconnect).not.toHaveBeenCalled();
  });
});

function handshakeReplies(): Uint8Array[] {
  return HANDSHAKE_FRAMES.filter((f) => f.dir === "rx").map((f) => hex(f.hex));
}

function hex(value: string): Uint8Array {
  return Uint8Array.from(value.match(/../g) ?? [], (byte) => parseInt(byte, 16));
}
