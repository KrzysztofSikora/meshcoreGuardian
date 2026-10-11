import {
  deriveCapabilities,
  isTestedFirmware,
  type Capabilities,
  type ConnectFailureReason,
  type ConnectionState,
} from "@guardian/domain";
import {
  AbortError,
  HandshakeTimeoutError,
  MalformedFrameError,
  MeshClient,
  TransportUnavailableError,
} from "@guardian/meshcore-adapter";
import { createStore, type StoreApi } from "zustand/vanilla";

import type {
  AdapterState,
  AppStatePort,
  BlePlatform,
  LastCompanion,
  LastCompanionStore,
  PermissionStatus,
  ScannedDevice,
} from "./ports";

/** Plan D-8 and D-4: both bounds keep the radio use finite. */
export const SCAN_WINDOW_MS = 10_000;
export const CONNECT_TIMEOUT_MS = 15_000;

export interface SessionState {
  permission: PermissionStatus | "unknown";
  bluetooth: AdapterState | "unknown";
  scan: { status: "idle" | "scanning" | "done" | "failed"; devices: ScannedDevice[] };
  connection: ConnectionState;
  lastCompanion: LastCompanion | null;
  mtu: number | null;
  capabilities: Capabilities | null;
  firmwareTested: boolean | null;
  /** True after a link drop while connected, until the next attempt. */
  linkLostNote: boolean;
}

export interface SessionPorts {
  platform: BlePlatform;
  appState: AppStatePort;
  lastCompanionStore: LastCompanionStore;
}

const INITIAL: SessionState = {
  permission: "unknown",
  bluetooth: "unknown",
  scan: { status: "idle", devices: [] },
  connection: { kind: "disconnected" },
  lastCompanion: null,
  mtu: null,
  capabilities: null,
  firmwareTested: null,
  linkLostNote: false,
};

type Timer = ReturnType<typeof setTimeout>;

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new AbortError());
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

/**
 * Orchestrates scan, connect and handshake for one companion (plan D-16). Nothing starts without
 * a method call: no timer connects, scans or retries on its own (NFR-07, FR-10 AC6).
 */
export class CompanionSession {
  readonly store: StoreApi<SessionState> = createStore<SessionState>(() => INITIAL);

  private scanAbort: AbortController | null = null;
  private scanTimer: Timer | null = null;
  private scanToken = 0;
  private attempt: { id: string; abort: AbortController } | null = null;
  private client: MeshClient | null = null;
  private lastTarget: LastCompanion | null = null;
  private readonly unsubscribeAppState: () => void;

  constructor(private readonly ports: SessionPorts) {
    this.unsubscribeAppState = ports.appState.onChange((state) => {
      if (state === "background") this.stopScan();
    });
  }

  getState(): SessionState {
    return this.store.getState();
  }

  /** Loads the remembered companion and the current permission and adapter state. */
  async initialize(): Promise<void> {
    const last = await this.ports.lastCompanionStore.load().catch(() => null);
    // Called on every Connect screen mount: it must not replace the companion Retry points at.
    this.lastTarget ??= last;
    this.set({ lastCompanion: last });
    await this.refreshPermission();
  }

  async refreshPermission(): Promise<void> {
    const [permission, bluetooth] = await Promise.all([
      this.ports.platform.permissionStatus(),
      this.ports.platform.adapterState(),
    ]);
    this.set({ permission, bluetooth });
  }

  async requestPermission(): Promise<void> {
    const permission = await this.ports.platform.requestPermissions();
    this.set({ permission });
  }

  async openSettings(): Promise<void> {
    await this.ports.platform.openSettings();
  }

  async startScan(): Promise<void> {
    if (this.isBackground() || this.getState().scan.status === "scanning") return;
    const token = ++this.scanToken;
    await this.refreshPermission();
    const { permission, bluetooth } = this.getState();
    if (token !== this.scanToken || permission !== "granted") return;
    // Bluetooth off is its own state: never an empty "done" list (FR-01 AC3).
    if (bluetooth !== "on" || this.isBackground()) return;
    const abort = new AbortController();
    this.scanAbort = abort;
    this.set({ scan: { status: "scanning", devices: [] } });
    this.scanTimer = setTimeout(() => this.stopScan(), SCAN_WINDOW_MS);
    this.ports.platform.scan((device) => {
      if (abort.signal.aborted) return;
      const { devices } = this.getState().scan;
      if (devices.some((known) => known.id === device.id)) return;
      this.set({ scan: { status: "scanning", devices: [...devices, device] } });
    }, abort.signal, () => void this.onScanError(abort));
  }

  /** A native scan failure is not "no companions": end it as `failed` and re-read the adapter. */
  private async onScanError(abort: AbortController): Promise<void> {
    if (this.scanAbort !== abort) return;
    this.stopScan();
    this.set({ scan: { status: "failed", devices: this.getState().scan.devices } });
    await this.refreshPermission().catch(() => undefined);
  }

  stopScan(): void {
    this.scanToken += 1;
    if (this.scanTimer !== null) clearTimeout(this.scanTimer);
    this.scanTimer = null;
    const abort = this.scanAbort;
    this.scanAbort = null;
    if (abort === null) return;
    abort.abort();
    this.set({ scan: { status: "done", devices: this.getState().scan.devices } });
  }

  async connect(id: string, name?: string): Promise<void> {
    if (this.isBackground() || this.attempt !== null) return;
    const known = this.getState().scan.devices.find((device) => device.id === id);
    this.lastTarget = { id, name: name ?? known?.name ?? this.lastTarget?.name ?? id };
    this.stopScan();
    const abort = new AbortController();
    this.attempt = { id, abort };
    this.set({ connection: { kind: "connecting" }, linkLostNote: false, capabilities: null });
    try {
      await this.closeClient();
      await this.refreshPermission();
      if (this.getState().permission !== "granted") {
        return this.finish(abort, { kind: "disconnected" });
      }
      if (this.getState().bluetooth !== "on") return this.fail(abort, "BLUETOOTH_OFF");
      await this.link(id, abort);
    } catch (error) {
      this.fail(abort, this.reasonFor(error));
    }
  }

  retry(): Promise<void> {
    return this.lastTarget === null
      ? Promise.resolve()
      : this.connect(this.lastTarget.id, this.lastTarget.name);
  }

  reconnect(): Promise<void> {
    return this.retry();
  }

  async disconnect(): Promise<void> {
    const attempt = this.attempt;
    this.attempt = null;
    attempt?.abort.abort();
    await this.closeClient();
    this.set({ connection: { kind: "disconnected" }, linkLostNote: false, capabilities: null });
  }

  /** Back to the first-launch state; the debug scenario route uses it between scenarios. */
  async reset(): Promise<void> {
    this.stopScan();
    await this.disconnect();
    this.lastTarget = null;
    this.store.setState(INITIAL, true);
    await this.initialize();
  }

  async dispose(): Promise<void> {
    this.unsubscribeAppState();
    this.stopScan();
    this.attempt?.abort.abort();
    this.attempt = null;
    await this.closeClient();
  }

  private async link(id: string, abort: AbortController): Promise<void> {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      abort.abort();
    }, CONNECT_TIMEOUT_MS);
    let link;
    try {
      link = await abortable(this.ports.platform.connect(id, abort.signal), abort.signal);
    } catch (error) {
      if (timedOut) throw new ConnectTimeout();
      throw error;
    } finally {
      clearTimeout(timer);
    }
    if (abort.signal.aborted) {
      await link.transport.close().catch(() => undefined);
      return;
    }
    const client = new MeshClient(link.transport);
    this.client = client;
    client.onDisconnect(() => this.onLinkDropped(client));
    const companion = await client.handshake({ signal: abort.signal });
    if (abort.signal.aborted) return;
    this.set({
      mtu: link.mtu,
      capabilities: deriveCapabilities(companion),
      firmwareTested: isTestedFirmware(companion.firmwareVersion),
    });
    this.finish(abort, { kind: "connected", companion });
    const saved = { id, name: companion.name };
    this.lastTarget = saved;
    this.set({ lastCompanion: saved });
    await this.ports.lastCompanionStore.save(saved).catch(() => undefined);
  }

  private onLinkDropped(client: MeshClient): void {
    if (this.client !== client || this.getState().connection.kind !== "connected") return;
    this.set({
      connection: { kind: "disconnected" },
      linkLostNote: true,
      capabilities: null,
    });
    void this.closeClient();
  }

  private reasonFor(error: unknown): ConnectFailureReason | "ABORTED" {
    if (error instanceof AbortError) return "ABORTED";
    if (error instanceof ConnectTimeout) return "CONNECT_TIMEOUT";
    if (error instanceof HandshakeTimeoutError) return "HANDSHAKE_NO_RESPONSE";
    if (error instanceof MalformedFrameError) return "HANDSHAKE_MALFORMED";
    if (error instanceof TransportUnavailableError) return "LINK_LOST";
    return "CONNECT_ERROR";
  }

  private fail(abort: AbortController, reason: ConnectFailureReason | "ABORTED"): void {
    // A superseded or cancelled attempt leaves the state to whoever replaced it.
    if (this.attempt?.abort !== abort || reason === "ABORTED") return;
    void this.closeClient();
    this.finish(abort, { kind: "failed", reason });
  }

  private finish(abort: AbortController, connection: ConnectionState): void {
    if (this.attempt?.abort !== abort) return;
    this.attempt = null;
    this.set({ connection });
  }

  private async closeClient(): Promise<void> {
    const client = this.client;
    this.client = null;
    await client?.close().catch(() => undefined);
  }

  private isBackground(): boolean {
    return this.ports.appState.current() === "background";
  }

  private set(partial: Partial<SessionState>): void {
    this.store.setState(partial);
  }
}

class ConnectTimeout extends Error {}
