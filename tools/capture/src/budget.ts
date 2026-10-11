/** Time source for the capture; tests pass a fake one. */
export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export type BudgetKind = "handshake" | "sync" | "login" | "status" | "telemetry";

/** Requests per run (plan D-8): one handshake and contact sync, at most two of each remote kind. */
export const RUN_LIMITS: Readonly<Record<BudgetKind, number>> = {
  handshake: 1,
  sync: 1,
  login: 2,
  status: 2,
  telemetry: 2,
};

/** Minimum time between two requests to the same remote node (radio hygiene, TR-23). */
export const NODE_SPACING_MS = 60_000;

export class BudgetExceededError extends Error {
  override readonly name = "BudgetExceededError";

  constructor(readonly kind: BudgetKind) {
    super(`Request budget exceeded: at most ${RUN_LIMITS[kind]} ${kind} per capture run`);
  }
}

/**
 * Enforces the per-run request limits and the spacing between requests to one node. Remote
 * requests are counted when granted, whether or not the node answers.
 */
export class RequestBudget {
  private readonly used = new Map<BudgetKind, number>();
  /** Node key → the time its last granted request may be sent. */
  private readonly lastSent = new Map<string, number>();

  constructor(private readonly clock: Clock) {}

  /**
   * Grants one request of `kind` and returns how long to wait before sending it, so that it goes
   * out at least `NODE_SPACING_MS` after the previous request to `nodeKey`. Throws
   * `BudgetExceededError` when the run has used up `kind`.
   */
  take(kind: BudgetKind, nodeKey?: string): number {
    const used = this.used.get(kind) ?? 0;
    if (used >= RUN_LIMITS[kind]) throw new BudgetExceededError(kind);
    this.used.set(kind, used + 1);
    if (nodeKey === undefined) return 0;
    const now = this.clock.now();
    const previous = this.lastSent.get(nodeKey);
    const wait = previous === undefined ? 0 : Math.max(0, previous + NODE_SPACING_MS - now);
    this.lastSent.set(nodeKey, now + wait);
    return wait;
  }

  /** `take`, then sleeps for the returned wait. */
  async acquire(kind: BudgetKind, nodeKey?: string): Promise<void> {
    const wait = this.take(kind, nodeKey);
    if (wait > 0) await this.clock.sleep(wait);
  }
}
