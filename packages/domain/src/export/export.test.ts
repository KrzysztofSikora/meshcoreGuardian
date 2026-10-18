import { describe, expect, it } from "vitest";

import { runResponded } from "./fixtures";
import * as fx from "./fixtures";
import { EXPORT_FORMATS, JSON_FIELDS, exportKey, exportManifest } from "./redact";
import { EXPORT_SCHEMA_VERSION, buildReport, type ExportInput } from "./report";
import { CSV_COLUMNS, toCsv, toJson } from "./serialize";

// Vite resolves this at transform time; the domain compiles without Node or Vite client types.
declare global {
  interface ImportMeta {
    glob(
      pattern: string,
      options: { eager: true; query: "?raw"; import: "default" },
    ): Record<string, string>;
  }
}

// The golden files were generated once from the fixtures and checked by hand against their values.
const goldenFiles = import.meta.glob("./golden/*", {
  eager: true,
  query: "?raw",
  import: "default",
});
const golden = (name: string): string => {
  const text = goldenFiles[`./golden/${name}`];
  if (text === undefined) throw new Error(`missing golden file ${name}`);
  return text;
};

// Built per call, not at module load: Stryker cannot switch a mutant on for code that runs on import.
const redacted = () => buildReport(fx.input, { redactKeys: true });
const full = () => buildReport(fx.input, { redactKeys: false });
const withInput = (over: Partial<ExportInput>) => ({ ...fx.input, ...over });

const csvRows = (csv: string): string[] => csv.split("\r\n").slice(0, -1);

describe("golden files (TR-10)", () => {
  it.each([
    ["report-redacted.json", () => toJson(redacted())],
    ["report-redacted.csv", () => toCsv(redacted())],
    ["report-full.json", () => toJson(full())],
    ["report-full.csv", () => toCsv(full())],
  ])("%s matches the serialiser", (name, actual) => {
    expect(actual()).toBe(golden(name));
  });
});

describe("redaction (FR-13 AC3, TR-10)", () => {
  it("keeps no 64-hex key in either output by default", () => {
    for (const out of [toJson(redacted()), toCsv(redacted())]) {
      expect(out).not.toMatch(/[0-9a-f]{64}/);
      expect(out).toContain(fx.NODE_KEY.slice(0, 8));
      expect(out).toContain(fx.COMPANION_KEY.slice(0, 8));
    }
    expect(redacted().node.public_key).toHaveLength(8);
    expect(redacted().redaction.public_keys).toBe("prefix");
  });

  it("shows both full keys when redaction is off", () => {
    for (const out of [toJson(full()), toCsv(full())]) {
      expect(out).toContain(fx.NODE_KEY);
      expect(out).toContain(fx.COMPANION_KEY);
    }
    expect(full().redaction.public_keys).toBe("full");
  });

  it("exportKey cuts to 4 bytes of hex or passes the key through", () => {
    expect(exportKey(fx.NODE_KEY, true)).toBe("ab12cd34");
    expect(exportKey(fx.NODE_KEY, false)).toBe(fx.NODE_KEY);
  });

  it("exports a run without a companion identity as null / an empty cell", () => {
    for (const r of [redacted(), full()]) {
      expect(r.runs[2]?.companion).toEqual({ public_key: null, name: "", firmware_version: "" });
    }
  });
});

describe("schema_version", () => {
  it("is in the JSON and in every CSV row", () => {
    expect(JSON.parse(toJson(redacted())).schema_version).toBe(EXPORT_SCHEMA_VERSION);
    const rows = csvRows(toCsv(redacted())).slice(1);
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(row.startsWith(`${EXPORT_SCHEMA_VERSION},`)).toBe(true);
    expect(csvRows(toCsv(redacted()))[0]?.startsWith("schema_version,")).toBe(true);
  });
});

describe("CSV format", () => {
  const nodeWith = (over: Partial<ExportInput["node"]>) =>
    toCsv(buildReport(withInput({ node: { ...fx.node, ...over } }), { redactKeys: true }));

  it("uses CRLF, a header and a trailing line end", () => {
    const csv = toCsv(redacted());
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(csv.replaceAll("\r\n", "")).not.toMatch(/[\r\n]/);
    expect(csvRows(csv)[0]).toBe(CSV_COLUMNS.join(","));
  });

  it("quotes commas, quotes and line breaks, and nothing else", () => {
    const csv = nodeWith({ reportedName: 'a,b "c"\r\nd', userLabel: "plain" });
    expect(csv).toContain('"a,b ""c""\r\nd",plain,');
  });

  it.each(["=SUM(A1)", "+1", "-1", "@x", "\tx", "\rx"])("prefixes a text cell starting %j", (s) => {
    const csv = nodeWith({ reportedName: s, userLabel: null });
    expect(csv).toContain(`'${s}`.includes("\r") ? `"'${s}"` : `'${s}`);
  });

  it("leaves other text alone and numbers untouched", () => {
    const rows = csvRows(nodeWith({ reportedName: "Hill-top = 1", userLabel: null }));
    expect(rows[1]).toContain(",Hill-top = 1,,");
    expect(rows[1]).toContain(",-34,last_hop,");
    expect(rows[1]).not.toContain("'-34");
  });

  it("writes null as an empty cell", () => {
    const row = csvRows(toCsv(redacted()))[2];
    expect(row).toContain(",NO_REPLY,2,2,c0ffee11,Desk companion,1.9.0,,,,,,,,login=");
    expect(row?.split(",").length).toBe(CSV_COLUMNS.length + 1 /* the quoted name has a comma */);
  });

  it("takes the noise floor by name, not the first extra reading", () => {
    const withTemp = {
      ...fx.samples[0]!,
      extra: [
        { name: "temperature", value: 30, unit: "°C", channel: 1 },
        { name: "noise_floor", value: -111, unit: "dBm", channel: null },
      ],
    };
    const csv = toCsv(
      buildReport(withInput({ runs: [runResponded], samples: [withTemp] }), { redactKeys: true }),
    );
    const cells = csvRows(csv)[1]!.split(",");
    expect(cells[CSV_COLUMNS.indexOf("noise_floor_dbm") + 1]).toBe("-111");
  });

  it("takes each telemetry column from the first sample that has it (D-2)", () => {
    const first = { ...fx.samples[0]!, checkSeq: 1, voltageV: null, uptimeS: 5 };
    const second = { ...fx.samples[0]!, checkSeq: 2, voltageV: 3.1, uptimeS: 7 };
    const csv = toCsv(
      buildReport(withInput({ runs: [runResponded], samples: [second, first] }), {
        redactKeys: true,
      }),
    );
    const cells = csvRows(csv)[1]!.split(",");
    expect(cells[CSV_COLUMNS.indexOf("voltage_v") + 1]).toBe("3.1");
    expect(cells[CSV_COLUMNS.indexOf("uptime_s") + 1]).toBe("5");
  });
});

describe("buildReport", () => {
  it("sorts runs oldest first and breaks ties by id", () => {
    expect(redacted().runs.map((r) => r.id)).toEqual([1, 2, 3]);
    const tied = [
      { ...fx.runNoResponse, id: 9, finishedAt: 5 },
      { ...fx.runResponded, id: 4, finishedAt: 5 },
      { ...fx.runNoCompanion, id: 6, finishedAt: 1 },
    ];
    const r = buildReport(withInput({ runs: tied, samples: [] }), { redactKeys: true });
    expect(r.runs.map((x) => x.id)).toEqual([6, 4, 9]);
    const reversed = buildReport(withInput({ runs: [...tied].reverse(), samples: [] }), {
      redactKeys: true,
    });
    expect(reversed.runs.map((x) => x.id)).toEqual([6, 4, 9]);
  });

  it("writes a node never heard and a check never started as null, not as the epoch", () => {
    const never = { ...fx.node, lastHeardAt: null };
    const run = { ...runResponded, checks: [{ ...runResponded.checks[0]!, startedAt: null }] };
    const r = buildReport(withInput({ node: never, runs: [run], samples: [] }), {
      redactKeys: true,
    });
    expect(r.node.last_heard_at).toBeNull();
    expect(r.runs[0]?.checks[0]?.started_at).toBeNull();
  });

  it("exports an unsaved run (no id) with no telemetry even when samples carry run ids", () => {
    const { id: _id, ...unsaved } = runResponded;
    const r = buildReport(withInput({ runs: [unsaved], samples: fx.samples }), {
      redactKeys: true,
    });
    expect(r.runs[0]?.id).toBeNull();
    expect(r.runs[0]?.telemetry).toEqual([]);
  });

  it("attaches samples by run id, ordered by checkSeq, and drops orphans", () => {
    expect(redacted().runs[0]?.telemetry.map((t) => t.check_seq)).toEqual([1, 2]);
    expect(redacted().runs[1]?.telemetry).toEqual([]);
    expect(redacted().runs[2]?.telemetry).toHaveLength(1);
    const orphan = { ...fx.samples[0]!, runId: 99 };
    const unsaved = { ...fx.samples[0]!, runId: null };
    const r = buildReport(withInput({ samples: [orphan, unsaved] }), { redactKeys: true });
    expect(r.runs.every((run) => run.telemetry.length === 0)).toBe(true);
    const shuffled = buildReport(withInput({ samples: [...fx.samples].reverse() }), {
      redactKeys: true,
    });
    expect(shuffled.runs[0]?.telemetry.map((t) => t.check_seq)).toEqual([1, 2]);
  });

  it("exports the effective role next to the reported one", () => {
    const r = buildReport(withInput({ node: { ...fx.node, userRole: "room_server" } }), {
      redactKeys: true,
    });
    expect(r.node.role).toBe("room_server");
    expect(r.node.reported_role).toBe("repeater");
  });

  it("never exports evidence, raw bytes or a password flag (D-5)", () => {
    for (const out of [toJson(full()), toCsv(full())]) {
      expect(out).not.toMatch(/evidence|lppHex|0167011e|passwordSent|password_sent/i);
    }
    expect(JSON.stringify(full())).not.toContain('"hex"');
  });
});

describe("manifest (FR-13 AC2)", () => {
  it("lists the CSV columns of the serialiser", () => {
    const m = exportManifest("csv", true);
    expect(m.fields).toEqual([...CSV_COLUMNS]);
  });

  it("lists the JSON groups with exactly the keys of a built report", () => {
    const m = exportManifest("json", true);
    expect(m.fields).toEqual(JSON_FIELDS.map((g) => ({ group: g.group, keys: [...g.keys] })));
    const keys = (o: object) => Object.keys(o);
    const run = full().runs[0]!;
    const groups = Object.fromEntries(JSON_FIELDS.map((g) => [g.group, g.keys]));
    expect(groups["report"]).toEqual(keys(full()));
    expect(groups["node"]).toEqual(keys(full().node));
    expect(groups["runs"]).toEqual(keys(run));
    expect(groups["runs[].companion"]).toEqual(keys(run.companion));
    expect(groups["runs[].checks"]).toEqual(keys(run.checks[0]!));
    expect(groups["runs[].telemetry"]).toEqual(keys(run.telemetry[0]!));
  });

  it("follows the redaction flag and always names what is never included", () => {
    for (const format of EXPORT_FORMATS) {
      expect(exportManifest(format, true).redactions).toEqual(["PUBLIC_KEYS_PREFIX"]);
      expect(exportManifest(format, false).redactions).toEqual(["PUBLIC_KEYS_FULL"]);
      expect(exportManifest(format, true).neverIncluded).toEqual(["CREDENTIALS", "RAW_FRAMES"]);
    }
  });
});
