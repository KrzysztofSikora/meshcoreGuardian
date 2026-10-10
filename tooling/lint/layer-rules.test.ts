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
  ])("%s may not import %s", async (file, specifier) => {
    expect(await restrictedImportErrors(file, specifier)).toHaveLength(1);
  });

  it.each([
    [domainFile, "./reaction-table"],
    [domainFile, "../expo-like-name"],
    [adapterFile, "@guardian/domain"],
    [adapterFile, "@liamcottle/meshcore.js"],
    [storageFile, "@guardian/domain"],
    [storageTestFile, "node:sqlite"],
    [mobileFile, "@guardian/domain"],
    [mobileFile, "react-native"],
    [mobileFile, "expo-router"],
  ])("%s may import %s", async (file, specifier) => {
    expect(await restrictedImportErrors(file, specifier)).toEqual([]);
  });
});
