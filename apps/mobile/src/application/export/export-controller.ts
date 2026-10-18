import type {
  DiagnosticRunRepository,
  ExportFormat,
  ExportInput,
  NodeRepository,
  TelemetryRepository,
} from "@guardian/domain";
import { buildReport, keyPrefix, toCsv, toJson } from "@guardian/domain";
import { createStore, type StoreApi } from "zustand/vanilla";

import type { ExportFilePort } from "./ports";
import { exportReportSchema } from "./schema";

export const EXPORT_DAYS = [7, 30, 90] as const;
export type ExportDays = (typeof EXPORT_DAYS)[number];

export const DEFAULT_EXPORT_DAYS: ExportDays = 30;

const DAY_MS = 86_400_000;

export type ShareState = "idle" | "sharing" | "unavailable" | "failed";

export interface ExportState {
  publicKey: string | null;
  days: ExportDays;
  format: ExportFormat;
  redactKeys: boolean;
  status: "loading" | "ok" | "notFound" | "error";
  /** True once a read succeeded; counts and the empty notice are real data only then. */
  loaded: boolean;
  input: ExportInput | null;
  share: ShareState;
}

export interface ExportPorts {
  nodes: () => Promise<NodeRepository>;
  runs: () => Promise<DiagnosticRunRepository>;
  telemetry: () => Promise<TelemetryRepository>;
  files: ExportFilePort;
  clock: () => number;
  /** The "shorten public keys" default (plan D-10); each open starts from it. */
  redactionDefault: () => Promise<boolean>;
  generatedBy: string;
}

const MIME: Record<ExportFormat, string> = { json: "application/json", csv: "text/csv" };

const day = (ms: number): string => new Date(ms).toISOString().slice(0, 10).replaceAll("-", "");

/** File name for an export (plan D-11): never more than the key prefix, whatever the switch says. */
export function exportFileName(publicKey: string, range: ExportInput["range"], format: ExportFormat) {
  return `guardian-${keyPrefix(publicKey)}-${day(range.from)}-${day(range.to)}.${format}`;
}

/**
 * Reads a node's runs for a range, previews the export and hands the file to the share port
 * (FR-13). Read-only apart from the file; no timers, no radio.
 */
export class ExportController {
  readonly store: StoreApi<ExportState> = createStore<ExportState>(() => this.initial(null));

  private seq = 0;
  private opening: Promise<void> | null = null;
  private openingKey: string | null = null;

  constructor(private readonly ports: ExportPorts) {}

  getState(): ExportState {
    return this.store.getState();
  }

  /**
   * Idempotent for the same key, so a remount keeps the user's choices (lesson). A new key resets
   * them to the defaults. After an error the same key reads again.
   */
  open(publicKey: string): Promise<void> {
    // The pending key is recorded synchronously: `state.publicKey` is set only after an await.
    if (this.openingKey === publicKey && this.opening !== null) return this.opening;
    const state = this.getState();
    if (state.publicKey === publicKey && state.status !== "error")
      return this.opening ?? Promise.resolve();
    this.openingKey = publicKey;
    const opening: Promise<void> = this.begin(publicKey).finally(() => {
      if (this.opening === opening) {
        this.opening = null;
        this.openingKey = null;
      }
    });
    this.opening = opening;
    return opening;
  }

  /** Ends a visit: the next `open` starts from the defaults and reads again (plan D-10). */
  close(): void {
    this.seq++;
    this.opening = null;
    this.openingKey = null;
    this.store.setState(this.initial(null));
  }

  async setDays(days: ExportDays): Promise<void> {
    const { publicKey } = this.getState();
    if (publicKey === null) return;
    this.store.setState({ days });
    await this.read(publicKey, days);
  }

  setFormat(format: ExportFormat): void {
    this.store.setState({ format });
  }

  setRedactKeys(redactKeys: boolean): void {
    this.store.setState({ redactKeys });
  }

  /** Builds, validates and shares the file for the choices at the time of the call. */
  async share(): Promise<void> {
    // Capture everything now: the screen may change the format while the share is in flight.
    const { input, format, redactKeys, share, status } = this.getState();
    if (status !== "ok" || input === null || input.runs.length === 0 || share === "sharing")
      return;
    this.store.setState({ share: "sharing" });
    try {
      const report = buildReport(input, { redactKeys });
      const parsed = exportReportSchema.safeParse(report);
      if (!parsed.success) {
        this.store.setState({ share: "failed" });
        return;
      }
      const content = format === "json" ? toJson(report) : toCsv(report);
      if (!(await this.ports.files.available())) {
        this.store.setState({ share: "unavailable" });
        return;
      }
      await this.ports.files.share({
        name: exportFileName(input.node.publicKey, input.range, format),
        mimeType: MIME[format],
        content,
      });
      this.store.setState({ share: "idle" });
    } catch {
      // Neutral: the cause (disk, share sheet) is not known here (plan D-12).
      this.store.setState({ share: "failed" });
    }
  }

  private initial(publicKey: string | null, redactKeys = true): ExportState {
    return {
      publicKey,
      days: DEFAULT_EXPORT_DAYS,
      format: "json",
      redactKeys,
      status: "loading",
      loaded: false,
      input: null,
      share: "idle",
    };
  }

  private async begin(publicKey: string): Promise<void> {
    const token = ++this.seq;
    let redactKeys = true;
    try {
      redactKeys = await this.ports.redactionDefault();
    } catch {
      // Redaction on is the safe default when the setting cannot be read.
    }
    // `close()` during the await bumped `seq`: this visit is over.
    if (token !== this.seq) return;
    this.seq++;
    this.store.setState(this.initial(publicKey, redactKeys));
    await this.read(publicKey, DEFAULT_EXPORT_DAYS);
  }

  private async read(publicKey: string, days: ExportDays): Promise<void> {
    const seq = ++this.seq;
    const before = this.getState();
    // Keep the previous preview while re-reading; the counts stay tied to a real read.
    this.store.setState({
      status: before.loaded ? "ok" : "loading",
      share: "idle",
    });
    try {
      const to = this.ports.clock();
      const range = { from: to - days * DAY_MS, to };
      const [nodes, runRepo, telemetry] = await Promise.all([
        this.ports.nodes(),
        this.ports.runs(),
        this.ports.telemetry(),
      ]);
      const node = await nodes.get(publicKey);
      if (node === null) {
        if (seq === this.seq) this.store.setState({ status: "notFound", loaded: false, input: null });
        return;
      }
      const runs = await runRepo.forNodeBetween(publicKey, range.from, range.to);
      const samples = await telemetry.forRuns(
        runs.flatMap((run) => (run.id === undefined ? [] : [run.id])),
      );
      // A newer read started meanwhile: its result wins.
      if (seq !== this.seq) return;
      this.store.setState({
        status: "ok",
        loaded: true,
        input: {
          node,
          runs,
          samples,
          range,
          generatedAt: to,
          generatedBy: this.ports.generatedBy,
        },
      });
    } catch {
      if (seq === this.seq) this.store.setState({ status: "error" });
    }
  }
}
