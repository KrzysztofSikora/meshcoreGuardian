import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AbortError,
  type AbortSignalLike,
  CommandRejectedError,
  ContactsTimeoutError,
  FakeTransport,
  HANDSHAKE_FRAMES,
  MalformedFrameError,
  MeshClient,
  type MeshTransport,
  TransportUnavailableError,
  CONTACTS_FRAMES,
  type ContactsResult,
} from "../src";

import { contactFrame, frame, sequence } from "./support/frames";

// Vite resolves this at transform time; the adapter compiles without Node or Vite client types.
declare global {
  interface ImportMeta {
    glob(
      pattern: string,
      options: { eager: true; query: "?raw"; import: "default" },
    ): Record<string, string>;
  }
}

const files = import.meta.glob("../fixtures/v1.17.1-d929643/*.json", {
  eager: true,
  query: "?raw",
  import: "default",
});
const fixtures = Object.entries(files).map(([path, raw]) => ({
  name: path.split("/").pop() ?? path,
  frames: (JSON.parse(raw) as { frames: { dir: "tx" | "rx"; tMs: number; hex: string }[] }).frames,
}));

const GET_CONTACTS = 0x04;

function abortable() {
  const listeners = new Set<() => void>();
  const signal: AbortSignalLike & { aborted: boolean } = {
    aborted: false,
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener),
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

/** A minimal port double: the test decides which frame arrives when. */
function scriptedTransport() {
  const frameListeners = new Set<(frame: Uint8Array) => void>();
  const disconnectListeners = new Set<() => void>();
  const written: Uint8Array[] = [];
  const transport: MeshTransport = {
    write: async (bytes) => void written.push(bytes),
    close: async () => undefined,
    onFrame: (callback) => {
      frameListeners.add(callback);
      return () => frameListeners.delete(callback);
    },
    onDisconnect: (callback) => {
      disconnectListeners.add(callback);
      return () => disconnectListeners.delete(callback);
    },
  };
  return {
    transport,
    written,
    emit(bytes: Uint8Array) {
      for (const listener of [...frameListeners]) listener(bytes);
    },
    drop() {
      for (const listener of [...disconnectListeners]) listener();
    },
  };
}

const startFrame = (count: number) => frame(2).u32(count).build();
const endFrame = frame(4).u32(0).build();
const contact = (n: number) => contactFrame({ name: `Repeater ${n}`, path: sequence(n & 0xff, 4) });

/** Starts a sync and keeps the outcome observable without unhandled rejections. */
function run(client: MeshClient, signal?: AbortSignalLike) {
  return client.getContacts(signal === undefined ? {} : { signal }).then(
    (value) => ({ value }) as const,
    (error: unknown) => ({ error }) as const,
  );
}

describe("MeshClient.getContacts", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  describe.each(fixtures)("on the recorded $name", ({ frames }) => {
    it("returns all 350 contacts after the handshake, writing exactly [0x04]", async () => {
      const transport = FakeTransport.fromFrames(frames);
      const client = new MeshClient(transport);
      const handshake = client.handshake();
      await vi.advanceTimersByTimeAsync(300);
      await handshake;

      const outcome = run(client);
      await vi.advanceTimersByTimeAsync(40_000);
      const result = await outcome;
      if (!("value" in result)) throw result.error;

      expect(result.value.expected).toBe(350);
      expect(result.value.contacts).toHaveLength(350);
      const types = new Map<number, number>();
      for (const { type } of result.value.contacts) types.set(type, (types.get(type) ?? 0) + 1);
      expect(Object.fromEntries(types)).toEqual({ 1: 30, 2: 306, 3: 14 });
      for (const { publicKey, lastHeardAt } of result.value.contacts) {
        expect(publicKey).toMatch(/^[0-9a-f]{64}$/);
        expect(lastHeardAt === null || lastHeardAt > 0).toBe(true);
      }
      expect(transport.writtenFrames.at(-1)).toEqual(Uint8Array.of(GET_CONTACTS));
    });
  });

  it("survives the recorded 4.9 s gap between two contact frames", async () => {
    const recorded = fixtures.find((f) => f.name === "handshake.json")!.frames;
    const client = new MeshClient(FakeTransport.fromFrames(recorded));
    const handshake = client.handshake();
    await vi.advanceTimersByTimeAsync(300);
    await handshake;
    const outcome = run(client);
    await vi.advanceTimersByTimeAsync(40_000);
    expect("value" in (await outcome)).toBe(true);
  });

  it("maps a contact to a report with its name, type and last heard time", async () => {
    const t = scriptedTransport();
    const outcome = run(new MeshClient(t.transport));
    t.emit(startFrame(1));
    t.emit(contact(1));
    t.emit(endFrame);
    const result = await outcome;
    if (!("value" in result)) throw result.error;
    expect(result.value.contacts).toEqual([
      {
        publicKey: expect.stringMatching(/^[0-9a-f]{64}$/) as string,
        name: "Repeater 1",
        type: 2,
        lastHeardAt: 1_760_000_100_000,
        pathHops: 2,
        position: { lat: 52.229675, lon: -21.012228 },
      },
    ]);
    expect(t.written).toEqual([Uint8Array.of(GET_CONTACTS)]);
  });

  it("reads the hop count from the low six bits for hash sizes 1 and 2, and 0 as direct", async () => {
    const t = scriptedTransport();
    const outcome = run(new MeshClient(t.transport));
    t.emit(startFrame(3));
    t.emit(contactFrame({ pathLen: 0x03 })); // hash size 1, 3 hops
    t.emit(contactFrame({ pathLen: 0x45 })); // hash size 2, 5 hops
    t.emit(contactFrame({ pathLen: 0x00 })); // direct
    t.emit(endFrame);
    const result = await outcome;
    if (!("value" in result)) throw result.error;
    expect(result.value.contacts.map((c) => c.pathHops)).toEqual([3, 5, 0]);
  });

  it("reports an unknown path (0xFF) and a 0,0 position as null", async () => {
    const t = scriptedTransport();
    const outcome = run(new MeshClient(t.transport));
    t.emit(startFrame(1));
    t.emit(contactFrame({ pathLen: 0xff, latE6: 0, lonE6: 0 }));
    t.emit(endFrame);
    const result = await outcome;
    if (!("value" in result)) throw result.error;
    expect(result.value.contacts[0]).toMatchObject({ pathHops: null, position: null });
  });

  it("reports an out-of-range position as null instead of failing", async () => {
    const t = scriptedTransport();
    const outcome = run(new MeshClient(t.transport));
    t.emit(startFrame(1));
    t.emit(contactFrame({ latE6: 91_000_000, lonE6: 10_000_000 }));
    t.emit(endFrame);
    const result = await outcome;
    if (!("value" in result)) throw result.error;
    expect(result.value.contacts[0]?.position).toBeNull();
  });

  it("reports fewer contacts than announced and leaves the comparison to the caller", async () => {
    const t = scriptedTransport();
    const outcome = run(new MeshClient(t.transport));
    t.emit(startFrame(3));
    t.emit(contact(1));
    t.emit(endFrame);
    const result = await outcome;
    if (!("value" in result)) throw result.error;
    expect(result.value.expected).toBe(3);
    expect(result.value.contacts).toHaveLength(1);
  });

  it("ignores frames of other kinds, including before contactsStart", async () => {
    const t = scriptedTransport();
    const outcome = run(new MeshClient(t.transport));
    t.emit(contact(9)); // before contactsStart: not ours
    t.emit(endFrame); // before contactsStart: not ours
    t.emit(startFrame(1));
    t.emit(frame(0x88).u8(1).build()); // rx log push
    t.emit(frame(0x80).build()); // advert push
    t.emit(contact(1));
    t.emit(endFrame);
    const result = await outcome;
    if (!("value" in result)) throw result.error;
    expect(result.value.contacts.map((c) => c.name)).toEqual(["Repeater 1"]);
  });

  it("times out at 5 s without contactsStart", async () => {
    const t = scriptedTransport();
    const outcome = run(new MeshClient(t.transport));
    await vi.advanceTimersByTimeAsync(4_999);
    t.emit(frame(0x88).build()); // other frames do not extend the wait
    let settled = false;
    void outcome.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const result = await outcome;
    expect(result).toEqual({ error: expect.any(ContactsTimeoutError) as unknown });
    expect(result).toMatchObject({ error: { stage: "start", received: 0, expected: null } });
  });

  it("times out when a contact frame does not follow within 15 s", async () => {
    const t = scriptedTransport();
    const outcome = run(new MeshClient(t.transport));
    t.emit(startFrame(2));
    await vi.advanceTimersByTimeAsync(10_000);
    t.emit(contact(1));
    await vi.advanceTimersByTimeAsync(14_999);
    let settled = false;
    void outcome.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await outcome).toMatchObject({
      error: { name: "ContactsTimeoutError", stage: "idle", received: 1, expected: 2 },
    });
  });

  it("does not let ignored frames reset the idle bound", async () => {
    const t = scriptedTransport();
    const outcome = run(new MeshClient(t.transport));
    t.emit(startFrame(2));
    for (let i = 0; i < 4; i += 1) {
      await vi.advanceTimersByTimeAsync(4_000);
      t.emit(frame(0x88).build());
    }
    expect(await outcome).toMatchObject({ error: { stage: "idle", received: 0 } });
  });

  it("stops at 120 s even when a frame arrives every 4 s", async () => {
    const t = scriptedTransport();
    const outcome = run(new MeshClient(t.transport));
    t.emit(startFrame(1000));
    for (let n = 0; n < 40; n += 1) {
      await vi.advanceTimersByTimeAsync(4_000);
      t.emit(contact(n));
    }
    expect(await outcome).toMatchObject({
      error: { name: "ContactsTimeoutError", stage: "total", received: 29, expected: 1000 },
    });
  });

  it("fails with MalformedFrameError on a truncated contact frame", async () => {
    const recorded = fixtures.find((f) => f.name === "handshake.json")!.frames;
    const transport = FakeTransport.fromFrames(recorded).corrupt(9);
    const client = new MeshClient(transport);
    const handshake = client.handshake();
    await vi.advanceTimersByTimeAsync(300);
    await handshake;
    const outcome = run(client);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await outcome).toEqual({ error: expect.any(MalformedFrameError) as unknown });
  });

  it("fails with CommandRejectedError on an error frame", async () => {
    const t = scriptedTransport();
    const outcome = run(new MeshClient(t.transport));
    t.emit(frame(1).u8(2).build());
    const result = await outcome;
    expect(result).toEqual({ error: expect.any(CommandRejectedError) as unknown });
    expect(result).toMatchObject({ error: { code: 2 } });
  });

  it("fails with TransportUnavailableError in the same tick when the link drops mid-sync", async () => {
    const t = scriptedTransport();
    const outcome = run(new MeshClient(t.transport));
    t.emit(startFrame(5));
    t.emit(contact(1));
    t.drop();
    expect(await outcome).toEqual({ error: expect.any(TransportUnavailableError) as unknown });
  });

  it("fails with TransportUnavailableError when the fake drops after the write", async () => {
    const transport = FakeTransport.fromFrames(CONTACTS_FRAMES).dropAfterWrites(1);
    const outcome = run(new MeshClient(transport));
    expect(await outcome).toEqual({ error: expect.any(TransportUnavailableError) as unknown });
  });

  it("fails when the write fails", async () => {
    const t = scriptedTransport();
    t.transport.write = async () => {
      throw new Error("gatt");
    };
    const outcome = run(new MeshClient(t.transport));
    expect(await outcome).toEqual({ error: expect.any(TransportUnavailableError) as unknown });
  });

  it("refuses a closed client", async () => {
    const t = scriptedTransport();
    const client = new MeshClient(t.transport);
    await client.close();
    expect(await run(client)).toEqual({ error: expect.any(TransportUnavailableError) as unknown });
    expect(t.written).toHaveLength(0);
  });

  it("aborts with AbortError, removes its listener and ignores later frames", async () => {
    const t = scriptedTransport();
    const abort = abortable();
    const outcome = run(new MeshClient(t.transport), abort.signal);
    t.emit(startFrame(2));
    t.emit(contact(1));
    abort.abort();
    expect(await outcome).toEqual({ error: expect.any(AbortError) as unknown });
    expect(abort.listenerCount()).toBe(0);
    t.emit(contact(2));
    t.emit(endFrame);
    await vi.advanceTimersByTimeAsync(200_000); // timers were cleared: nothing else happens
  });

  it("does not write when the signal is already aborted", async () => {
    const t = scriptedTransport();
    const abort = abortable();
    abort.abort();
    expect(await run(new MeshClient(t.transport), abort.signal)).toEqual({
      error: expect.any(AbortError) as unknown,
    });
    expect(t.written).toHaveLength(0);
  });

  it("refuses a second call while one runs, and the first still finishes", async () => {
    const t = scriptedTransport();
    const client = new MeshClient(t.transport);
    const first = run(client);
    expect(await run(client)).toMatchObject({ error: { message: "busy" } });
    t.emit(startFrame(0));
    t.emit(endFrame);
    expect("value" in (await first)).toBe(true);
    expect(t.written).toHaveLength(1);
  });

  it("can run again after a failure", async () => {
    const t = scriptedTransport();
    const client = new MeshClient(t.transport);
    const first = run(client);
    await vi.advanceTimersByTimeAsync(5_000);
    expect("error" in (await first)).toBe(true);
    const second = run(client);
    t.emit(startFrame(0));
    t.emit(endFrame);
    expect("value" in (await second)).toBe(true);
  });

  it.each([10_000, 100_000])(
    "a sync finished %i ms ago leaves no timer behind that fails the next one",
    async (gapMs) => {
      const t = scriptedTransport();
      const client = new MeshClient(t.transport);
      const first = run(client);
      t.emit(startFrame(0));
      t.emit(endFrame);
      expect("value" in (await first)).toBe(true);
      await vi.advanceTimersByTimeAsync(gapMs);
      // The first sync's idle (15 s) and total (120 s) bounds pass while the second one runs.
      const second = run(client);
      t.emit(startFrame(8));
      for (let n = 0; n < 8; n += 1) {
        await vi.advanceTimersByTimeAsync(5_000);
        t.emit(contact(n));
      }
      t.emit(endFrame);
      const result = await second;
      expect("value" in result && result.value.contacts).toHaveLength(8);
    },
  );

  it("a finished sync stops handling frames: a later frame does not resolve anything twice", async () => {
    const t = scriptedTransport();
    const client = new MeshClient(t.transport);
    const first = run(client);
    t.emit(startFrame(1));
    t.emit(contact(1));
    t.emit(endFrame);
    const result = await first;
    expect("value" in result && result.value.contacts).toHaveLength(1);
    t.emit(contact(2)); // no pending request: dropped
    expect("value" in result && result.value.contacts).toHaveLength(1);
    const second = run(client);
    t.emit(startFrame(0));
    t.emit(endFrame);
    const next = await second;
    expect("value" in next && next.value.contacts).toHaveLength(0);
  });

  it("leaves the handshake working after a sync", async () => {
    const frames = [...HANDSHAKE_FRAMES.slice(0, 2), ...CONTACTS_FRAMES];
    const transport = FakeTransport.fromFrames([
      ...frames,
      ...HANDSHAKE_FRAMES.slice(2).map((f) => ({ ...f, tMs: f.tMs + 10_000 })),
    ]);
    const client = new MeshClient(transport);
    const sync = run(client);
    await vi.advanceTimersByTimeAsync(3_000);
    const result: { value: ContactsResult } | { error: unknown } = await sync;
    expect("value" in result && result.value.contacts.length).toBe(31);
    const handshake = client.handshake();
    await vi.advanceTimersByTimeAsync(10_500);
    expect((await handshake).name).toBe("companion");
  });
});
