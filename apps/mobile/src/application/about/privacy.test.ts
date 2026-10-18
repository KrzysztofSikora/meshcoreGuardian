import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import en from "../../i18n/en.json";
import { PRIVACY_SECTIONS, privacyBlocks } from "./privacy";

const doc = readFileSync(path.resolve(__dirname, "../../../../../docs/privacy-policy.md"), "utf8");
const catalog = en.privacy as Record<string, string>;

const textOf = (key: string): string => {
  const value = catalog[key.replace("privacy.", "")];
  if (value === undefined) throw new Error(`missing catalog key ${key}`);
  return value;
};

describe("privacyBlocks (D-5)", () => {
  it("has a heading and a paragraph for every section, after the effective line", () => {
    const blocks = privacyBlocks();
    expect(blocks).toHaveLength(1 + 2 * PRIVACY_SECTIONS);
    expect(blocks[0]).toEqual({ kind: "paragraph", text: { key: "privacy.effective" } });
    expect(blocks.filter((block) => block.kind === "heading")).toHaveLength(PRIVACY_SECTIONS);
  });

  it("uses every privacy.* catalog key except the title, exactly once", () => {
    const used = privacyBlocks().map((block) => block.text.key.replace("privacy.", ""));
    expect([...used].sort()).toEqual(Object.keys(catalog).filter((key) => key !== "title").sort());
  });

  it("appears verbatim and in order in docs/privacy-policy.md", () => {
    let from = 0;
    for (const block of privacyBlocks()) {
      const text = textOf(block.text.key);
      const needle = block.kind === "heading" ? `## ${text}` : text;
      const at = doc.indexOf(needle, from);
      expect(at, `"${needle}" in order`).toBeGreaterThanOrEqual(from);
      from = at + needle.length;
    }
  });
});

describe("docs/privacy-policy.md claims (D-12)", () => {
  it("states the behaviour the PRD requires", () => {
    expect(doc).toContain("makes no network requests");
    expect(doc).toContain("secure storage");
    expect(doc).toContain("delete the history of one node or clear all data");
    expect(doc).toContain("Uninstalling the app");
  });

  it("does not claim anything about the network permission", () => {
    expect(doc.toLowerCase()).not.toContain("permission");
    expect(doc).not.toContain("INTERNET");
  });
});
