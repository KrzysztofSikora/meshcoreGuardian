import type { CheckOutcome } from "./check";
import type { Limitation } from "./classify";
import type { ReasonCode } from "./reason-code";
import type { ResultCode } from "./result-code";

/** The companion that ran the check, as it was when the run happened. */
export interface RunCompanion {
  publicKey: string;
  name: string;
  firmwareVersion: string;
}

/** One diagnostic run against a node. Times are epoch ms. */
export interface DiagnosticRun {
  id?: number;
  nodePublicKey: string;
  companion: RunCompanion;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  /** Requests actually written, summed over all checks. */
  attemptsUsed: number;
  /** The configured attempts allowed per check. */
  attemptsPerCheck: number;
  result: ResultCode;
  reason: ReasonCode;
  limitations: Limitation[];
  checks: CheckOutcome[];
}

export interface DiagnosticRunRepository {
  save(run: DiagnosticRun): Promise<number>;
  get(id: number): Promise<DiagnosticRun | null>;
  /** The newest run per node; `checks` is empty. */
  latestPerNode(): Promise<Map<string, DiagnosticRun>>;
}
