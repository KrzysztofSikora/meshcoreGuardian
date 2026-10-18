import type {
  DiagnosticRun,
  DiagnosticRunRepository,
  TelemetryRepository,
  TelemetrySample,
  VoltagePoint,
} from "@guardian/domain";
import { voltagePoints } from "@guardian/domain";
import { createStore, type StoreApi } from "zustand/vanilla";

/** "Recent" runs on the node screen (D-9); paging can come later without a schema change. */
export const RECENT_RUNS = 50;

/** Newest runs with a voltage reading that feed the chart and the trend (D-2). */
export const VOLTAGE_RUNS = 50;

export interface NodeHistory {
  status: "loading" | "ok" | "error";
  /** True once a read succeeded; the other fields are real data only then, never defaults. */
  loaded: boolean;
  runs: DiagnosticRun[];
  lastRespondedAt: number | null;
  samples: TelemetrySample[];
  /** One point per run, oldest first (D-1). */
  voltage: VoltagePoint[];
}

export interface NodeHistoryState {
  byNode: Record<string, NodeHistory>;
}

export interface NodeHistoryPorts {
  runs: () => Promise<DiagnosticRunRepository>;
  telemetry: () => Promise<TelemetryRepository>;
}

const LOADING: NodeHistory = {
  status: "loading",
  loaded: false,
  runs: [],
  lastRespondedAt: null,
  samples: [],
  voltage: [],
};

/**
 * Reads what the node screen shows: recent runs, the last response, the latest telemetry
 * and the voltage history (D-12). Read-only and idempotent; no timers, no radio.
 */
export class NodeHistoryController {
  readonly store: StoreApi<NodeHistoryState> = createStore<NodeHistoryState>(() => ({
    byNode: {},
  }));

  private readonly inFlight = new Map<string, Promise<void>>();

  constructor(private readonly ports: NodeHistoryPorts) {}

  /** Concurrent calls for one node share one read. */
  load(publicKey: string): Promise<void> {
    const running = this.inFlight.get(publicKey);
    if (running !== undefined) return running;
    const read = this.read(publicKey).finally(() => this.inFlight.delete(publicKey));
    this.inFlight.set(publicKey, read);
    return read;
  }

  /** Drops cached history after a deletion; the next visit reads fresh data. `null` drops all. */
  forget(publicKey: string | null): void {
    this.store.setState((state) => {
      if (publicKey === null) return { byNode: {} };
      const { [publicKey]: _gone, ...rest } = state.byNode;
      return { byNode: rest };
    });
  }

  private async read(publicKey: string): Promise<void> {
    // Keep the previous data on screen while reloading; a first load starts empty.
    const before = this.store.getState().byNode[publicKey];
    this.put(publicKey, {
      ...(before ?? LOADING),
      status: before?.loaded === true ? "ok" : "loading",
    });
    try {
      const [runs, telemetry] = await Promise.all([this.ports.runs(), this.ports.telemetry()]);
      const [recent, lastRespondedAt, samples, readings] = await Promise.all([
        runs.recentForNode(publicKey, RECENT_RUNS),
        runs.lastRespondedAt(publicKey),
        telemetry.latestForNode(publicKey),
        telemetry.voltageForNode(publicKey, VOLTAGE_RUNS),
      ]);
      this.put(publicKey, {
        status: "ok",
        loaded: true,
        runs: recent,
        lastRespondedAt,
        samples,
        voltage: voltagePoints(readings),
      });
    } catch {
      // Neutral: the cause (corrupt row, closed database) is not known here.
      this.put(publicKey, { ...(before ?? LOADING), status: "error" });
    }
  }

  private put(publicKey: string, history: NodeHistory): void {
    this.store.setState((state) => ({ byNode: { ...state.byNode, [publicKey]: history } }));
  }
}
