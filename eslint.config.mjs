// @ts-check
import expoConfig from "eslint-config-expo/flat.js";
import { defineConfig } from "eslint/config";
import { configs as tseslintConfigs } from "typescript-eslint";

/**
 * Layer boundaries (context/tech-stack.md, "Lint and format"; plan D-1).
 *
 * In flat config a later block that sets `no-restricted-imports` replaces the options of an
 * earlier one, so every glob below gets its complete list of forbidden imports in one block.
 */
const forbid = {
  anyWorkspacePackage: { regex: "^@guardian/", message: "domain imports no other package." },
  deepImport: {
    regex: "^@guardian/[^/]+/.+",
    message: "Import workspace packages through their entry point only.",
  },
  storage: {
    regex: "^@guardian/storage(/.*)?$",
    message: "meshcore-adapter must not depend on storage; both depend only on domain.",
  },
  meshcoreAdapter: {
    regex: "^@guardian/meshcore-adapter(/.*)?$",
    message: "storage must not depend on meshcore-adapter; both depend only on domain.",
  },
  react: {
    regex: "^react(-[^/]*)?(/.*)?$",
    message: "Only apps/mobile imports React and React Native.",
  },
  expo: {
    regex: "^(expo(-[^/]*)?|@expo/[^/]+)(/.*)?$",
    message: "Only apps/mobile imports Expo modules.",
  },
  meshcoreJs: {
    regex: "^@liamcottle/",
    message: "@liamcottle/meshcore.js is used only as a codec inside packages/meshcore-adapter.",
  },
  nodeBuiltins: { regex: "^node:", message: "domain is pure TypeScript without I/O." },
  nodeSqlite: {
    regex: "^node:sqlite$",
    message: "node:sqlite is for storage tests only; the app uses expo-sqlite.",
  },
};

/** @param {string[]} files @param {{ regex: string; message: string }[]} patterns */
const layer = (files, patterns) => ({
  files,
  rules: { "no-restricted-imports": ["error", { patterns }] },
});

const storageForbidden = [
  forbid.meshcoreAdapter,
  forbid.deepImport,
  forbid.react,
  forbid.expo,
  forbid.meshcoreJs,
];

export default defineConfig([
  {
    ignores: [
      "**/node_modules/",
      "apps/mobile/android/",
      "apps/mobile/ios/",
      "apps/mobile/.expo/",
      "reports/",
      "coverage/",
      ".workflow/",
    ],
  },
  expoConfig,
  {
    files: ["**/*.ts", "**/*.tsx"],
    extends: [tseslintConfigs.recommended],
  },
  {
    // eslint-plugin-react's version detection uses an API removed in ESLint 10 (plan D-5).
    settings: { react: { version: "19.2" } },
  },
  layer(
    ["packages/domain/**"],
    [forbid.anyWorkspacePackage, forbid.react, forbid.expo, forbid.meshcoreJs, forbid.nodeBuiltins],
  ),
  layer(
    ["packages/meshcore-adapter/**"],
    [forbid.storage, forbid.deepImport, forbid.react, forbid.expo, forbid.nodeSqlite],
  ),
  layer(["packages/storage/**"], [...storageForbidden, forbid.nodeSqlite]),
  layer(["packages/storage/test/**"], storageForbidden),
  layer(["apps/mobile/**"], [forbid.deepImport, forbid.meshcoreJs, forbid.nodeSqlite]),
]);
