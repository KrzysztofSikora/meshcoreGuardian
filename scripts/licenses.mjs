#!/usr/bin/env node
// Writes apps/mobile/src/licenses/notices.json: the licence notices of every JS package that ships
// in the Android bundle, plus the native-only dependencies and the bundled IBM Plex fonts (plan D-3).
//   pnpm licenses:generate
// The package list comes from the source map of `expo export`, so build tooling that never reaches
// the bundle is left out. Native Android libraries (AndroidX, Hermes, ...) are not covered.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const app = join(repo, "apps/mobile");
const outFile = join(app, "src/licenses/notices.json");

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));

/** Workspace packages are our own code and carry no third-party notice. */
const workspaceNames = new Set(
  readdirSync(join(repo, "packages")).map((dir) => readJson(join(repo, "packages", dir, "package.json")).name),
);

function bundledPackageDirs() {
  const out = mkdtempSync(join(tmpdir(), "guardian-licences-"));
  try {
    execFileSync("pnpm", ["exec", "expo", "export", "--platform", "android", "--source-maps", "--output-dir", out], {
      cwd: app,
      stdio: ["ignore", "ignore", "inherit"],
    });
    const jsDir = join(out, "_expo/static/js/android");
    const maps = readdirSync(jsDir).filter((file) => file.endsWith(".map"));
    if (maps.length === 0) throw new Error("expo export produced no source map");
    const dirs = new Map();
    for (const map of maps) {
      for (const source of readJson(join(jsDir, map)).sources) {
        const marker = source.lastIndexOf("node_modules/");
        if (marker < 0) continue;
        const rest = source.slice(marker + "node_modules/".length).split("/");
        const name = rest[0].startsWith("@") ? `${rest[0]}/${rest[1]}` : rest[0];
        const dir = join(repo, source.slice(0, marker), "node_modules", name);
        if (!dirs.has(dir)) dirs.set(dir, name);
      }
    }
    return dirs;
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

/** Native-only modules are not in the JS bundle; take them from the `dependencies` fields. */
function declaredPackageDirs() {
  const dirs = new Map();
  const owners = [app, ...readdirSync(join(repo, "packages")).map((dir) => join(repo, "packages", dir))];
  for (const owner of owners) {
    const deps = readJson(join(owner, "package.json")).dependencies ?? {};
    for (const [name, range] of Object.entries(deps)) {
      if (String(range).startsWith("workspace:")) continue;
      dirs.set(join(owner, "node_modules", name), name);
    }
  }
  return dirs;
}

const LICENCE_FILE = /^(licen[cs]e|copying)(\.|-|$)/i;
const NOTICE_FILE = /^notice(\.|$)/i;

const readMatching = (dir, pattern) =>
  readdirSync(dir)
    .filter((file) => pattern.test(file))
    .sort()
    .map((file) => readFileSync(join(dir, file), "utf8").trim());

function licenceId(pkg) {
  if (typeof pkg.license === "string") return pkg.license;
  if (pkg.license && typeof pkg.license.type === "string") return pkg.license.type;
  if (Array.isArray(pkg.licenses)) return pkg.licenses.map((l) => l.type).join(" OR ");
  return "UNKNOWN";
}

function noticeFor(dir) {
  const real = realpathSync(dir);
  const pkg = readJson(join(real, "package.json"));
  const texts = [...readMatching(real, LICENCE_FILE), ...readMatching(real, NOTICE_FILE)];
  return {
    name: pkg.name,
    version: pkg.version,
    license: licenceId(pkg),
    text: texts.length === 0 ? null : texts.join("\n\n"),
    source: "npm",
  };
}

const dirs = new Map([...bundledPackageDirs(), ...declaredPackageDirs()]);
const notices = new Map();
for (const [dir, name] of dirs) {
  if (workspaceNames.has(name) || !existsSync(dir)) continue;
  const notice = noticeFor(dir);
  notices.set(`${notice.name}@${notice.version}`, notice);
}

notices.set("IBM Plex@fonts", {
  name: "IBM Plex",
  version: "fonts",
  license: "OFL-1.1",
  text: readFileSync(join(app, "assets/fonts/OFL.txt"), "utf8").trim(),
  source: "asset",
});

const sorted = [...notices.values()].sort(
  (a, b) => a.name.localeCompare(b.name, "en") || a.version.localeCompare(b.version, "en", { numeric: true }),
);
writeFileSync(outFile, `${JSON.stringify(sorted, null, 2)}\n`);
console.log(`licenses: wrote ${sorted.length} notices to ${outFile}`);
