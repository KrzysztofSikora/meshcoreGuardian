import { parseArgs } from "node:util";

import type { Fixture } from "@guardian/meshcore-adapter";

import { describeRequest, SCENARIOS, type Scenario } from "./capture";

export type CliCommand =
  { mode: "capture"; scenario: Scenario } | { mode: "redecode"; file: string };

export class CliUsageError extends Error {
  override readonly name = "CliUsageError";
}

export const USAGE =
  "Usage: pnpm capture --scenario handshake|remote\n" +
  "       pnpm capture --redecode <fixture.json>   (no BLE: decode the recorded frames again)";

export function parseCliArgs(argv: string[]): CliCommand {
  let values: { scenario?: string | undefined; redecode?: string | undefined };
  try {
    ({ values } = parseArgs({
      args: argv,
      options: { scenario: { type: "string" }, redecode: { type: "string" } },
      strict: true,
      allowPositionals: false,
    }));
  } catch (error) {
    throw new CliUsageError(`${(error as Error).message}\n${USAGE}`);
  }
  const { scenario, redecode } = values;
  if (scenario !== undefined && redecode !== undefined)
    throw new CliUsageError(`Use either --scenario or --redecode\n${USAGE}`);
  if (redecode !== undefined) return { mode: "redecode", file: redecode };
  if (!SCENARIOS.includes(scenario as Scenario))
    throw new CliUsageError(`Unknown or missing scenario ${JSON.stringify(scenario)}\n${USAGE}`);
  return { mode: "capture", scenario: scenario as Scenario };
}

/** Remote captures allowed over the whole gate, across firmware directories (D-6). */
export const MAX_REMOTE_RUNS = 2;
const REMOTE_FILE = /^remote(?:-\d+)?\.json$/;

/** Refuses a remote capture once the committed or written fixtures already hold `MAX_REMOTE_RUNS`. */
export function assertRemoteRunAllowed(fixtureFileNames: string[]): void {
  const used = fixtureFileNames.filter((name) => REMOTE_FILE.test(name)).length;
  if (used >= MAX_REMOTE_RUNS)
    throw new CliUsageError(
      `${used} remote captures exist already; the gate allows ${MAX_REMOTE_RUNS} (plan D-6)`,
    );
}

/** Directory name for a firmware version: `v1.17.1` stays, anything unsafe becomes `_`. */
export const firmwareDir = (version: string | undefined) =>
  version === undefined || version === "" ? "unknown" : version.replace(/[^A-Za-z0-9._-]/g, "_");

/**
 * File name for a run in its firmware directory: a handshake overwrites the last one (git shows
 * the change); a remote run never replaces an earlier one, because it cannot be repeated freely.
 */
export function fixtureFileName(scenario: Scenario, namesInDir: string[]): string {
  if (scenario === "handshake") return "handshake.json";
  for (let run = 1; ; run += 1) {
    const name = run === 1 ? "remote.json" : `remote-${run}.json`;
    if (!namesInDir.includes(name)) return name;
  }
}

/**
 * The console summary of a run. It is built from the fixture, which is already redacted, so it
 * cannot print the password or anything else the fixture leaves out (TR-09).
 */
export function formatSummary(fixture: Fixture, path: string): string {
  const { header, frames, summary } = fixture;
  const rx = frames.filter((frame) => frame.dir === "rx");
  const longest = Math.max(0, ...rx.map((frame) => frame.hex.length / 2));
  const contacts = rx.filter((frame) => frame.decoded?.kind === "contact").length;
  const firmware = header.firmware
    ? `${header.firmware.model} ${header.firmware.version} (${header.firmware.buildDate}), ` +
      `protocol ${header.firmware.verCode}`
    : "unknown (no device info)";
  const lines = [
    `fixture: ${path}`,
    `scenario: ${header.scenario}, target: ${header.targetKeyPrefix ?? "none"}`,
    `firmware: ${firmware}`,
    `frames: ${summary.frames.tx} tx, ${summary.frames.rx} rx, ` +
      `${summary.frames.decodeErrors} decode errors, longest rx ${longest} bytes`,
    `contacts: ${contacts}`,
    `redactions: ${header.redactions.join(", ") || "none"}`,
    ...summary.requests.map(describeRequest),
  ];
  if (summary.aborted !== undefined) lines.push(`aborted: ${summary.aborted}`);
  return lines.join("\n");
}
