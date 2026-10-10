// Mutation testing setup fixed in context/test-plan.md (Tool setup).
// `pnpm mutation --mutate <file>` overrides `mutate` to scope a run to one module.
/** @type {import("@stryker-mutator/api/core").PartialStrykerOptions} */
export default {
  testRunner: "vitest",
  vitest: { configFile: "vitest.config.mts" },
  coverageAnalysis: "perTest",
  mutate: ["packages/domain/src/**/*.ts", "!**/*.test.ts"],
  reporters: ["clear-text", "html", "json"],
  htmlReporter: { fileName: "reports/mutation/mutation.html" },
  jsonReporter: { fileName: "reports/mutation/mutation.json" },
  thresholds: { high: 80, low: 70, break: null },
  incremental: true,
  incrementalFile: "reports/stryker-incremental.json",
};
