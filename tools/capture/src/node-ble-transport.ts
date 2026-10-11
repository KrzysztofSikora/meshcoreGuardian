import type { MeshTransport, Unsubscribe } from "@guardian/meshcore-adapter";
import type { Device, GattCharacteristic } from "node-ble";

// Nordic UART service of the MeshCore companion (meshcore.js Constants.Ble), lower case for BlueZ.
export const NUS_SERVICE = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
/** Written by the app: one companion frame per write. */
export const NUS_RX = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";
/** Notified by the companion: one companion frame per notification (D-2, checked by the capture). */
export const NUS_TX = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";

/** Bounds on connecting and closing (plan-review #3): BlueZ calls have no timeout of their own. */
export const FIND_DEVICE_TIMEOUT_MS = 20_000;
export const CONNECT_TIMEOUT_MS = 20_000;
export const CLOSE_STEP_TIMEOUT_MS = 5_000;

// The node-ble surface the transport uses, narrowed from its bundled types so tests can fake it.
// `main.ts` passes the real module, so the compiler checks node-ble against these shapes.
export interface BleCharacteristic extends Pick<
  GattCharacteristic,
  "writeValue" | "startNotifications" | "stopNotifications"
> {
  on(event: "valuechanged", listener: (buffer: Buffer) => void): unknown;
  off(event: "valuechanged", listener: (buffer: Buffer) => void): unknown;
}
export interface BleDevice extends Pick<Device, "connect" | "disconnect"> {
  on(event: "disconnect", listener: () => void): unknown;
  off(event: "disconnect", listener: () => void): unknown;
  gatt(): Promise<{
    getPrimaryService(uuid: string): Promise<{
      getCharacteristic(uuid: string): Promise<BleCharacteristic>;
    }>;
  }>;
}
export interface BleDeps {
  createBluetooth(): {
    bluetooth: {
      defaultAdapter(): Promise<{
        waitDevice(address: string, timeout?: number): Promise<BleDevice>;
      }>;
    };
    destroy(): void;
  };
}

export class BleConnectError extends Error {
  override readonly name = "BleConnectError";
}

const MAC = /^(?:[0-9A-F]{2}:){5}[0-9A-F]{2}$/;

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new BleConnectError(`${what}: no answer within ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Connects to the companion at `address` through BlueZ (node-ble) and returns it as a
 * `MeshTransport`. The bond comes from `bluetoothctl`; BlueZ negotiates the MTU. Every step is
 * bounded; on failure the device is disconnected and the D-Bus connection closed.
 */
export async function connectNodeBle(address: string, deps: BleDeps): Promise<MeshTransport> {
  const mac = address.toUpperCase();
  if (!MAC.test(mac))
    throw new BleConnectError(
      "HW_COMPANION must be the companion's BLE address (AA:BB:CC:DD:EE:FF)",
    );

  const { bluetooth, destroy } = deps.createBluetooth();
  let device: BleDevice | undefined;
  try {
    const adapter = await bluetooth.defaultAdapter();
    device = await withTimeout(
      adapter.waitDevice(mac, FIND_DEVICE_TIMEOUT_MS),
      FIND_DEVICE_TIMEOUT_MS + CLOSE_STEP_TIMEOUT_MS,
      "Finding the companion",
    );
    await withTimeout(device.connect(), CONNECT_TIMEOUT_MS, "Connecting to the companion");
    const gatt = await withTimeout(device.gatt(), CONNECT_TIMEOUT_MS, "Reading GATT services");
    const service = await gatt.getPrimaryService(NUS_SERVICE);
    const rx = await service.getCharacteristic(NUS_RX);
    const tx = await service.getCharacteristic(NUS_TX);
    const transport = new NodeBleTransport(device, rx, tx, destroy);
    await withTimeout(tx.startNotifications(), CONNECT_TIMEOUT_MS, "Starting notifications");
    return transport;
  } catch (error) {
    await device?.disconnect().catch(() => undefined);
    destroy();
    if (error instanceof BleConnectError) throw error;
    throw new BleConnectError(`Cannot connect to the companion: ${(error as Error).message}`);
  }
}

class NodeBleTransport implements MeshTransport {
  private readonly frameListeners = new Set<(frame: Uint8Array) => void>();
  private readonly disconnectListeners = new Set<() => void>();
  private closed = false;

  private readonly onValue = (buffer: Buffer) => {
    // A plain Uint8Array copy: the adapter and recorder never see Node's Buffer.
    const frame = Uint8Array.from(buffer);
    for (const listener of this.frameListeners) listener(frame);
  };

  private readonly onDeviceDisconnect = () => {
    for (const listener of this.disconnectListeners) listener();
  };

  constructor(
    private readonly device: BleDevice,
    private readonly rx: BleCharacteristic,
    private readonly tx: BleCharacteristic,
    private readonly destroy: () => void,
  ) {
    tx.on("valuechanged", this.onValue);
    device.on("disconnect", this.onDeviceDisconnect);
  }

  async write(frame: Uint8Array): Promise<void> {
    await this.rx.writeValue(Buffer.from(frame), { type: "request" });
  }

  onFrame(callback: (frame: Uint8Array) => void): Unsubscribe {
    this.frameListeners.add(callback);
    return () => this.frameListeners.delete(callback);
  }

  onDisconnect(callback: () => void): Unsubscribe {
    this.disconnectListeners.add(callback);
    return () => this.disconnectListeners.delete(callback);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.tx.off("valuechanged", this.onValue);
    this.device.off("disconnect", this.onDeviceDisconnect);
    this.frameListeners.clear();
    this.disconnectListeners.clear();
    // Best effort: the link may already be gone, and closing must not hang the tool.
    const step = (promise: Promise<void>, what: string) =>
      withTimeout(promise, CLOSE_STEP_TIMEOUT_MS, what).catch(() => undefined);
    await step(this.tx.stopNotifications(), "Stopping notifications");
    await step(this.device.disconnect(), "Disconnecting");
    this.destroy();
  }
}
