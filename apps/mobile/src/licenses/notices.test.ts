import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { Notice } from "../application/about/licenses-presenter";
import notices from "./notices.json";

const all = notices as Notice[];
const repo = join(__dirname, "../../../..");
const readJson = (file: string) => JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;

describe("notices.json (run `pnpm licenses:generate` after changing dependencies)", () => {
  it("lists meshcore.js under MIT with the copyright holder", () => {
    const entry = all.find((notice) => notice.name === "@liamcottle/meshcore.js");
    expect(entry?.license).toBe("MIT");
    expect(entry?.text).toContain("Liam Cottle");
  });

  it("lists IBM Plex with the OFL text from the font assets", () => {
    const entry = all.find((notice) => notice.name === "IBM Plex");
    expect(entry?.source).toBe("asset");
    expect(entry?.license).toBe("OFL-1.1");
    expect(entry?.text).toBe(
      readFileSync(join(repo, "apps/mobile/assets/fonts/OFL.txt"), "utf8").trim(),
    );
  });

  it("lists every declared dependency of the app and the workspace packages", () => {
    const owners = [
      join(repo, "apps/mobile"),
      ...readdirSync(join(repo, "packages")).map((dir) => join(repo, "packages", dir)),
    ];
    const missing: string[] = [];
    for (const owner of owners) {
      const deps = (readJson(join(owner, "package.json")).dependencies ?? {}) as Record<string, string>;
      for (const [name, range] of Object.entries(deps)) {
        if (range.startsWith("workspace:")) continue;
        if (!all.some((notice) => notice.name === name)) missing.push(name);
      }
    }
    expect(missing).toEqual([]);
  });

  it("has no empty text and no own workspace package", () => {
    expect(all.filter((notice) => notice.text !== null && notice.text.trim() === "")).toEqual([]);
    expect(all.filter((notice) => notice.name.startsWith("@guardian/"))).toEqual([]);
  });

  it("has unique name and version pairs and a licence id on every entry", () => {
    const keys = all.map((notice) => `${notice.name}@${notice.version}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(all.filter((notice) => notice.license === "")).toEqual([]);
  });
});
