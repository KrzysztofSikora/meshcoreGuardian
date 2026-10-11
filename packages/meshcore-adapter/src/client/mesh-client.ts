// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- the ambient declaration must travel with the source to consumers
/// <reference path="../types/timers.d.ts" />
import type { CompanionInfo } from "@guardian/domain";

import { COMPANION_PROTOCOL_VERSION, MeshCoreConnection } from "../connection/mesh-core-connection";
import { decodeFrame, type DecodedFrame } from "../decode/decode-frame";
import { MalformedFrameError } from "../decode/errors";
import type { MeshTransport, Unsubscribe } from "../transport/mesh-transport";

import {
  AbortError,
  HandshakeTimeoutError,
  TransportUnavailableError,
  type HandshakeStep,
} from "./errors";

/** Plan D-4: the first step covers the Android pairing dialog, the second is a plain reply. */
export const DEVICE_QUERY_TIMEOUT_MS = 30_000;
export const APP_START_TIMEOUT_MS = 5_000;

/** The part of `AbortSignal` we use; the adapter compiles without DOM or Node types. A real signal fits. */
export interface AbortSignalLike {
  readonly aborted: boolean;
  addEventListener(type: "abort", listener: () => void): void;
  removeEventListener(type: "abort", listener: () => void): void;
}

export interface MeshClientOptions {
  deviceQueryTimeoutMs?: number;
  appStartTimeoutMs?: number;
}

interface Pending {
  kind: DecodedFrame["kind"];
  resolve: (frame: DecodedFrame) => void;
  reject: (error: Error) => void;
  cleanup: () => void;
}

/**
 * Timeouts, abort and single-flight over one open `MeshTransport` (the library is only the
 * encoder, CLAUDE.md). Frames are decoded synchronously from `transport.onFrame`, so nothing
 * depends on meshcore.js's `setTimeout(0)` events.
 */
export class MeshClient {
  private readonly connection: MeshCoreConnection;
  private readonly unsubscribes: Unsubscribe[];
  private readonly disconnectListeners = new Set<() => void>();
  private readonly deviceQueryTimeoutMs: number;
  private readonly appStartTimeoutMs: number;
  private pending: Pending | null = null;
  private busy = false;
  private unavailable = false;

  constructor(
    private readonly transport: MeshTransport,
    options: MeshClientOptions = {},
  ) {
    this.deviceQueryTimeoutMs = options.deviceQueryTimeoutMs ?? DEVICE_QUERY_TIMEOUT_MS;
    this.appStartTimeoutMs = options.appStartTimeoutMs ?? APP_START_TIMEOUT_MS;
    // The library only encodes: it gets a send-only view so it never parses (or throws on) rx.
    this.connection = new MeshCoreConnection({
      write: (frame) => transport.write(frame),
      close: () => transport.close(),
      onFrame: () => () => undefined,
      onDisconnect: () => () => undefined,
    });
    this.unsubscribes = [
      transport.onFrame((frame) => this.onFrame(frame)),
      transport.onDisconnect(() => this.onTransportDisconnect()),
    ];
  }

  /** Device query, then app start. No retry: the caller decides (plan D-4). */
  async handshake({ signal }: { signal?: AbortSignalLike } = {}): Promise<CompanionInfo> {
    if (this.busy) throw new Error("busy");
    this.busy = true;
    try {
      const device = await this.step(
        "deviceQuery",
        "deviceInfo",
        this.deviceQueryTimeoutMs,
        signal,
        () => this.connection.sendCommandDeviceQuery(COMPANION_PROTOCOL_VERSION),
      );
      const self = await this.step("appStart", "selfInfo", this.appStartTimeoutMs, signal, () =>
        this.connection.sendCommandAppStart(),
      );
      if (device.kind !== "deviceInfo" || self.kind !== "selfInfo") {
        throw new Error("unreachable: step returned the wrong frame kind");
      }
      return {
        publicKey: self.publicKey,
        name: self.name,
        model: device.manufacturer,
        firmwareVersion: device.firmwareVersion,
        firmwareVerCode: device.firmwareVerCode,
        buildDate: device.buildDate,
      };
    } finally {
      this.busy = false;
    }
  }

  onDisconnect(callback: () => void): Unsubscribe {
    this.disconnectListeners.add(callback);
    return () => this.disconnectListeners.delete(callback);
  }

  async close(): Promise<void> {
    this.unavailable = true;
    this.failPending(new TransportUnavailableError("Client closed"));
    for (const unsubscribe of this.unsubscribes.splice(0)) unsubscribe();
    this.disconnectListeners.clear();
    await this.transport.close();
  }

  private async step(
    step: HandshakeStep,
    kind: DecodedFrame["kind"],
    timeoutMs: number,
    signal: AbortSignalLike | undefined,
    send: () => Promise<void>,
  ): Promise<DecodedFrame> {
    if (signal?.aborted) throw new AbortError();
    if (this.unavailable) throw new TransportUnavailableError();
    // Register the wait before writing: a fast reply must not be missed.
    const reply = this.expect(step, kind, timeoutMs, signal);
    reply.catch(() => undefined); // rejected during `send`, before we return it
    try {
      await send();
    } catch (error) {
      this.failPending(
        error instanceof TransportUnavailableError ? error : new TransportUnavailableError(),
      );
    }
    return reply;
  }

  private expect(
    step: HandshakeStep,
    kind: DecodedFrame["kind"],
    timeoutMs: number,
    signal: AbortSignalLike | undefined,
  ): Promise<DecodedFrame> {
    return new Promise<DecodedFrame>((resolve, reject) => {
      const onAbort = () => this.failPending(new AbortError());
      const timer = setTimeout(
        () => this.failPending(new HandshakeTimeoutError(step, timeoutMs)),
        timeoutMs,
      );
      signal?.addEventListener("abort", onAbort);
      this.pending = {
        kind,
        resolve,
        reject,
        cleanup: () => {
          clearTimeout(timer);
          signal?.removeEventListener("abort", onAbort);
        },
      };
    });
  }

  private failPending(error: Error): void {
    const pending = this.pending;
    if (pending === null) return;
    this.pending = null;
    pending.cleanup();
    pending.reject(error);
  }

  private onFrame(frame: Uint8Array): void {
    const pending = this.pending;
    if (pending === null) return;
    let decoded: DecodedFrame;
    try {
      decoded = decodeFrame(frame);
    } catch (error) {
      if (error instanceof MalformedFrameError) this.failPending(error);
      else throw error;
      return;
    }
    if (decoded.kind !== pending.kind) return;
    this.pending = null;
    pending.cleanup();
    pending.resolve(decoded);
  }

  private onTransportDisconnect(): void {
    this.unavailable = true;
    this.failPending(new TransportUnavailableError());
    for (const listener of [...this.disconnectListeners]) listener();
  }
}
