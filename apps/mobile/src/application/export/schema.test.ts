import { describe, expect, it } from "vitest";

import { exportReportSchema } from "./schema";

declare global {
  interface ImportMeta {
    glob(pattern: string, options: object): Record<string, string>;
  }
}

const golden = import.meta.glob("../../../../../packages/domain/src/export/golden/*.json", {
  query: "?raw",
  import: "default",
  eager: true,
});

const load = (name: string) => {
  const path = Object.keys(golden).find((p) => p.endsWith(`/${name}`));
  if (path === undefined) throw new Error(`missing golden file ${name}`);
  return JSON.parse(golden[path]!) as Json;
};

/** A parsed golden file, loosely typed so a test can break one field. */
type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const FULL_KEY = `ab12cd34${"e5f60718".repeat(7)}`;

describe("exportReportSchema (plan D-8)", () => {
  it("accepts both golden JSON files", () => {
    expect(exportReportSchema.safeParse(load("report-redacted.json")).success).toBe(true);
    expect(exportReportSchema.safeParse(load("report-full.json")).success).toBe(true);
  });

  it("rejects a full key in a file that claims prefix redaction", () => {
    const report = load("report-redacted.json");
    report.node.public_key = FULL_KEY;
    expect(exportReportSchema.safeParse(report).success).toBe(false);
    const companion = load("report-redacted.json");
    companion.runs[0].companion.public_key = FULL_KEY;
    expect(exportReportSchema.safeParse(companion).success).toBe(false);
  });

  it("rejects a prefix in a file that claims full keys", () => {
    const report = load("report-full.json");
    report.node.public_key = FULL_KEY.slice(0, 8);
    expect(exportReportSchema.safeParse(report).success).toBe(false);
    const companion = load("report-full.json");
    companion.runs[0].companion.public_key = FULL_KEY.slice(0, 8);
    expect(exportReportSchema.safeParse(companion).success).toBe(false);
  });

  it("accepts a run stored without a companion identity (null key)", () => {
    const report = load("report-redacted.json");
    expect(report.runs.some((r: Json) => r.companion.public_key === null)).toBe(true);
    expect(exportReportSchema.safeParse(report).success).toBe(true);
  });

  it("rejects unknown keys at the root, the node, a run, a check and a sample", () => {
    const mutate: ((r: Json) => void)[] = [
      (r) => (r.extra = 1),
      (r) => (r.node.password = "x"),
      (r) => (r.runs[0].evidence = {}),
      (r) => (r.runs[0].checks[0].lppHex = "00"),
      (r) => (r.runs[0].telemetry[0].raw = "00"),
    ];
    for (const apply of mutate) {
      const report = load("report-redacted.json");
      apply(report);
      expect(exportReportSchema.safeParse(report).success).toBe(false);
    }
  });

  it("rejects a wrong schema version and a malformed time", () => {
    const version = load("report-redacted.json");
    version.schema_version = 2;
    expect(exportReportSchema.safeParse(version).success).toBe(false);
    const time = load("report-redacted.json");
    time.generated_at = "yesterday";
    expect(exportReportSchema.safeParse(time).success).toBe(false);
  });
});
