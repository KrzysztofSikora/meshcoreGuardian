import {
  classifyRun,
  continuesAfter,
  cooldownRemaining,
  planChecks,
  type CheckKind,
  type CheckOutcome,
  type DiagnosticRun,
  type DiagnosticRunRepository,
  type Preflight,
  type ReasonCode,
  type ResultCode,
} from "@guardian/domain";
import { BusyError, CooldownError, TransportUnavailableError } from "@guardian/meshcore-adapter";
import { createStore, type StoreApi } from "zustand/vanilla";

import type { Text } from "../nodes/presenter";
import type { RunPorts } from "./ports";

export interface ActiveRun {
  publicKey: string;
  step: CheckKind;
  /** 0 until the first write. */
  attempt: number;
  of: number;
  startedAt: number;
}

export interface LastRun {
  publicKey: string;
  /** `null` when the run could not be saved. */
  runId: number | null;
  result: ResultCode;
  reason: ReasonCode;
}

export interface RunState {
  latest: Record<string, DiagnosticRun>;
  loaded: boolean;
  active: ActiveRun | null;
  /** The node whose airtime notice is waiting for a decision. */
  notice: string | null;
  last: LastRun | null;
  refusal: { publicKey: string; text: Text } | null;
  storage: "ok" | "error";
}

const INITIAL: RunState = {
  latest: {},
  loaded: false,
  active: null,
  notice: null,
  last: null,
  refusal: null,
  storage: "ok",
};

type CompanionInfo = DiagnosticRun["companion"];

const BUSY_TEXT: Text = { key: "diagnostic.refusal.busy" };
const SYNCING_TEXT: Text = { key: "diagnostic.refusal.syncing" };

/**
 * Starts, cancels and stores diagnostic runs (plan D-12 to D-16). A run starts only from `start`
 * or `confirmNotice`, i.e. from a tap; never from a timer and never in the background (FR-10 AC6).
 */
export class RunController {
  readonly store: StoreApi<RunState> = createStore<RunState>(() => INITIAL);

  private repo: Promise<DiagnosticRunRepository> | null = null;
  private loading: Promise<void> | null = null;
  private running = false;
  private abort: AbortController | null = null;

  constructor(private readonly ports: RunPorts) {}

  getState(): RunState {
    return this.store.getState();
  }

  /** Reads the newest run per node once; later calls return the same work. */
  load(): Promise<void> {
    this.loading ??= this.reload();
    return this.loading;
  }

  /** The stored run with its checks, or `null`. */
  async get(id: number): Promise<DiagnosticRun | null> {
    const repository = await this.open();
    return repository === null ? null : repository.get(id).catch(() => null);
  }

  /**
   * One tap on "Run diagnostic". The first one shows the airtime notice instead of sending.
   * Resolves when the run has ended.
   */
  async start(publicKey: string): Promise<void> {
    if (this.ports.appState.current() !== "active") return;
    if (this.running) return this.refuse(publicKey, BUSY_TEXT);
    this.running = true;
    let proceed = false;
    try {
      await this.load();
      if (this.refuseCooldown(publicKey)) return;
      if (!(await this.ports.notice.seen().catch(() => false))) {
        return this.set({ notice: publicKey, refusal: null });
      }
      proceed = true;
    } finally {
      if (!proceed) this.running = false;
    }
    await this.execute(publicKey);
  }

  /** "Run diagnostic" on the notice: remember it and run. */
  async confirmNotice(): Promise<void> {
    const publicKey = this.getState().notice;
    if (publicKey === null || this.ports.appState.current() !== "active") return;
    this.set({ notice: null });
    await this.ports.notice.markSeen().catch(() => undefined);
    if (this.running) return this.refuse(publicKey, BUSY_TEXT);
    this.running = true;
    await this.execute(publicKey);
  }

  /** "Not now": nothing is remembered, nothing is sent. */
  dismissNotice(): void {
    this.set({ notice: null });
  }

  /** Aborts the request in flight; the run is stored as cancelled. */
  cancel(): void {
    this.abort?.abort();
  }

  private async execute(publicKey: string): Promise<void> {
    const startedAt = this.ports.clock();
    const abort = new AbortController();
    this.abort = abort;
    this.set({ refusal: null, last: null });
    try {
      const session = this.ports.session.store.getState();
      // Read now: a link drop during the run clears the live state before `finish` runs (R1).
      const companion =
        session.connection.kind === "connected" ? session.connection.companion : null;
      const plan =
        companion !== null && session.capabilities !== null
          ? planChecks(session.capabilities)
          : null;
      if (plan === null) {
        return await this.finishPreflight(publicKey, startedAt, companion, "NOT_CONNECTED");
      }
      if ("unsupported" in plan) {
        return await this.finishPreflight(publicKey, startedAt, companion, "CAPABILITY_MISSING", [
          plan.unsupported,
        ]);
      }
      const policy = this.ports.policy();
      this.set({
        active: { publicKey, step: plan.run[0]!, attempt: 0, of: policy.attempts, startedAt },
      });
      let outcomes: CheckOutcome[];
      try {
        outcomes = await this.ports.session.runChecks({
          publicKey,
          checks: plan.run,
          password: await this.ports.password(publicKey),
          policy,
          signal: abort.signal,
          onProgress: ({ check, attempt, of }) =>
            this.set({ active: { publicKey, step: check, attempt, of, startedAt } }),
        });
      } catch (error) {
        if (error instanceof BusyError) {
          return this.refuse(publicKey, error.activity === "contacts" ? SYNCING_TEXT : BUSY_TEXT);
        }
        if (error instanceof CooldownError) return this.refuse(publicKey, cooldownText(error));
        if (error instanceof TransportUnavailableError) {
          return await this.finishPreflight(publicKey, startedAt, companion, "NOT_CONNECTED");
        }
        return await this.finishPreflight(publicKey, startedAt, companion, "UNEXPECTED_ERROR");
      }
      const completed =
        outcomes.length === plan.run.length && outcomes.every((outcome) => continuesAfter(outcome));
      // Skipped checks are kept only for a run that went through; an earlier stop hides them (D-2).
      const checks = completed ? [...outcomes, ...plan.skipped] : outcomes;
      const cancelled =
        abort.signal.aborted || checks.some((outcome) => outcome.reason === "CANCELLED");
      await this.finish(
        publicKey,
        startedAt,
        companion,
        checks,
        classifyRun(checks, { cancelled }),
      );
    } finally {
      this.abort = null;
      this.running = false;
      this.set({ active: null });
    }
  }

  private finishPreflight(
    publicKey: string,
    startedAt: number,
    companion: CompanionInfo | null,
    preflight: Preflight,
    checks: CheckOutcome[] = [],
  ): Promise<void> {
    return this.finish(
      publicKey,
      startedAt,
      companion,
      checks,
      classifyRun(checks, { cancelled: false, preflight }),
    );
  }

  private async finish(
    publicKey: string,
    startedAt: number,
    companion: CompanionInfo | null,
    checks: CheckOutcome[],
    classification: ReturnType<typeof classifyRun>,
  ): Promise<void> {
    const finishedAt = this.ports.clock();
    const identity = companion ?? { publicKey: "", name: "", firmwareVersion: "" };
    const run: DiagnosticRun = {
      nodePublicKey: publicKey,
      companion: {
        publicKey: identity.publicKey,
        name: identity.name,
        firmwareVersion: identity.firmwareVersion,
      },
      startedAt,
      finishedAt,
      durationMs: finishedAt - startedAt,
      attemptsUsed: checks.reduce((sum, check) => sum + check.attempts, 0),
      attemptsPerCheck: this.ports.policy().attempts,
      result: classification.result,
      reason: classification.reason,
      limitations: classification.limitations,
      checks,
    };
    const saved = await this.save(run);
    const stored = saved === null ? run : { ...run, id: saved };
    this.set({
      latest: { ...this.getState().latest, [publicKey]: stored },
      last: { publicKey, runId: saved, result: run.result, reason: run.reason },
    });
  }

  /** The new id, or `null` when storage failed; the result card then says "not saved". */
  private async save(run: DiagnosticRun): Promise<number | null> {
    const repository = await this.open();
    if (repository === null) return null;
    try {
      return await repository.save(run);
    } catch {
      this.set({ storage: "error" });
      return null;
    }
  }

  private refuseCooldown(publicKey: string): boolean {
    const remaining = cooldownRemaining(
      this.getState().latest[publicKey] ?? null,
      this.ports.clock(),
    );
    if (remaining <= 0) return false;
    this.set({ refusal: { publicKey, text: cooldownText({ remainingMs: remaining }) } });
    return true;
  }

  private refuse(publicKey: string, text: Text): void {
    this.set({ refusal: { publicKey, text } });
  }

  private async open(): Promise<DiagnosticRunRepository | null> {
    this.repo ??= this.ports.repository();
    try {
      return await this.repo;
    } catch {
      this.set({ storage: "error", loaded: true });
      return null;
    }
  }

  private async reload(): Promise<void> {
    const repository = await this.open();
    if (repository === null) return;
    try {
      const latest = await repository.latestPerNode();
      this.set({ latest: Object.fromEntries(latest), loaded: true, storage: "ok" });
    } catch {
      this.set({ storage: "error", loaded: true });
    }
  }

  private set(partial: Partial<RunState>): void {
    this.store.setState(partial);
  }
}

function cooldownText(error: { remainingMs: number }): Text {
  return {
    key: "diagnostic.refusal.cooldown",
    params: { seconds: Math.ceil(error.remainingMs / 1000) },
  };
}
