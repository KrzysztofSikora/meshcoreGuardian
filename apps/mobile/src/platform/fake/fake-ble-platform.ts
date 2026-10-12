import {
  CONTACTS_FRAMES,
  DIAG_CONTACTS_FRAMES,
  FakeTransport,
  HANDSHAKE_FRAMES,
  NEAREST_CONTACTS_FRAMES,
  NEAREST_HANDSHAKE_FRAMES,
  remoteScript,
  withFirmware,
  type RemoteScriptSpec,
} from "@guardian/meshcore-adapter";

import type {
  AdapterState,
  BleLink,
  BlePlatform,
  PermissionStatus,
  ScannedDevice,
} from "../../application/connection/ports";

/** What one `connect` call does; the next attempt is used each time, the last one repeats. */
export type Attempt =
  | "ok"
  | "connect-error"
  | "connect-timeout"
  | "silent"
  | { dropAfterMs: number }
  | { firmware: { verCode: number; version: string } }
  /** Companion with a position and contacts with paths and positions (nearest-repeater card). */
  | { nearest: true }
  | {
      /** Remote exchanges for Room K (plan D-17), on top of the usual handshake and contacts. */
      diagnostic: RemoteScriptSpec;
      firmware?: { verCode: number; version: string };
      /** Drops the link right after this many remote requests were written. */
      dropAfterRemoteWrites?: number;
    };

export interface Scenario {
  permission: PermissionStatus;
  bluetooth: Extract<AdapterState, "on" | "off">;
  devices: ScannedDevice[];
  attempts: Attempt[];
}

const SCAN_DELAY_MS = 300;
const FAKE_MTU = 185;

function abortReject(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) reject(new Error("aborted"));
    signal.addEventListener("abort", () => reject(new Error("aborted")));
  });
}

/** Scripted Bluetooth for the fake build and the tests. No radio, no OS. */
export class FakeBlePlatform implements BlePlatform {
  readonly calls = { scan: 0, connect: 0, requestPermissions: 0, openSettings: 0 };
  /** The transport of the latest connect, so tests can inject faults or read the writes. */
  lastTransport: FakeTransport | null = null;
  private attemptIndex = 0;
  private scanFails = false;

  constructor(private scenario: Scenario) {}

  setScenario(scenario: Scenario): void {
    this.scenario = scenario;
    this.attemptIndex = 0;
  }

  async permissionStatus(): Promise<PermissionStatus> {
    return this.scenario.permission;
  }

  async requestPermissions(): Promise<PermissionStatus> {
    this.calls.requestPermissions += 1;
    return this.scenario.permission;
  }

  async openSettings(): Promise<void> {
    this.calls.openSettings += 1;
  }

  async adapterState(): Promise<AdapterState> {
    return this.scenario.bluetooth;
  }

  /** Makes the next scan report a native error instead of devices. */
  failNextScan(): void {
    this.scanFails = true;
  }

  scan(
    onDevice: (device: ScannedDevice) => void,
    signal: AbortSignal,
    onError: (error: Error) => void,
  ): void {
    this.calls.scan += 1;
    if (this.scanFails) {
      this.scanFails = false;
      const failTimer = setTimeout(() => onError(new Error("Fake scan error")), SCAN_DELAY_MS);
      signal.addEventListener("abort", () => clearTimeout(failTimer));
      return;
    }
    const timer = setTimeout(() => {
      for (const device of this.scenario.devices) onDevice(device);
    }, SCAN_DELAY_MS);
    signal.addEventListener("abort", () => clearTimeout(timer));
  }

  async connect(_id: string, signal: AbortSignal): Promise<BleLink> {
    this.calls.connect += 1;
    const attempts = this.scenario.attempts;
    const attempt = attempts[Math.min(this.attemptIndex, attempts.length - 1)] ?? "ok";
    this.attemptIndex += 1;
    if (attempt === "connect-error") throw new Error("Fake connect error");
    if (attempt === "connect-timeout") return abortReject(signal);
    const firmware =
      typeof attempt === "object" && "firmware" in attempt ? attempt.firmware : undefined;
    const nearest = typeof attempt === "object" && "nearest" in attempt;
    const baseHandshake = nearest ? NEAREST_HANDSHAKE_FRAMES : HANDSHAKE_FRAMES;
    const handshake =
      firmware === undefined ? baseHandshake : withFirmware(baseHandshake, firmware);
    const diagnostic =
      typeof attempt === "object" && "diagnostic" in attempt ? attempt : undefined;
    // Two syncs per connection: the automatic one and one tap on "Sync contacts" (plan D-12).
    // The remote script is there twice: a retry writes the same request again (plan D-17).
    const contacts =
      diagnostic !== undefined
        ? DIAG_CONTACTS_FRAMES
        : nearest
          ? NEAREST_CONTACTS_FRAMES
          : CONTACTS_FRAMES;
    const remote =
      diagnostic === undefined
        ? []
        : [...remoteScript(diagnostic.diagnostic), ...remoteScript(diagnostic.diagnostic)];
    const frames = [...handshake, ...contacts, ...contacts, ...remote];
    const transport = FakeTransport.fromFrames(frames);
    this.lastTransport = transport;
    if (attempt === "silent") {
      for (const frame of frames)
        if (frame.dir === "tx") transport.silence(parseInt(frame.hex.slice(0, 2), 16));
    }
    if (diagnostic?.dropAfterRemoteWrites !== undefined) {
      const before = [...handshake, ...contacts].filter((frame) => frame.dir === "tx").length;
      transport.dropAfterWrites(before + diagnostic.dropAfterRemoteWrites);
    }
    if (typeof attempt === "object" && "dropAfterMs" in attempt) {
      setTimeout(() => transport.drop(), attempt.dropAfterMs);
    }
    return { transport, mtu: FAKE_MTU };
  }
}
