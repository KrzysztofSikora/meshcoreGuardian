import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const eslint = new ESLint({ cwd: repoRoot });

/** Lints a one-line import as if it were written in `file` and returns the rule ids it hit. */
async function restrictedImportErrors(file: string, specifier: string): Promise<string[]> {
  const [result] = await eslint.lintText(`import "${specifier}";\n`, { filePath: file });
  if (!result) throw new Error(`ESLint returned no result for ${file}`);
  const fatal = result.messages.filter((message) => message.fatal);
  if (fatal.length > 0) throw new Error(`ESLint could not parse ${file}: ${fatal[0]?.message}`);
  return result.messages
    .filter((message) => message.ruleId === "no-restricted-imports")
    .map((message) => message.message);
}

const domainFile = "packages/domain/src/rules/sample.ts";
const adapterFile = "packages/meshcore-adapter/src/sample.ts";
const storageFile = "packages/storage/src/sample.ts";
const storageTestFile = "packages/storage/test/sample.int.test.ts";
const mobileFile = "apps/mobile/src/app/sample.tsx";
const mobileTestFile = "apps/mobile/src/application/nodes/sample.int.test.ts";
const captureFile = "tools/capture/src/sample.ts";

describe("layer rules (TR-22)", () => {
  it.each([
    [domainFile, "@guardian/storage"],
    [domainFile, "@guardian/meshcore-adapter"],
    [domainFile, "react"],
    [domainFile, "react/jsx-runtime"],
    [domainFile, "react-native"],
    [domainFile, "react-native-ble-plx"],
    [domainFile, "expo"],
    [domainFile, "expo-sqlite"],
    [domainFile, "@expo/vector-icons"],
    [domainFile, "@liamcottle/meshcore.js"],
    [domainFile, "node:fs"],
    [domainFile, "fs"],
    [domainFile, "fs/promises"],
    [domainFile, "crypto"],
    [domainFile, "node:sqlite"],
    [adapterFile, "@guardian/storage"],
    [adapterFile, "@guardian/domain/src/index"],
    [adapterFile, "react-native"],
    [adapterFile, "expo-secure-store"],
    [adapterFile, "node:sqlite"],
    [storageFile, "@guardian/meshcore-adapter"],
    [storageFile, "@guardian/domain/src/index"],
    [storageFile, "react-native"],
    [storageFile, "expo-sqlite"],
    [storageFile, "@liamcottle/meshcore.js"],
    [storageFile, "node:sqlite"],
    [storageTestFile, "react"],
    [storageTestFile, "@guardian/meshcore-adapter"],
    [mobileFile, "@guardian/domain/src/diagnostics/result-code"],
    [mobileFile, "@liamcottle/meshcore.js"],
    [mobileFile, "node:sqlite"],
    [mobileFile, "@guardian/storage/testing"],
    [mobileTestFile, "@guardian/domain/src/diagnostics/result-code"],
    [mobileTestFile, "@liamcottle/meshcore.js"],
    [mobileTestFile, "node:sqlite"],
    [captureFile, "@liamcottle/meshcore.js"],
    [captureFile, "@guardian/storage"],
    [captureFile, "@guardian/meshcore-adapter/src/decode/decode-frame"],
    [captureFile, "react-native"],
    [captureFile, "expo"],
    [captureFile, "node:sqlite"],
  ])("%s may not import %s", async (file, specifier) => {
    expect(await restrictedImportErrors(file, specifier)).toHaveLength(1);
  });

  it.each([
    [domainFile, "./reaction-table"],
    [domainFile, "../expo-like-name"],
    [domainFile, "./fs"],
    [adapterFile, "@guardian/domain"],
    [adapterFile, "@liamcottle/meshcore.js"],
    [storageFile, "@guardian/domain"],
    [storageTestFile, "node:sqlite"],
    [mobileFile, "@guardian/domain"],
    [mobileFile, "react-native"],
    [mobileFile, "expo-router"],
    [mobileTestFile, "@guardian/storage/testing"],
    [captureFile, "@guardian/meshcore-adapter"],
    [captureFile, "node:fs"],
  ])("%s may import %s", async (file, specifier) => {
    expect(await restrictedImportErrors(file, specifier)).toEqual([]);
  });
});

describe("message catalog rule (C-09)", () => {
  async function literalErrors(source: string): Promise<number> {
    const [result] = await eslint.lintText(source, { filePath: mobileFile });
    if (!result) throw new Error(`ESLint returned no result for ${mobileFile}`);
    return result.messages.filter((message) => message.ruleId === "react/jsx-no-literals").length;
  }

  it("rejects a visible string literal in app JSX", async () => {
    expect(await literalErrors(`export const X = () => <Text>Hello</Text>;\n`)).toBe(1);
  });

  it("allows catalog lookups and literal props", async () => {
    expect(
      await literalErrors(
        `export const X = () => <Text accessibilityRole="header">{t("a")}</Text>;\n`,
      ),
    ).toBe(0);
  });
});
