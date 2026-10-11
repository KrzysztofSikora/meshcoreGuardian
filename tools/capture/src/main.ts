// `pnpm capture`: records a bounded, budgeted capture from the companion over BLE into a redacted
// fixture (plan D-5, D-8), or decodes a recorded fixture again (`--redecode`, no BLE).
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { MeshCoreConnection, readFixture, type Fixture } from "@guardian/meshcore-adapter";
import nodeBle from "node-ble";

import { RequestBudget, type Clock } from "./budget";
import { runCapture } from "./capture";
import {
  assertRemoteRunAllowed,
  CliUsageError,
  firmwareDir,
  fixtureFileName,
  formatSummary,
  parseCliArgs,
} from "./cli";
import { CaptureConfigError, readCaptureConfig } from "./config";
import { BleConnectError, connectNodeBle } from "./node-ble-transport";
import { RecordingTransport, redecodeFixture } from "./recorder";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const fixturesRoot = join(repoRoot, "packages/meshcore-adapter/fixtures");

const clock: Clock = {
  now: () => performance.now(),
  sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
};

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

const writeFixture = (path: string, fixture: Fixture) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(fixture, null, 2)}\n`);
};

/** The exact versions the run used, from the pinned manifests. */
function libraries(): Record<string, string> {
  const dependencies = (manifest: string) =>
    (readJson(join(repoRoot, manifest)) as { dependencies: Record<string, string> }).dependencies;
  return {
    "@liamcottle/meshcore.js":
      dependencies("packages/meshcore-adapter/package.json")["@liamcottle/meshcore.js"] ?? "?",
    "node-ble": dependencies("tools/capture/package.json")["node-ble"] ?? "?",
    node: process.versions.node,
  };
}

function fixtureFileNames(dir: string): string[] {
  try {
    return readdirSync(dir, { recursive: true, encoding: "utf8" }).map(
      (path) => path.split(/[\\/]/).at(-1) ?? path,
    );
  } catch {
    return [];
  }
}

async function main(argv: string[]): Promise<number> {
  const command = parseCliArgs(argv);

  if (command.mode === "redecode") {
    // pnpm runs the script in tools/capture; INIT_CWD is where `pnpm capture` was typed.
    const path = resolve(process.env.INIT_CWD ?? process.cwd(), command.file);
    const fixture = redecodeFixture(readFixture(readJson(path)));
    writeFixture(path, fixture);
    console.log(formatSummary(fixture, relative(repoRoot, path)));
    return 0;
  }

  const { scenario } = command;
  try {
    process.loadEnvFile(join(repoRoot, ".env"));
  } catch {
    throw new CaptureConfigError(
      "Cannot read .env in the repository root (template: .env.example)",
    );
  }
  const config = readCaptureConfig(process.env);
  if (scenario === "remote") assertRemoteRunAllowed(fixtureFileNames(fixturesRoot));

  console.log(`connecting to ${config.companion} …`);
  const ble = await connectNodeBle(config.companion, nodeBle);
  const recorder = new RecordingTransport(ble);
  const connection = new MeshCoreConnection(recorder);
  const captureDate = new Date().toISOString();
  const result = await runCapture(scenario, {
    connection,
    link: recorder,
    budget: new RequestBudget(clock),
    clock,
    targetPrefix: config.repeaterPrefix,
    guestPassword: config.guestPassword,
    log: (line) => console.log(line),
  }).finally(() => connection.close());

  const fixture = recorder.fixture({
    captureDate,
    tool: "@guardian/capture",
    libraries: libraries(),
    scenario,
    targetKeyPrefix: scenario === "remote" ? config.repeaterPrefix : null,
    requests: result.requests,
    ...(result.aborted === undefined ? {} : { aborted: result.aborted }),
  });
  const dir = join(fixturesRoot, firmwareDir(fixture.header.firmware?.version));
  const path = join(dir, fixtureFileName(scenario, fixtureFileNames(dir)));
  writeFixture(path, fixture);
  console.log(formatSummary(fixture, relative(repoRoot, path)));
  return result.aborted === undefined ? 0 : 3;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    if (error instanceof CliUsageError || error instanceof CaptureConfigError) {
      console.error(error.message);
      process.exit(1);
    }
    if (error instanceof BleConnectError) {
      // No file: nothing was recorded (plan error model).
      console.error(error.message);
      process.exit(2);
    }
    console.error(error);
    process.exit(1);
  },
);
