import { FakeTransport, HANDSHAKE_FRAMES, withFirmware } from "@guardian/meshcore-adapter";

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
  | { firmware: { verCode: number; version: string } };

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
  private attemptIndex = 0;

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

  scan(onDevice: (device: ScannedDevice) => void, signal: AbortSignal): void {
    this.calls.scan += 1;
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
    const frames =
      typeof attempt === "object" && "firmware" in attempt
        ? withFirmware(HANDSHAKE_FRAMES, attempt.firmware)
        : HANDSHAKE_FRAMES;
    const transport = FakeTransport.fromFrames(frames);
    if (attempt === "silent") {
      for (const frame of frames)
        if (frame.dir === "tx") transport.silence(parseInt(frame.hex.slice(0, 2), 16));
    }
    if (typeof attempt === "object" && "dropAfterMs" in attempt) {
      setTimeout(() => transport.drop(), attempt.dropAfterMs);
    }
    return { transport, mtu: FAKE_MTU };
  }
}
