// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- the ambient declaration must travel with the source to consumers
/// <reference path="../types/timers.d.ts" />
import {
  advertisedPosition,
  attemptTimeout,
  contactLastHeard,
  continuesAfter,
  cooldownRemainingAt,
  shouldRetry,
  assertAttempts,
  type CheckEvidence,
  type CheckKind,
  type CheckOutcome,
  type CompanionInfo,
  type ContactReport,
  type DiagnosticPolicy,
  type ReasonCode,
  type ResultCode,
} from "@guardian/domain";

import { COMPANION_PROTOCOL_VERSION, MeshCoreConnection } from "../connection/mesh-core-connection";
import { decodeFrame, type DecodedFrame } from "../decode/decode-frame";
import { MalformedFrameError } from "../decode/errors";
import type { MeshTransport, Unsubscribe } from "../transport/mesh-transport";

import { RemoteRequestLedger } from "./request-ledger";
import {
  AbortError,
  BusyError,
  CommandRejectedError,
  CooldownError,
  ContactsTimeoutError,
  HandshakeTimeoutError,
  TransportUnavailableError,
  type BusyActivity,
  type HandshakeStep,
} from "./errors";

/** Plan D-4: the first step covers the Android pairing dialog, the second is a plain reply. */
export const DEVICE_QUERY_TIMEOUT_MS = 30_000;
export const APP_START_TIMEOUT_MS = 5_000;
/**
 * Plan D-11: the companion answers `contactsStart` at once; after that only contact frames
 * count. The recorded sync has a 4.9 s gap while the companion handled LoRa traffic, hence 15 s.
 */
export const CONTACTS_START_TIMEOUT_MS = 5_000;
export const CONTACTS_IDLE_TIMEOUT_MS = 15_000;
export const CONTACTS_TOTAL_TIMEOUT_MS = 120_000;
/** Plan D-5: the companion confirms a remote request with `sent` within ~200 ms in every capture. */
export const SENT_TIMEOUT_MS = 5_000;

const KEY_PREFIX_HEX = 12;
/** Reply push codes per check (login success and fail share a check). */
const REPLY_CODES: Record<CheckKind, readonly number[]> = {
  login: [0x85, 0x86],
  status: [0x87],
  telemetry: [0x8b],
};
const MALFORMED_HEX_BYTES = 64;

/** The part of `AbortSignal` we use; the adapter compiles without DOM or Node types. A real signal fits. */
export interface AbortSignalLike {
  readonly aborted: boolean;
  addEventListener(type: "abort", listener: () => void): void;
  removeEventListener(type: "abort", listener: () => void): void;
}

export interface MeshClientOptions {
  deviceQueryTimeoutMs?: number;
  appStartTimeoutMs?: number;
  contactsStartTimeoutMs?: number;
  contactsIdleTimeoutMs?: number;
  contactsTotalTimeoutMs?: number;
  sentTimeoutMs?: number;
  /** Shared across clients of a session so a reconnect cannot bypass the cooldown (plan D-7). */
  ledger?: RemoteRequestLedger;
  now?: () => number;
}

export interface CheckProgress {
  check: CheckKind;
  attempt: number;
  of: number;
}

export interface RunChecksRequest {
  /** The target node, 64 hex characters. */
  publicKey: string;
  checks: readonly CheckKind[];
  password: string;
  policy: DiagnosticPolicy;
  signal?: AbortSignalLike;
  /** Fires before each write. */
  onProgress?: (progress: CheckProgress) => void;
}

export interface ContactsResult {
  contacts: ContactReport[];
  /** The count the companion announced in `contactsStart`. */
  expected: number;
}

/** The one request in flight: gets every decoded frame, and is told how it ended. */
interface Pending {
  onFrame: (frame: DecodedFrame) => void;
  reject: (error: Error) => void;
  cleanup: () => void;
  /** Decides whether a malformed frame concerns this request; without it, any malformed frame fails it. */
  onMalformed?: ((frame: Uint8Array) => void) | undefined;
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
  private readonly contactsStartTimeoutMs: number;
  private readonly contactsIdleTimeoutMs: number;
  private readonly contactsTotalTimeoutMs: number;
  private readonly sentTimeoutMs: number;
  private readonly ledger: RemoteRequestLedger;
  private readonly now: () => number;
  private pending: Pending | null = null;
  private busy: BusyActivity | null = null;
  private unavailable = false;

  constructor(
    private readonly transport: MeshTransport,
    options: MeshClientOptions = {},
  ) {
    this.deviceQueryTimeoutMs = options.deviceQueryTimeoutMs ?? DEVICE_QUERY_TIMEOUT_MS;
    this.appStartTimeoutMs = options.appStartTimeoutMs ?? APP_START_TIMEOUT_MS;
    this.contactsStartTimeoutMs = options.contactsStartTimeoutMs ?? CONTACTS_START_TIMEOUT_MS;
    this.contactsIdleTimeoutMs = options.contactsIdleTimeoutMs ?? CONTACTS_IDLE_TIMEOUT_MS;
    this.contactsTotalTimeoutMs = options.contactsTotalTimeoutMs ?? CONTACTS_TOTAL_TIMEOUT_MS;
    this.sentTimeoutMs = options.sentTimeoutMs ?? SENT_TIMEOUT_MS;
    this.ledger = options.ledger ?? new RemoteRequestLedger();
    this.now = options.now ?? Date.now;
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
    if (this.busy !== null) throw new BusyError(this.busy);
    this.busy = "handshake";
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
        position: advertisedPosition(self.lat, self.lon),
      };
    } finally {
      this.busy = null;
    }
  }

  /**
   * `CMD_GET_CONTACTS` without `since`: `contactsStart`, the contact frames, `endOfContacts`
   * (plan D-11). Returns what arrived; the caller compares `expected` with the number received.
   * Frames of other kinds are ignored and do not reset the idle bound. No retry.
   */
  async getContacts({ signal }: { signal?: AbortSignalLike } = {}): Promise<ContactsResult> {
    if (this.busy !== null) throw new BusyError(this.busy);
    if (signal?.aborted) throw new AbortError();
    if (this.unavailable) throw new TransportUnavailableError();
    this.busy = "contacts";
    try {
      const reply = this.collectContacts(signal);
      reply.catch(() => undefined); // rejected during `write`, before we return it
      try {
        await this.connection.sendCommandGetContacts();
      } catch (error) {
        this.failPending(
          error instanceof TransportUnavailableError ? error : new TransportUnavailableError(),
        );
      }
      return await reply;
    } finally {
      this.busy = null;
    }
  }

  /**
   * Remote checks against one node, in order, on this companion link (plan D-2, D-10). Resolves
   * with one outcome per executed check and stops after the first that did not reply, a rejected
   * login, or an abort. Throws only `BusyError`, `CooldownError` (nothing was sent) or
   * `TransportUnavailableError` (the client is closed). A silent attempt is repeated up to
   * `policy.attempts` times; every other outcome is evidence and is never retried (D-6).
   */
  async runChecks(request: RunChecksRequest): Promise<CheckOutcome[]> {
    if (this.busy !== null) throw new BusyError(this.busy);
    assertAttempts(request.policy.attempts);
    attemptTimeout({ estimateMs: null, overrideMs: request.policy.overrideMs }); // rejects a bad override
    if (this.unavailable) throw new TransportUnavailableError();
    const remaining = cooldownRemainingAt(this.ledger.lastAt(request.publicKey), this.now());
    if (remaining > 0) throw new CooldownError(remaining);
    this.busy = "diagnostic";
    const outcomes: CheckOutcome[] = [];
    try {
      for (const kind of request.checks) {
        if (request.signal?.aborted) break;
        const outcome = this.unavailable
          ? emptyOutcome(kind, "TRANSPORT_UNAVAILABLE", "LINK_LOST")
          : await this.runCheck(kind, request);
        outcomes.push(outcome);
        if (!continuesAfter(outcome)) break;
      }
      return outcomes;
    } finally {
      this.busy = null;
    }
  }

  private runCheck(kind: CheckKind, request: RunChecksRequest): Promise<CheckOutcome> {
    const { signal, policy } = request;
    const prefix = request.publicKey.slice(0, KEY_PREFIX_HEX).toLowerCase();
    const key = hexToBytes(request.publicKey);
    const startedAt = this.now();
    return new Promise<CheckOutcome>((resolve) => {
      let attempts = 0;
      let phase: "sent" | "reply" = "sent";
      let timeout: { ms: number; source: "estimate" | "default" | "override" } | null = null;
      let timer: ReturnType<typeof setTimeout> | undefined;

      const finish = (
        result: ResultCode,
        reason: ReasonCode,
        evidence: CheckEvidence | null = null,
      ) => {
        this.finishPending();
        resolve({
          kind,
          result,
          reason,
          attempts,
          timeoutMs: timeout?.ms ?? null,
          timeoutSource: timeout?.source ?? null,
          startedAt,
          durationMs: this.now() - startedAt,
          evidence,
        });
      };
      const arm = (ms: number, onTimeout: () => void) => {
        clearTimeout(timer);
        timer = setTimeout(onTimeout, ms);
      };
      const write = (): Promise<void> => {
        if (kind === "login") return this.connection.sendCommandSendLogin(key, request.password);
        if (kind === "status") return this.connection.sendCommandSendStatusReq(key);
        return this.connection.sendCommandSendTelemetryReq(key);
      };
      const attempt = () => {
        attempts += 1;
        phase = "sent";
        request.onProgress?.({ check: kind, attempt: attempts, of: policy.attempts });
        arm(this.sentTimeoutMs, () => finish("TRANSPORT_UNAVAILABLE", "COMPANION_NO_ACK"));
        this.ledger.record(request.publicKey, this.now());
        write().catch(() => finish("TRANSPORT_UNAVAILABLE", "LINK_LOST"));
      };

      this.setPending(
        (error) => {
          if (error instanceof AbortError) finish("NOT_TESTED", "CANCELLED");
          else if (error instanceof TransportUnavailableError) {
            finish("TRANSPORT_UNAVAILABLE", "LINK_LOST");
          } else finish("NOT_TESTED", "UNEXPECTED_ERROR");
        },
        signal,
        () => clearTimeout(timer),
        (frame) => {
          if (frame.kind === "err" && phase === "sent") {
            finish("UNSUPPORTED", "COMMAND_REJECTED", {
              kind: "rejected",
              code: frame.code ?? null,
            });
          } else if (frame.kind === "sent" && phase === "sent") {
            phase = "reply";
            timeout = attemptTimeout({
              estimateMs: frame.estTimeoutMs,
              overrideMs: policy.overrideMs,
            });
            arm(timeout.ms, () => {
              if (shouldRetry("NO_REPLY", attempts, policy.attempts)) attempt();
              else finish("NO_RESPONSE", "NO_REPLY");
            });
          } else if (kind === "login" && frame.kind === "loginFail" && frame.keyPrefix === prefix) {
            finish("RESPONDED", "LOGIN_REJECTED");
          } else if (
            kind === "login" &&
            frame.kind === "loginSuccess" &&
            frame.keyPrefix === prefix
          ) {
            finish("RESPONDED", "ALL_CHECKS_REPLIED", {
              kind: "login",
              permissions: frame.permissions,
              aclPermissions: frame.aclPermissions ?? null,
              firmwareLevel: frame.firmwareLevel ?? null,
              passwordSent: request.password !== "",
            });
          } else if (
            kind === "status" &&
            frame.kind === "statusResponse" &&
            frame.keyPrefix === prefix
          ) {
            finish("RESPONDED", "ALL_CHECKS_REPLIED", { kind: "status", ...frame.stats });
          } else if (
            kind === "telemetry" &&
            frame.kind === "telemetryResponse" &&
            frame.keyPrefix === prefix
          ) {
            finish("RESPONDED", "ALL_CHECKS_REPLIED", {
              kind: "telemetry",
              values: frame.values,
              lppHex: frame.lppHex,
            });
          }
        },
        (raw) => {
          // Plan D-9: only a frame the check is waiting for can fail it.
          if (raw[0] === undefined || !REPLY_CODES[kind].includes(raw[0])) return;
          finish("UNSUPPORTED", "MALFORMED_RESPONSE", {
            kind: "malformed",
            code: raw[0],
            length: raw.length,
            hex: bytesToHex(raw.subarray(0, MALFORMED_HEX_BYTES)),
          });
        },
      );
      attempt();
    });
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
      const timer = setTimeout(
        () => this.failPending(new HandshakeTimeoutError(step, timeoutMs)),
        timeoutMs,
      );
      this.setPending(
        reject,
        signal,
        () => clearTimeout(timer),
        (frame) => {
          if (frame.kind !== kind) return;
          this.finishPending();
          resolve(frame);
        },
      );
    });
  }

  private collectContacts(signal: AbortSignalLike | undefined): Promise<ContactsResult> {
    return new Promise<ContactsResult>((resolve, reject) => {
      const contacts: ContactReport[] = [];
      let expected: number | null = null;
      let idleTimer: ReturnType<typeof setTimeout> | undefined;
      const timeout = (stage: "start" | "idle" | "total") => () =>
        this.failPending(new ContactsTimeoutError(stage, contacts.length, expected));
      const armIdle = (ms: number, stage: "start" | "idle") => {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(timeout(stage), ms);
      };
      armIdle(this.contactsStartTimeoutMs, "start");
      const totalTimer = setTimeout(timeout("total"), this.contactsTotalTimeoutMs);
      this.setPending(
        reject,
        signal,
        () => {
          clearTimeout(idleTimer);
          clearTimeout(totalTimer);
        },
        (frame) => {
          if (frame.kind === "err") {
            this.failPending(new CommandRejectedError(frame.code));
          } else if (frame.kind === "contactsStart") {
            expected = frame.count;
            armIdle(this.contactsIdleTimeoutMs, "idle");
          } else if (expected === null) {
            return; // nothing counts before `contactsStart`
          } else if (frame.kind === "contact") {
            contacts.push({
              publicKey: frame.publicKey,
              name: frame.name,
              type: frame.type,
              lastHeardAt: contactLastHeard(frame.lastMod),
              pathHops: frame.path.kind === "known" ? frame.path.hops : null,
              position: advertisedPosition(frame.lat, frame.lon),
            });
            armIdle(this.contactsIdleTimeoutMs, "idle");
          } else if (frame.kind === "endOfContacts") {
            this.finishPending();
            resolve({ contacts, expected });
          }
        },
      );
    });
  }

  /** Registers the single in-flight request with its abort listener. */
  private setPending(
    reject: (error: Error) => void,
    signal: AbortSignalLike | undefined,
    clean: () => void,
    onFrame: (frame: DecodedFrame) => void,
    onMalformed?: (frame: Uint8Array) => void,
  ): void {
    const onAbort = () => this.failPending(new AbortError());
    signal?.addEventListener("abort", onAbort);
    this.pending = {
      onFrame,
      reject,
      onMalformed,
      cleanup: () => {
        clean();
        signal?.removeEventListener("abort", onAbort);
      },
    };
  }

  private finishPending(): void {
    const pending = this.pending;
    this.pending = null;
    pending?.cleanup();
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
      if (!(error instanceof MalformedFrameError)) throw error;
      if (pending.onMalformed === undefined) this.failPending(error);
      else pending.onMalformed(frame);
      return;
    }
    pending.onFrame(decoded);
  }

  private onTransportDisconnect(): void {
    this.unavailable = true;
    this.failPending(new TransportUnavailableError());
    for (const listener of [...this.disconnectListeners]) listener();
  }
}

function emptyOutcome(kind: CheckKind, result: ResultCode, reason: ReasonCode): CheckOutcome {
  return {
    kind,
    result,
    reason,
    attempts: 0,
    timeoutMs: null,
    timeoutSource: null,
    startedAt: null,
    durationMs: null,
    evidence: null,
  };
}

function hexToBytes(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/../g) ?? [], (pair) => parseInt(pair, 16));
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
