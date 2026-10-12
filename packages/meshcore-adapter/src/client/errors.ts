/** The link is gone (or was never usable): a transport disconnect, a failed write, or a closed client. */
export class TransportUnavailableError extends Error {
  override readonly name = "TransportUnavailableError";

  constructor(message = "Companion link unavailable") {
    super(message);
  }
}

export type HandshakeStep = "deviceQuery" | "appStart";

/** The companion did not answer a handshake step within its bound (cause unknown). */
export class HandshakeTimeoutError extends Error {
  override readonly name = "HandshakeTimeoutError";

  constructor(
    readonly step: HandshakeStep,
    readonly timeoutMs: number,
  ) {
    super(`No response to ${step} within ${timeoutMs} ms`);
  }
}

/** The caller's `AbortSignal` fired. */
export class AbortError extends Error {
  override readonly name = "AbortError";

  constructor() {
    super("Aborted");
  }
}

export type ContactsStage = "start" | "idle" | "total";

/**
 * The contact sync stopped getting frames: no `contactsStart` (`start`), silence between frames
 * (`idle`), or the whole sync took too long (`total`). Cause unknown.
 */
export class ContactsTimeoutError extends Error {
  override readonly name = "ContactsTimeoutError";

  constructor(
    readonly stage: ContactsStage,
    readonly received: number,
    readonly expected: number | null,
  ) {
    super(`Contact sync timed out (${stage}) after ${received} of ${expected ?? "?"} contacts`);
  }
}

/** The companion answered a command with an error frame. */
export class CommandRejectedError extends Error {
  override readonly name = "CommandRejectedError";

  constructor(readonly code?: number) {
    super(code === undefined ? "Command rejected" : `Command rejected (code ${code})`);
  }
}

export type BusyActivity = "handshake" | "contacts" | "diagnostic";

/** Another request is in flight on this client; the radio takes one at a time. */
export class BusyError extends Error {
  override readonly name = "BusyError";

  constructor(readonly activity: BusyActivity) {
    super("busy");
  }
}

/** The node was asked less than the cooldown ago; nothing was sent (FR-10 AC2). */
export class CooldownError extends Error {
  override readonly name = "CooldownError";

  constructor(readonly remainingMs: number) {
    super(`Node was asked recently; wait ${remainingMs} ms`);
  }
}
