import { defineConfig } from "vitest/config";

const packageTests = ["src/**/*.test.ts", "test/**/*.test.ts"];

export default defineConfig({
  test: {
    projects: [
      { test: { name: "domain", root: "packages/domain", include: packageTests } },
      {
        test: {
          name: "meshcore-adapter",
          root: "packages/meshcore-adapter",
          include: packageTests,
        },
      },
      { test: { name: "storage", root: "packages/storage", include: packageTests } },
      { test: { name: "tooling", root: "tooling", include: ["lint/**/*.test.ts"] } },
      { test: { name: "capture", root: "tools/capture", include: packageTests } },
      // App logic tests run in Node and import no React Native modules.
      { test: { name: "mobile", root: "apps/mobile", include: ["src/**/*.test.ts"] } },
    ],
  },
});
