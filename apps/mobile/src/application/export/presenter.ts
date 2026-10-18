import { exportManifest } from "@guardian/domain";

import type { Text } from "../nodes/presenter";
import type { ExportState } from "./export-controller";

export type FieldList =
  { kind: "columns"; names: string[] } | { kind: "groups"; groups: { group: string; keys: string[] }[] };

export interface ExportPreview {
  /** Shown when a read or the node lookup failed; no counts and no empty notice then. */
  problem: Text | null;
  range: Text | null;
  counts: Text | null;
  /** "No runs recorded in this range" only after a successful read (lesson on empty data). */
  emptyNotice: Text | null;
  fields: FieldList;
  redactions: Text[];
  neverIncluded: Text[];
  shareDisabled: boolean;
  /** Result of the last share attempt, when it did not go through. */
  shareProblem: Text | null;
}

const REDACTION: Record<string, Text> = {
  PUBLIC_KEYS_PREFIX: { key: "export.redactionPrefix" },
  PUBLIC_KEYS_FULL: { key: "export.redactionFull" },
};

const NEVER: Record<string, Text> = {
  CREDENTIALS: { key: "export.neverCredentials" },
  RAW_FRAMES: { key: "export.neverRawFrames" },
};

const SHARE_PROBLEMS: Partial<Record<ExportState["share"], Text>> = {
  unavailable: { key: "export.shareUnavailable" },
  failed: { key: "export.createFailed" },
};

/** Texts as catalog keys for the export screen (FR-13 AC2). Fields come from the serialiser's constants. */
export function exportPreview(state: ExportState, formatTime: (ms: number) => string): ExportPreview {
  const manifest = exportManifest(state.format, state.redactKeys);
  const fields: FieldList =
    manifest.format === "csv"
      ? { kind: "columns", names: manifest.fields }
      : { kind: "groups", groups: manifest.fields };
  const base = {
    fields,
    redactions: manifest.redactions.map((r) => REDACTION[r]!),
    neverIncluded: manifest.neverIncluded.map((n) => NEVER[n]!),
    shareProblem: SHARE_PROBLEMS[state.share] ?? null,
  };
  if (state.status === "error")
    return {
      ...base,
      problem: { key: "export.readFailed" },
      range: null,
      counts: null,
      emptyNotice: null,
      shareDisabled: true,
    };
  if (state.status === "notFound")
    return {
      ...base,
      problem: { key: "nodes.notFound" },
      range: null,
      counts: null,
      emptyNotice: null,
      shareDisabled: true,
    };
  const input = state.input;
  if (!state.loaded || input === null)
    return {
      ...base,
      problem: null,
      range: null,
      counts: null,
      emptyNotice: null,
      shareDisabled: true,
    };
  const runs = input.runs.length;
  return {
    ...base,
    problem: null,
    range: {
      key: "export.range",
      params: { from: formatTime(input.range.from), to: formatTime(input.range.to) },
    },
    counts: { key: "export.counts", params: { runs, samples: input.samples.length } },
    emptyNotice: runs === 0 ? { key: "export.empty" } : null,
    shareDisabled: runs === 0 || state.share === "sharing",
  };
}
