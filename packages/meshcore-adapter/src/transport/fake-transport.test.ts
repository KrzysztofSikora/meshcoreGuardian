import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FakeTransport, type ScriptFrame } from "./fake-transport";

const SCRIPT: ScriptFrame[] = [
  { dir: "tx", tMs: 1, hex: "1603" },
  { dir: "rx", tMs: 101, hex: "0d01" },
  { dir: "rx", tMs: 151, hex: "0d02" },
  { dir: "tx", tMs: 200, hex: "0101" },
  { dir: "rx", tMs: 300, hex: "0503" },
];

const bytes = (...values: number[]) => Uint8Array.from(values);

describe("FakeTransport", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function record(transport: FakeTransport) {
    const received: { at: number; frame: number[] }[] = [];
    const start = Date.now();
    transport.onFrame((frame) => received.push({ at: Date.now() - start, frame: [...frame] }));
    return received;
  }

  it("releases the replies after the matching write, each after its recorded gap", async () => {
    const transport = FakeTransport.fromFrames(SCRIPT);
    const received = record(transport);
    await transport.write(bytes(0x16, 3));
    await vi.advanceTimersByTimeAsync(200);
    expect(received).toEqual([
      { at: 100, frame: [0x0d, 1] },
      { at: 150, frame: [0x0d, 2] },
    ]);
    await transport.write(bytes(0x01, 1, 0));
    await vi.advanceTimersByTimeAsync(100);
    expect(received.at(-1)).toEqual({ at: 200 + 100, frame: [5, 3] });
  });

  it("matches by command code and consumes each recorded exchange once", async () => {
    const transport = FakeTransport.fromFrames(SCRIPT);
    const received = record(transport);
    await transport.write(bytes(0x16, 9, 9, 9));
    await transport.write(bytes(0x16, 3));
    await vi.advanceTimersByTimeAsync(1000);
    expect(received).toHaveLength(2);
  });

  it("gives a write that matches nothing no reply", async () => {
    const transport = FakeTransport.fromFrames(SCRIPT);
    const received = record(transport);
    await transport.write(bytes(0x99));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(received).toEqual([]);
    expect(transport.writtenFrames).toEqual([bytes(0x99)]);
  });

  it("silence(code) consumes the write and sends nothing", async () => {
    const transport = FakeTransport.fromFrames(SCRIPT).silence(0x16);
    const received = record(transport);
    await transport.write(bytes(0x16, 3));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(received).toEqual([]);
  });

  it("corrupt(n) truncates only that rx frame to one byte", async () => {
    const transport = FakeTransport.fromFrames(SCRIPT).corrupt(1);
    const received = record(transport);
    await transport.write(bytes(0x16, 3));
    await vi.advanceTimersByTimeAsync(200);
    expect(received.map((r) => r.frame)).toEqual([[0x0d, 1], [0x0d]]);
  });

  it("dropAfterWrites(n) disconnects after the nth write, cancels replies and rejects later writes", async () => {
    const transport = FakeTransport.fromFrames(SCRIPT).dropAfterWrites(1);
    const received = record(transport);
    const onDisconnect = vi.fn();
    transport.onDisconnect(onDisconnect);
    await transport.write(bytes(0x16, 3));
    expect(onDisconnect).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(received).toEqual([]);
    await expect(transport.write(bytes(0x01))).rejects.toThrow();
  });

  it("drop() disconnects once", () => {
    const transport = FakeTransport.fromFrames(SCRIPT);
    const onDisconnect = vi.fn();
    transport.onDisconnect(onDisconnect);
    transport.drop();
    transport.drop();
    expect(onDisconnect).toHaveBeenCalledTimes(1);
  });

  it("close() stops delivery, unsubscribes listeners and rejects writes", async () => {
    const transport = FakeTransport.fromFrames(SCRIPT);
    const received = record(transport);
    await transport.write(bytes(0x16, 3));
    await transport.close();
    await vi.advanceTimersByTimeAsync(1000);
    expect(received).toEqual([]);
    expect(transport.closed).toBe(true);
    await expect(transport.write(bytes(0x16))).rejects.toThrow();
  });

  it("an unsubscribed listener gets nothing", async () => {
    const transport = FakeTransport.fromFrames(SCRIPT);
    const listener = vi.fn();
    transport.onFrame(listener)();
    await transport.write(bytes(0x16, 3));
    await vi.advanceTimersByTimeAsync(1000);
    expect(listener).not.toHaveBeenCalled();
  });

  it("refuses a script that starts with an rx frame", () => {
    expect(() => FakeTransport.fromFrames([{ dir: "rx", tMs: 1, hex: "00" }])).toThrow();
  });
});
