import { EventEmitter } from "node:events";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BleConnectError,
  CLOSE_STEP_TIMEOUT_MS,
  CONNECT_TIMEOUT_MS,
  connectNodeBle,
  NUS_RX,
  NUS_SERVICE,
  NUS_TX,
  type BleDeps,
} from "./node-ble-transport";

class FakeCharacteristic extends EventEmitter {
  readonly writes: { buffer: Buffer; options: unknown }[] = [];
  notifying = false;
  startNotifications = vi.fn(async () => {
    this.notifying = true;
  });
  stopNotifications = vi.fn(async () => {
    this.notifying = false;
  });

  async writeValue(buffer: Buffer, options?: unknown): Promise<void> {
    this.writes.push({ buffer, options });
  }
}

class FakeDevice extends EventEmitter {
  connected = false;
  readonly rx = new FakeCharacteristic();
  readonly tx = new FakeCharacteristic();
  readonly requested: string[] = [];
  connect = vi.fn(async () => {
    this.connected = true;
  });
  disconnect = vi.fn(async () => {
    this.connected = false;
  });

  async gatt() {
    return {
      getPrimaryService: async (uuid: string) => {
        this.requested.push(uuid);
        return {
          getCharacteristic: async (id: string) => {
            this.requested.push(id);
            if (id === NUS_RX) return this.rx;
            if (id === NUS_TX) return this.tx;
            throw new Error(`no characteristic ${id}`);
          },
        };
      },
    };
  }
}

function fakeBle(device = new FakeDevice()) {
  const waited: { address: string; timeout: number | undefined }[] = [];
  let destroyed = 0;
  const deps: BleDeps = {
    createBluetooth: () => ({
      bluetooth: {
        defaultAdapter: async () => ({
          waitDevice: async (address: string, timeout?: number) => {
            waited.push({ address, timeout });
            return device;
          },
        }),
      },
      destroy: () => (destroyed += 1),
    }),
  };
  return { deps, device, waited, destroyed: () => destroyed };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("connectNodeBle", () => {
  it("connects to the address over the Nordic UART service and starts notifications", async () => {
    const { deps, device, waited } = fakeBle();
    await connectNodeBle("aa:bb:cc:dd:ee:ff", deps);

    expect(waited).toEqual([{ address: "AA:BB:CC:DD:EE:FF", timeout: 20_000 }]);
    expect(device.connected).toBe(true);
    expect(device.requested).toEqual([NUS_SERVICE, NUS_RX, NUS_TX]);
    expect(device.tx.notifying).toBe(true);
    expect(device.rx.startNotifications).not.toHaveBeenCalled();
  });

  it("writes one frame per write, with a write request", async () => {
    const { deps, device } = fakeBle();
    const transport = await connectNodeBle("AA:BB:CC:DD:EE:FF", deps);

    await transport.write(Uint8Array.from([22, 3]));

    expect(device.rx.writes).toHaveLength(1);
    expect(Array.from(device.rx.writes[0]?.buffer ?? [])).toEqual([22, 3]);
    expect(device.rx.writes[0]?.options).toEqual({ type: "request" });
    expect(device.tx.writes).toEqual([]);
  });

  it("delivers each notification as one plain Uint8Array frame", async () => {
    const { deps, device } = fakeBle();
    const transport = await connectNodeBle("AA:BB:CC:DD:EE:FF", deps);
    const frames: Uint8Array[] = [];
    transport.onFrame((frame) => frames.push(frame));

    const notified = Buffer.from([0, 1, 2]);
    device.tx.emit("valuechanged", notified);
    notified[0] = 9;

    expect(frames).toHaveLength(1);
    expect(Object.getPrototypeOf(frames[0])).toBe(Uint8Array.prototype);
    expect(Array.from(frames[0] ?? [])).toEqual([0, 1, 2]);
  });

  it("reports a device disconnect", async () => {
    const { deps, device } = fakeBle();
    const transport = await connectNodeBle("AA:BB:CC:DD:EE:FF", deps);
    const onDisconnect = vi.fn();
    transport.onDisconnect(onDisconnect);

    device.emit("disconnect", { connected: false });

    expect(onDisconnect).toHaveBeenCalledOnce();
  });

  it("unsubscribes single listeners", async () => {
    const { deps, device } = fakeBle();
    const transport = await connectNodeBle("AA:BB:CC:DD:EE:FF", deps);
    const onFrame = vi.fn();
    const onDisconnect = vi.fn();
    transport.onFrame(onFrame)();
    transport.onDisconnect(onDisconnect)();

    device.tx.emit("valuechanged", Buffer.from([0]));
    device.emit("disconnect", { connected: false });

    expect(onFrame).not.toHaveBeenCalled();
    expect(onDisconnect).not.toHaveBeenCalled();
  });

  it("closes by stopping notifications, disconnecting and releasing D-Bus, once", async () => {
    const { deps, device, destroyed } = fakeBle();
    const transport = await connectNodeBle("AA:BB:CC:DD:EE:FF", deps);
    const onFrame = vi.fn();
    const onDisconnect = vi.fn();
    transport.onFrame(onFrame);
    transport.onDisconnect(onDisconnect);

    await transport.close();
    await transport.close();
    device.tx.emit("valuechanged", Buffer.from([0]));
    device.emit("disconnect", { connected: false });

    expect(device.tx.stopNotifications).toHaveBeenCalledOnce();
    expect(device.disconnect).toHaveBeenCalledOnce();
    expect(device.connected).toBe(false);
    expect(destroyed()).toBe(1);
    expect(device.tx.listenerCount("valuechanged")).toBe(0);
    expect(device.listenerCount("disconnect")).toBe(0);
    expect(onFrame).not.toHaveBeenCalled();
    expect(onDisconnect).not.toHaveBeenCalled();
  });

  it("still disconnects and releases D-Bus when the link is already gone", async () => {
    vi.useFakeTimers();
    const { deps, device, destroyed } = fakeBle();
    const transport = await connectNodeBle("AA:BB:CC:DD:EE:FF", deps);
    device.tx.stopNotifications.mockImplementation(() => new Promise(() => undefined));

    const closing = transport.close();
    await vi.advanceTimersByTimeAsync(CLOSE_STEP_TIMEOUT_MS);
    await closing;

    expect(device.disconnect).toHaveBeenCalledOnce();
    expect(destroyed()).toBe(1);
  });

  it.each(["Base", "AA:BB:CC:DD:EE", "AA-BB-CC-DD-EE-FF"])(
    "refuses %j, which is not a BLE address, before touching D-Bus",
    async (address) => {
      const { deps, waited, destroyed } = fakeBle();
      await expect(connectNodeBle(address, deps)).rejects.toThrow(
        "HW_COMPANION must be the companion's BLE address",
      );
      expect(waited).toEqual([]);
      expect(destroyed()).toBe(0);
    },
  );

  it("gives up on a connect that never completes and cleans up", async () => {
    vi.useFakeTimers();
    const { deps, device, destroyed } = fakeBle();
    device.connect.mockImplementation(() => new Promise(() => undefined));

    const connecting = connectNodeBle("AA:BB:CC:DD:EE:FF", deps);
    const outcome = expect(connecting).rejects.toThrow(
      new BleConnectError(`Connecting to the companion: no answer within ${CONNECT_TIMEOUT_MS} ms`),
    );
    await vi.advanceTimersByTimeAsync(CONNECT_TIMEOUT_MS);
    await outcome;

    expect(device.disconnect).toHaveBeenCalledOnce();
    expect(destroyed()).toBe(1);
  });

  it("wraps a missing service in a connect error and cleans up", async () => {
    const device = new FakeDevice();
    device.gatt = async () => ({
      getPrimaryService: async () => {
        throw new Error("Service not found");
      },
    });
    const { deps, destroyed } = fakeBle(device);

    await expect(connectNodeBle("AA:BB:CC:DD:EE:FF", deps)).rejects.toThrow(
      new BleConnectError("Cannot connect to the companion: Service not found"),
    );
    expect(device.disconnect).toHaveBeenCalledOnce();
    expect(destroyed()).toBe(1);
  });
});
