import { afterEach, describe, expect, it, vi } from "vitest";

import { BleTransport, CLOSE_STEP_TIMEOUT_MS, type BleDeviceLike } from "./ble-transport";
import { NUS_RX, NUS_SERVICE, NUS_TX } from "./uuids";

type Monitor = Parameters<BleDeviceLike["monitorCharacteristicForService"]>[2];

function fakeDevice() {
  let monitor: Monitor = () => undefined;
  let disconnected: () => void = () => undefined;
  const removed = { monitor: false, disconnect: false };
  const device = {
    writes: [] as [string, string, string][],
    cancel: vi.fn<() => Promise<unknown>>(async () => undefined),
    writeCharacteristicWithResponseForService: vi.fn(async (s: string, c: string, v: string) => {
      device.writes.push([s, c, v]);
    }),
    monitorCharacteristicForService: (s: string, c: string, listener: Monitor) => {
      expect([s, c]).toEqual([NUS_SERVICE, NUS_TX]);
      monitor = listener;
      return { remove: () => void (removed.monitor = true) };
    },
    onDisconnected: (listener: () => void) => {
      disconnected = listener;
      return { remove: () => void (removed.disconnect = true) };
    },
    cancelConnection: () => device.cancel(),
  };
  return {
    device,
    removed,
    notify: (value: string) => monitor(null, { value }),
    notifyError: () => monitor(new Error("gone"), null),
    disconnect: () => disconnected(),
  };
}

afterEach(() => vi.useRealTimers());

describe("BleTransport", () => {
  it("writes base64 to the RX characteristic", async () => {
    const f = fakeDevice();
    await new BleTransport(f.device).write(Uint8Array.from([0x16, 0x03]));
    expect(f.device.writes).toEqual([[NUS_SERVICE, NUS_RX, "FgM="]]);
  });

  it("delivers one notification as one frame, and isolates a throwing listener", () => {
    const f = fakeDevice();
    const transport = new BleTransport(f.device);
    const seen: number[][] = [];
    transport.onFrame(() => {
      throw new Error("boom");
    });
    transport.onFrame((frame) => seen.push([...frame]));
    f.notify("FgM=");
    expect(seen).toEqual([[0x16, 0x03]]);
  });

  it("reports a disconnect once, and rejects writes afterwards", async () => {
    const f = fakeDevice();
    const transport = new BleTransport(f.device);
    const drops = vi.fn();
    transport.onDisconnect(drops);
    f.disconnect();
    f.notifyError();
    expect(drops).toHaveBeenCalledTimes(1);
    await expect(transport.write(Uint8Array.of(1))).rejects.toThrow();
  });

  it("treats a monitor error as a drop", () => {
    const f = fakeDevice();
    const drops = vi.fn();
    new BleTransport(f.device).onDisconnect(drops);
    f.notifyError();
    expect(drops).toHaveBeenCalledTimes(1);
  });

  it("close is idempotent, silent, and bounded when cancelling hangs", async () => {
    vi.useFakeTimers();
    const f = fakeDevice();
    f.device.cancel.mockImplementation(() => new Promise(() => undefined));
    const transport = new BleTransport(f.device);
    const drops = vi.fn();
    transport.onDisconnect(drops);
    const closing = transport.close();
    await vi.advanceTimersByTimeAsync(CLOSE_STEP_TIMEOUT_MS);
    await closing;
    await transport.close();
    f.disconnect();
    expect(f.device.cancel).toHaveBeenCalledTimes(1);
    expect(f.removed).toEqual({ monitor: true, disconnect: true });
    expect(drops).not.toHaveBeenCalled();
  });
});
