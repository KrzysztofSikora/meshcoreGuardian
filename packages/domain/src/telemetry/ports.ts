import type { TelemetrySample } from "./samples";
import type { VoltageReading } from "./voltage";

export interface TelemetryRepository {
  /** The samples of the newest run of the node that has any, ordered by `checkSeq`; `[]` when none. */
  latestForNode(publicKey: string): Promise<TelemetrySample[]>;
  /**
   * Every non-null voltage reading of the node's newest `runs` runs that have one, ordered by
   * `measuredAt`, then run id, then check order. Newest = latest voltage reading of the run, ties
   * by the higher run id. `[]` for an unknown node.
   */
  voltageForNode(publicKey: string, runs: number): Promise<VoltageReading[]>;
}
