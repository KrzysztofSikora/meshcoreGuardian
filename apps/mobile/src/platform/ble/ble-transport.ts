import type { MeshTransport, Unsubscribe } from "@guardian/meshcore-adapter";

import { base64ToBytes, bytesToBase64 } from "./base64";
import { NUS_RX, NUS_SERVICE, NUS_TX } from "./uuids";

/** Each close step is bounded: the link may already be gone (like the S-01 capture transport). */
export const CLOSE_STEP_TIMEOUT_MS = 5_000;

interface Cancelable {
  remove(): void;
}

/** The part of a ble-plx `Device` the transport uses, so tests can fake it. */
export interface BleDeviceLike {
  writeCharacteristicWithResponseForService(
    serviceUUID: string,
    characteristicUUID: string,
    base64Value: string,
  ): Promise<unknown>;
  monitorCharacteristicForService(
    serviceUUID: string,
    characteristicUUID: string,
    listener: (error: unknown, characteristic: { value: string | null } | null) => void,
  ): Cancelable;
  onDisconnected(listener: () => void): Cancelable;
  cancelConnection(): Promise<unknown>;
}

function bounded(promise: Promise<unknown>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, CLOSE_STEP_TIMEOUT_MS);
  });
  return Promise.race([
    promise.then(
      () => undefined,
      () => undefined,
    ),
    timeout,
  ]).finally(() => clearTimeout(timer));
}

/**
 * `MeshTransport` over an open ble-plx link: one write is one companion frame, one TX
 * notification is one frame. A throwing listener never starves the others.
 */
export class BleTransport implements MeshTransport {
  private readonly frameListeners = new Set<(frame: Uint8Array) => void>();
  private readonly disconnectListeners = new Set<() => void>();
  private readonly monitor: Cancelable;
  private readonly disconnectSubscription: Cancelable;
  private closed = false;
  private dropped = false;

  constructor(private readonly device: BleDeviceLike) {
    this.monitor = device.monitorCharacteristicForService(
      NUS_SERVICE,
      NUS_TX,
      (error, characteristic) => {
        // A monitor error means the notification stream is gone; report it once as a drop.
        if (error !== null && error !== undefined) return this.drop();
        if (characteristic?.value == null) return;
        const frame = base64ToBytes(characteristic.value);
        for (const listener of [...this.frameListeners]) {
          try {
            listener(frame);
          } catch {
            // Isolated: the other listeners still see the frame.
          }
        }
      },
    );
    this.disconnectSubscription = device.onDisconnected(() => this.drop());
  }

  async write(frame: Uint8Array): Promise<void> {
    if (this.closed || this.dropped) throw new Error("BLE link is closed");
    await this.device.writeCharacteristicWithResponseForService(
      NUS_SERVICE,
      NUS_RX,
      bytesToBase64(frame),
    );
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
    this.frameListeners.clear();
    this.disconnectListeners.clear();
    this.monitor.remove();
    this.disconnectSubscription.remove();
    await bounded(this.device.cancelConnection());
  }

  private drop(): void {
    if (this.closed || this.dropped) return;
    this.dropped = true;
    for (const listener of [...this.disconnectListeners]) {
      try {
        listener();
      } catch {
        // Isolated, as for frames.
      }
    }
  }
}
