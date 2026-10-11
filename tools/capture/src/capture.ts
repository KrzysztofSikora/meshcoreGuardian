import {
  COMPANION_PROTOCOL_VERSION,
  decodeFrame,
  type DecodedFrame,
  type FixtureRequest,
  type MeshCoreConnection,
  type MeshTransport,
  type RequestKind,
  type RequestOutcome,
} from "@guardian/meshcore-adapter";

import type { Clock, RequestBudget } from "./budget";
import { fromHex } from "./hex";

export type Scenario = "handshake" | "remote";
export const SCENARIOS: readonly Scenario[] = ["handshake", "remote"];

// Caps (D-7, D-16). The app's 30 s cap belongs to MeshClient (S-04).
/** Device query, app start, the first contacts frame and the SENT/ERR of a remote request. */
export const COMPANION_REPLY_TIMEOUT_MS = 5_000;
/** Longest gap between two frames of the contact sync before the run gives up. */
export const CONTACT_IDLE_TIMEOUT_MS = 5_000;
/** A remote reply may arrive up to `estTimeout + REPLY_MARGIN_MS`, but never after `REPLY_CAP_MS`. */
export const REPLY_MARGIN_MS = 5_000;
export const REPLY_CAP_MS = 45_000;

export type AbortReason =
  | "transport_disconnected"
  | "transport_error"
  | "device_query_no_response"
  | "app_start_no_response"
  | "contacts_no_response"
  | "contacts_error"
  | "contact_sync_stalled"
  | "target_not_in_contacts"
  | "target_ambiguous";

export interface CaptureDeps {
  /** Sends the commands (meshcore.js is the codec). */
  connection: MeshCoreConnection;
  /** The link the connection writes to; the run reads the replies from it. */
  link: Pick<MeshTransport, "onFrame" | "onDisconnect">;
  budget: RequestBudget;
  clock: Clock;
  /** Hex public key prefix of the only node the run may contact (D-6). */
  targetPrefix: string;
  /** Never logged or returned. */
  guestPassword: string;
  log: (line: string) => void;
}

export interface CaptureResult {
  requests: FixtureRequest[];
  aborted?: AbortReason;
}

class CaptureAborted extends Error {
  constructor(readonly reason: AbortReason) {
    super(reason);
  }
}

type Contact = Extract<DecodedFrame, { kind: "contact" }>;
type Match = (frame: DecodedFrame) => boolean;

interface Pending {
  match: Match;
  resolve: (frame: DecodedFrame | undefined) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Decoded replies from the link. Frames nobody waits for are queued, so a reply that arrives
 * before its waiter is registered is not lost; `clear` drops them before each new request.
 */
class Replies {
  private readonly queue: DecodedFrame[] = [];
  private pending: Pending | undefined;
  private lost = false;
  private readonly unsubscribes: (() => void)[];

  constructor(link: CaptureDeps["link"]) {
    this.unsubscribes = [
      link.onFrame((bytes) => this.receive(bytes)),
      link.onDisconnect(() => {
        this.lost = true;
        this.settle((pending) => pending.reject(new CaptureAborted("transport_disconnected")));
      }),
    ];
  }

  clear(): void {
    this.queue.length = 0;
  }

  /** Throws once the link is gone, so nothing is sent into a dead connection. */
  assertLinked(): void {
    if (this.lost) throw new CaptureAborted("transport_disconnected");
  }

  /** The next frame that matches, or `undefined` when none arrives within `ms`. */
  next(match: Match, ms: number): Promise<DecodedFrame | undefined> {
    if (this.lost) return Promise.reject(new CaptureAborted("transport_disconnected"));
    const index = this.queue.findIndex(match);
    if (index >= 0) return Promise.resolve(this.queue.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.settle((pending) => pending.resolve(undefined)), ms);
      this.pending = { match, resolve, reject, timer };
    });
  }

  dispose(): void {
    for (const unsubscribe of this.unsubscribes) unsubscribe();
    this.settle((pending) => pending.resolve(undefined));
  }

  private receive(bytes: Uint8Array): void {
    let frame: DecodedFrame;
    try {
      frame = decodeFrame(bytes);
    } catch {
      return; // The recorder keeps it with its decode error; it answers nothing here.
    }
    if (this.pending?.match(frame)) this.settle((pending) => pending.resolve(frame));
    else this.queue.push(frame);
  }

  private settle(action: (pending: Pending) => void): void {
    const pending = this.pending;
    if (pending === undefined) return;
    this.pending = undefined;
    clearTimeout(pending.timer);
    action(pending);
  }
}

const is =
  <K extends DecodedFrame["kind"]>(...kinds: K[]) =>
  (frame: DecodedFrame): frame is Extract<DecodedFrame, { kind: K }> =>
    (kinds as string[]).includes(frame.kind);

/** Which pushed frame answers a request of `kind` from `key`, and what it means. */
function replyOutcome(kind: RequestKind, key: string, frame: DecodedFrame): RequestOutcome | null {
  if (!("keyPrefix" in frame) || !key.startsWith(frame.keyPrefix)) return null;
  if (kind === "login" && frame.kind === "loginSuccess") return "responded";
  if (kind === "login" && frame.kind === "loginFail") return "rejected";
  if (kind === "status" && frame.kind === "statusResponse") return "responded";
  if (kind === "telemetry" && frame.kind === "telemetryResponse") return "responded";
  return null;
}

/**
 * Runs one capture scenario (D-8) and returns the remote request outcomes. `handshake` queries
 * the companion and reads its contact list without any LoRa transmission; `remote` then logs in
 * to the target as a guest and requests its status and telemetry, one request at a time, spaced
 * and limited by the budget. A request without a reply is tried once more. Status and telemetry
 * are requested whatever the login outcome: what a guest gets is part of the evidence.
 */
export async function runCapture(scenario: Scenario, deps: CaptureDeps): Promise<CaptureResult> {
  const replies = new Replies(deps.link);
  const requests: FixtureRequest[] = [];
  try {
    const contacts = await handshake(deps, replies);
    if (scenario === "remote") {
      const target = findTarget(contacts, deps);
      for (const kind of ["login", "status", "telemetry"] as const) {
        let result = await remoteRequest(kind, target, deps, replies);
        requests.push(result);
        if (result.outcome === "no_response") {
          result = await remoteRequest(kind, target, deps, replies);
          requests.push(result);
        }
      }
    }
    return { requests };
  } catch (error) {
    if (error instanceof CaptureAborted) {
      deps.log(`aborted: ${error.reason}`);
      return { requests, aborted: error.reason };
    }
    throw error;
  } finally {
    replies.dispose();
  }
}

/** Sends a command on a live link; a failed write means the link is unusable. */
async function send(replies: Replies, command: () => Promise<void>): Promise<void> {
  replies.assertLinked();
  try {
    await command();
  } catch (error) {
    if (error instanceof CaptureAborted) throw error;
    throw new CaptureAborted("transport_error");
  }
}

async function handshake(deps: CaptureDeps, replies: Replies): Promise<Contact[]> {
  const { connection, budget, log } = deps;
  budget.take("handshake");
  replies.clear();
  await send(replies, () => connection.sendCommandDeviceQuery(COMPANION_PROTOCOL_VERSION));
  const info = await replies.next(is("deviceInfo"), COMPANION_REPLY_TIMEOUT_MS);
  if (info?.kind !== "deviceInfo") throw new CaptureAborted("device_query_no_response");
  log(`device info: ${info.manufacturer} ${info.firmwareVersion} (${info.buildDate})`);

  await send(replies, () => connection.sendCommandAppStart());
  const self = await replies.next(is("selfInfo"), COMPANION_REPLY_TIMEOUT_MS);
  if (self === undefined) throw new CaptureAborted("app_start_no_response");

  budget.take("sync");
  await send(replies, () => connection.sendCommandGetContacts());
  const start = await replies.next(is("contactsStart", "err"), COMPANION_REPLY_TIMEOUT_MS);
  if (start === undefined) throw new CaptureAborted("contacts_no_response");
  if (start.kind !== "contactsStart") throw new CaptureAborted("contacts_error");
  const contacts: Contact[] = [];
  for (;;) {
    const frame = await replies.next(is("contact", "endOfContacts"), CONTACT_IDLE_TIMEOUT_MS);
    if (frame === undefined) throw new CaptureAborted("contact_sync_stalled");
    if (frame.kind !== "contact") break;
    contacts.push(frame);
  }
  log(`contacts: ${contacts.length} received, ${start.count} announced`);
  return contacts;
}

function findTarget(contacts: Contact[], { targetPrefix, log }: CaptureDeps): Contact {
  const matches = contacts.filter((contact) => contact.publicKey.startsWith(targetPrefix));
  if (matches.length === 0) throw new CaptureAborted("target_not_in_contacts");
  if (matches.length > 1) throw new CaptureAborted("target_ambiguous");
  const target = matches[0] as Contact;
  log(`target: ${target.publicKey.slice(0, 12)} "${target.name}" (type ${target.type})`);
  return target;
}

async function remoteRequest(
  kind: RequestKind,
  target: Contact,
  { connection, budget, clock, guestPassword, log }: CaptureDeps,
  replies: Replies,
): Promise<FixtureRequest> {
  const key = target.publicKey;
  await budget.acquire(kind, key);
  replies.clear();
  const startedAt = clock.now();
  const publicKey = fromHex(key);
  await send(replies, () =>
    kind === "login"
      ? connection.sendCommandSendLogin(publicKey, guestPassword)
      : kind === "status"
        ? connection.sendCommandSendStatusReq(publicKey)
        : connection.sendCommandSendTelemetryReq(publicKey),
  );

  const ack = await replies.next(is("sent", "err"), COMPANION_REPLY_TIMEOUT_MS);
  let result: FixtureRequest;
  if (ack === undefined) result = { kind, outcome: "no_response" };
  else if (ack.kind !== "sent") result = { kind, outcome: "error" };
  else {
    const estTimeoutMs = ack.estTimeoutMs;
    const cap = Math.min(estTimeoutMs + REPLY_MARGIN_MS, REPLY_CAP_MS);
    const reply = await replies.next((frame) => replyOutcome(kind, key, frame) !== null, cap);
    const outcome = reply && replyOutcome(kind, key, reply);
    result = outcome
      ? { kind, outcome, estTimeoutMs, latencyMs: Math.round(clock.now() - startedAt) }
      : { kind, outcome: "no_response", estTimeoutMs };
  }
  log(describeRequest(result));
  return result;
}

/** One line per request, for the log and the summary; no response is never called offline. */
export function describeRequest({
  kind,
  outcome,
  estTimeoutMs,
  latencyMs,
}: FixtureRequest): string {
  const text = outcome === "no_response" ? "No response — cause unknown" : outcome;
  const est = estTimeoutMs === undefined ? "" : `, estTimeout ${estTimeoutMs} ms`;
  const latency = latencyMs === undefined ? "" : `, latency ${latencyMs} ms`;
  return `${kind}: ${text}${est}${latency}`;
}
