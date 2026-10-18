import { CSV_COLUMNS, type ExportInput } from "@guardian/domain";
import { describe, expect, it } from "vitest";

import type { ExportState } from "./export-controller";
import { exportPreview } from "./presenter";

const fmt = (ms: number) => `t${ms}`;

const input = (runs: number, samples = 0): ExportInput => ({
  node: {} as ExportInput["node"],
  runs: Array.from({ length: runs }, () => ({}) as ExportInput["runs"][number]),
  samples: Array.from({ length: samples }, () => ({}) as ExportInput["samples"][number]),
  range: { from: 1000, to: 2000 },
  generatedAt: 2000,
  generatedBy: "test",
});

const state = (over: Partial<ExportState> = {}): ExportState => ({
  publicKey: "k",
  days: 30,
  format: "json",
  redactKeys: true,
  status: "ok",
  loaded: true,
  input: input(3, 5),
  share: "idle",
  ...over,
});

describe("exportPreview (FR-13 AC2)", () => {
  it("shows the range, the counts and an enabled Share button", () => {
    const preview = exportPreview(state(), fmt);
    expect(preview.range).toEqual({ key: "export.range", params: { from: "t1000", to: "t2000" } });
    expect(preview.counts).toEqual({ key: "export.counts", params: { runs: 3, samples: 5 } });
    expect(preview.emptyNotice).toBeNull();
    expect(preview.shareDisabled).toBe(false);
    expect(preview.problem).toBeNull();
  });

  it("lists the CSV columns exactly and the JSON groups for JSON", () => {
    expect(exportPreview(state({ format: "csv" }), fmt).fields).toEqual({
      kind: "columns",
      names: [...CSV_COLUMNS],
    });
    const json = exportPreview(state({ format: "json" }), fmt).fields;
    expect(json.kind).toBe("groups");
    if (json.kind === "groups") expect(json.groups.map((g) => g.group)).toContain("runs[].checks");
  });

  it("the redaction line follows the flag", () => {
    expect(exportPreview(state({ redactKeys: true }), fmt).redactions).toEqual([
      { key: "export.redactionPrefix" },
    ]);
    expect(exportPreview(state({ redactKeys: false }), fmt).redactions).toEqual([
      { key: "export.redactionFull" },
    ]);
  });

  it("always says credentials are never exported", () => {
    for (const s of [
      state(),
      state({ status: "error" }),
      state({ status: "loading", loaded: false, input: null }),
      state({ input: input(0) }),
    ])
      expect(exportPreview(s, fmt).neverIncluded).toContainEqual({
        key: "export.neverCredentials",
      });
  });

  it("the empty notice appears only after a successful read and disables Share", () => {
    const empty = exportPreview(state({ input: input(0) }), fmt);
    expect(empty.emptyNotice).toEqual({ key: "export.empty" });
    expect(empty.shareDisabled).toBe(true);
    const loading = exportPreview(state({ status: "loading", loaded: false, input: null }), fmt);
    expect(loading.emptyNotice).toBeNull();
    expect(loading.counts).toBeNull();
    expect(loading.shareDisabled).toBe(true);
  });

  it("a failed read shows the problem, no counts and no empty notice, even with older data", () => {
    const preview = exportPreview(state({ status: "error" }), fmt);
    expect(preview.problem).toEqual({ key: "export.readFailed" });
    expect(preview.counts).toBeNull();
    expect(preview.emptyNotice).toBeNull();
    expect(preview.shareDisabled).toBe(true);
  });

  it("an unknown node shows the existing not-found text", () => {
    const preview = exportPreview(state({ status: "notFound", loaded: false, input: null }), fmt);
    expect(preview.problem).toEqual({ key: "nodes.notFound" });
    expect(preview.shareDisabled).toBe(true);
  });

  it("disables Share while sharing and names the share problems without a cause", () => {
    expect(exportPreview(state({ share: "sharing" }), fmt).shareDisabled).toBe(true);
    expect(exportPreview(state({ share: "unavailable" }), fmt)).toMatchObject({
      shareProblem: { key: "export.shareUnavailable" },
      shareDisabled: false,
    });
    expect(exportPreview(state({ share: "failed" }), fmt).shareProblem).toEqual({
      key: "export.createFailed",
    });
    expect(exportPreview(state({ share: "idle" }), fmt).shareProblem).toBeNull();
  });
});
