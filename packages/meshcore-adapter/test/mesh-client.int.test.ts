import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AbortError,
  type AbortSignalLike,
  FakeTransport,
  HANDSHAKE_FRAMES,
  HandshakeTimeoutError,
  MalformedFrameError,
  MeshClient,
  TransportUnavailableError,
} from "../src";

const DEVICE_QUERY = 0x16;
const APP_START = 0x01;

/** A minimal abortable signal (the adapter has no DOM or Node types). */
function abortable(aborted = false) {
  const listeners = new Set<() => void>();
  const signal: AbortSignalLike & { aborted: boolean } = {
    aborted,
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener),
  };
  return {
    signal,
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
  });
});
