import { PermissionsAndroid, Linking } from "react-native";
import { BleManager, State } from "react-native-ble-plx";

import { isCompanionAdvertisement } from "../../application/connection/advertisement";
import type {
  AdapterState,
  BleLink,
  BlePlatform,
  PermissionStatus,
  ScannedDevice,
} from "../../application/connection/ports";
import { BleTransport } from "./ble-transport";
import { REQUIRED_PERMISSIONS } from "./permissions";

/** Plan D-9: ask for a large MTU so 148-byte contact frames arrive whole. */
const REQUESTED_MTU = 512;
const CONNECT_TIMEOUT_MS = 15_000;

/** Real Bluetooth through react-native-ble-plx. The emulator has none: human checks cover it. */
export class RnBlePlatform implements BlePlatform {
  private manager: BleManager | null = null;
  private blocked = false;

  private ble(): BleManager {
    this.manager ??= new BleManager();
    return this.manager;
  }

  async permissionStatus(): Promise<PermissionStatus> {
    const checks = await Promise.all(REQUIRED_PERMISSIONS.map((p) => PermissionsAndroid.check(p)));
    if (checks.every(Boolean)) return "granted";
    return this.blocked ? "blocked" : "denied";
  }

  async requestPermissions(): Promise<PermissionStatus> {
    const results = await PermissionsAndroid.requestMultiple([...REQUIRED_PERMISSIONS]);
    const values = REQUIRED_PERMISSIONS.map((p) => results[p]);
    if (values.every((v) => v === PermissionsAndroid.RESULTS.GRANTED)) {
      this.blocked = false;
      return "granted";
    }
    this.blocked = values.some((v) => v === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN);
    return this.blocked ? "blocked" : "denied";
  }

  openSettings(): Promise<void> {
    return Linking.openSettings();
  }

  async adapterState(): Promise<AdapterState> {
    const state = await this.ble().state();
    if (state === State.PoweredOn) return "on";
    if (state === State.PoweredOff) return "off";
    return "unavailable";
  }

  scan(onDevice: (device: ScannedDevice) => void, signal: AbortSignal): void {
    const manager = this.ble();
    const stop = () => manager.stopDeviceScan();
    signal.addEventListener("abort", stop, { once: true });
    // No OS-level UUID filter (D-8): match the UUID or the name here.
    void manager.startDeviceScan(null, { allowDuplicates: false }, (error, device) => {
      if (error !== null) return stop();
      if (device === null || signal.aborted) return;
      const ad = { name: device.name ?? device.localName, serviceUUIDs: device.serviceUUIDs };
      if (isCompanionAdvertisement(ad)) onDevice({ id: device.id, name: ad.name ?? null });
    });
  }

  async connect(id: string, signal: AbortSignal): Promise<BleLink> {
    const manager = this.ble();
    const cancel = () => void manager.cancelDeviceConnection(id).catch(() => undefined);
    signal.addEventListener("abort", cancel, { once: true });
    try {
      const connected = await manager.connectToDevice(id, {
        requestMTU: REQUESTED_MTU,
        timeout: CONNECT_TIMEOUT_MS,
      });
      const device = await connected.discoverAllServicesAndCharacteristics();
      if (signal.aborted) throw new Error("aborted");
      return { transport: new BleTransport(device), mtu: device.mtu };
    } catch (error) {
      cancel();
      throw error;
    } finally {
      signal.removeEventListener("abort", cancel);
    }
  }
}
