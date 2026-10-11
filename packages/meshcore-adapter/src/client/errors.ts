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
