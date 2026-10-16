import type { TelemetrySample } from "./samples";

export interface TelemetryRepository {
  /** The samples of the newest run of the node that has any, ordered by `checkSeq`; `[]` when none. */
  latestForNode(publicKey: string): Promise<TelemetrySample[]>;
}
