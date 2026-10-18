import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");
const readJson = (file: string) => JSON.parse(readFileSync(path.join(root, file), "utf8"));
const require = createRequire(import.meta.url);

const eas = readJson("eas.json");
const expo = readJson("app.json").expo;

describe("eas.json", () => {
  it("builds an app bundle with remote versioning and auto increment", () => {
    expect(eas.cli.appVersionSource).toBe("remote");
    expect(eas.build.production.autoIncrement).toBe(true);
    expect(eas.build.production.android.buildType).toBe("app-bundle");
  });

  it("pins the Node version EAS builds with to the repo's engine", () => {
    expect(eas.build.production.node).toMatch(/^24\./);
    expect(eas.build.preview.node).toBe(eas.build.production.node);
  });

  it("uses the real BLE transport in production", () => {
    expect(eas.build.production.env ?? {}).not.toHaveProperty("EXPO_PUBLIC_TRANSPORT");
  });

  it("submits to the internal track as a draft without a committed key", () => {
    const android = eas.submit.production.android;
    expect(android.track).toBe("internal");
    expect(android.releaseStatus).toBe("draft");
    expect(JSON.stringify(eas)).not.toContain("serviceAccountKeyPath");
  });
});

describe("app.json", () => {
  it("has a release version", () => {
    expect(expo.version).toBe("0.1.0");
  });

  it("blocks the permissions the app does not use", () => {
    expect(expo.android.blockedPermissions).toEqual([
      "android.permission.SYSTEM_ALERT_WINDOW",
      "android.permission.VIBRATE",
      "android.permission.READ_EXTERNAL_STORAGE",
      "android.permission.WRITE_EXTERNAL_STORAGE",
      "android.permission.USE_BIOMETRIC",
      "android.permission.USE_FINGERPRINT",
    ]);
  });

  it("registers the release-only INTERNET removal plugin", () => {
    expect(expo.plugins).toContain("./plugins/with-release-no-internet");
  });
});

describe("with-release-no-internet plugin", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("writes a release-variant manifest that removes INTERNET", () => {
    const { writeReleaseManifest } = require("../../plugins/with-release-no-internet.js");
    const projectRoot = mkdtempSync(path.join(tmpdir(), "guardian-plugin-"));
    dirs.push(projectRoot);

    writeReleaseManifest(path.join(projectRoot, "android"));

    const file = path.join(projectRoot, "android/app/src/release/AndroidManifest.xml");
    const xml = readFileSync(file, "utf8");
    expect(xml).toContain('xmlns:tools="http://schemas.android.com/tools"');
    expect(xml).toContain('android:name="android.permission.INTERNET"');
    expect(xml).toContain('tools:node="remove"');
    expect(existsSync(path.join(projectRoot, "android/app/src/main/AndroidManifest.xml"))).toBe(
      false,
    );
    expect(existsSync(path.join(projectRoot, "android/app/src/debug"))).toBe(false);
  });
});
