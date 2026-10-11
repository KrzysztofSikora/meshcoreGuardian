import type { MeshTransport, Unsubscribe } from "@guardian/meshcore-adapter";

export type PermissionStatus = "granted" | "denied" | "blocked";
export type AdapterState = "on" | "off" | "unavailable";

export interface ScannedDevice {
  id: string;
  name: string | null;
}

export interface BleLink {
  transport: MeshTransport;
  /** Negotiated ATT MTU, `null` when the platform cannot tell. */
  mtu: number | null;
}

/** Everything the session needs from Bluetooth and the OS permission system. */
export interface BlePlatform {
  permissionStatus(): Promise<PermissionStatus>;
  requestPermissions(): Promise<PermissionStatus>;
  openSettings(): Promise<void>;
  adapterState(): Promise<AdapterState>;
  /** Reports companions until `signal` aborts. The session owns the time limit. */
  scan(onDevice: (device: ScannedDevice) => void, signal: AbortSignal): void;
  /** Opens a link; rejects when `signal` aborts. */
  connect(id: string, signal: AbortSignal): Promise<BleLink>;
}

export interface AppStatePort {
  current(): "active" | "background";
  onChange(callback: (state: "active" | "background") => void): Unsubscribe;
}

export interface LastCompanion {
  id: string;
  name: string;
}

export interface LastCompanionStore {
  load(): Promise<LastCompanion | null>;
  save(value: LastCompanion): Promise<void>;
}
