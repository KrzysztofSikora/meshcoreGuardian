import { describe, expect, it } from "vitest";

import { licenseRows, type Notice } from "./licenses-presenter";

const notice = (name: string, over: Partial<Notice> = {}): Notice => ({
  name,
  version: "1.0.0",
  license: "MIT",
  text: `Licence of ${name}`,
  source: "npm",
  ...over,
});

describe("licenseRows (D-4)", () => {
  it("puts meshcore.js, then IBM Plex, before the alphabetical rest", () => {
    const rows = licenseRows([
      notice("zod"),
      notice("IBM Plex", { source: "asset" }),
      notice("abbrev"),
      notice("@liamcottle/meshcore.js"),
    ]);
    expect(rows.map((row) => row.name)).toEqual(["@liamcottle/meshcore.js", "IBM Plex", "abbrev", "zod"]);
  });

  it("sorts versions of the same package numerically and keys rows by name and version", () => {
    const rows = licenseRows([
      notice("pkg", { version: "10.0.0" }),
      notice("pkg", { version: "2.0.0" }),
    ]);
    expect(rows.map((row) => row.id)).toEqual(["pkg@2.0.0", "pkg@10.0.0"]);
  });

  it("keeps the notice text and flags no missing text", () => {
    const [row] = licenseRows([notice("a")]);
    expect(row).toMatchObject({ name: "a", version: "1.0.0", license: "MIT", text: "Licence of a", missing: null });
  });

  it("explains a missing text with the licence id", () => {
    const [row] = licenseRows([notice("a", { text: null, license: "ISC" })]);
    expect(row?.text).toBeNull();
    expect(row?.missing).toEqual({ key: "licenses.textMissing", params: { id: "ISC" } });
  });

  it("does not change the input order", () => {
    const input = [notice("b"), notice("a")];
    licenseRows(input);
    expect(input.map((n) => n.name)).toEqual(["b", "a"]);
  });
});
