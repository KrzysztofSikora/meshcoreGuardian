import type { DecodedFrame } from "../decode/decode-frame";

/**
 * A recorded capture run (plan D-3): one JSON file per run, read by fixture tests and by S-02's
 * `FakeTransport`. Frames hold the redacted bytes as hex (D-4); `decoded` is `decodeFrame(hex)`
 * at capture time. Bump `formatVersion` on any change to this shape.
 */
export const FIXTURE_FORMAT_VERSION = 1;

/** The companion as its device-info frame describes it; null when no device info was received. */
export interface FixtureFirmware {
  version: string;
  buildDate: string;
  verCode: number;
  model: string;
}

export interface FixtureHeader {
  firmware: FixtureFirmware | null;
  /** ISO 8601. */
  captureDate: string;
  tool: string;
  /** Package name → exact version, e.g. the codec and BLE library used for the run. */
  libraries: Record<string, string>;
  scenario: string;
  /** Hex public key prefix of the remote node, or null when the scenario contacts none. */
  targetKeyPrefix: string | null;
  /** What was redacted: one label per rule applied to at least one frame (sorted). */
  redactions: string[];
}

export interface FixtureFrame {
  seq: number;
  dir: "tx" | "rx";
  /** Milliseconds since the start of the run, monotonic. */
  tMs: number;
  hex: string;
  decoded?: DecodedFrame;
  decodeError?: string;
}

export type RequestKind = "login" | "status" | "telemetry";
export type RequestOutcome = "responded" | "rejected" | "error" | "no_response";

export interface FixtureRequest {
  kind: RequestKind;
  outcome: RequestOutcome;
  estTimeoutMs?: number;
  /** From the request write to the pushed reply. */
  latencyMs?: number;
}

export interface FixtureSummary {
  frames: { tx: number; rx: number; decodeErrors: number };
  requests: FixtureRequest[];
  /** Why the run stopped early, e.g. `transport_disconnected`. */
  aborted?: string;
}

export interface Fixture {
  formatVersion: typeof FIXTURE_FORMAT_VERSION;
  header: FixtureHeader;
  frames: FixtureFrame[];
  summary: FixtureSummary;
}

export class FixtureFormatError extends Error {
  override readonly name = "FixtureFormatError";
}

type Json = Record<string, unknown>;

const HEX = /^(?:[0-9a-f]{2})*$/;
const REQUEST_KINDS: readonly string[] = ["login", "status", "telemetry"];
const OUTCOMES: readonly string[] = ["responded", "rejected", "error", "no_response"];

function fail(path: string, expected: string): never {
  throw new FixtureFormatError(`Fixture ${path}: expected ${expected}`);
}

function object(value: unknown, path: string): Json {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(path, "an object");
  return value as Json;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path, "an array");
  return value;
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string") fail(path, "a string");
  return value;
}

function number(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(path, "a number");
  return value;
}

function oneOf<T extends string>(value: unknown, allowed: readonly string[], path: string): T {
  if (typeof value !== "string" || !allowed.includes(value)) fail(path, allowed.join(" | "));
  return value as T;
}

function readFirmware(value: unknown): FixtureFirmware | null {
  if (value === null) return null;
  const firmware = object(value, "header.firmware");
  return {
    version: string(firmware.version, "header.firmware.version"),
    buildDate: string(firmware.buildDate, "header.firmware.buildDate"),
    verCode: number(firmware.verCode, "header.firmware.verCode"),
    model: string(firmware.model, "header.firmware.model"),
  };
}

function readHeader(value: unknown): FixtureHeader {
  const header = object(value, "header");
  const libraries = object(header.libraries, "header.libraries");
  return {
    firmware: readFirmware(header.firmware),
    captureDate: string(header.captureDate, "header.captureDate"),
    tool: string(header.tool, "header.tool"),
    libraries: Object.fromEntries(
      Object.entries(libraries).map(([name, version]) => [
        name,
        string(version, `header.libraries.${name}`),
      ]),
    ),
    scenario: string(header.scenario, "header.scenario"),
    targetKeyPrefix:
      header.targetKeyPrefix === null
        ? null
        : string(header.targetKeyPrefix, "header.targetKeyPrefix"),
    redactions: array(header.redactions, "header.redactions").map((label, index) =>
      string(label, `header.redactions[${index}]`),
    ),
  };
}

function readFrame(value: unknown, index: number): FixtureFrame {
  const path = `frames[${index}]`;
  const frame = object(value, path);
  const hex = string(frame.hex, `${path}.hex`);
  if (!HEX.test(hex)) fail(`${path}.hex`, "lower-case hex with whole bytes");
  const result: FixtureFrame = {
    seq: number(frame.seq, `${path}.seq`),
    dir: oneOf(frame.dir, ["tx", "rx"], `${path}.dir`),
    tMs: number(frame.tMs, `${path}.tMs`),
    hex,
  };
  // `decoded` is checked against decodeFrame(hex) by the fixture tests, not here.
  if (frame.decoded !== undefined)
    result.decoded = object(frame.decoded, `${path}.decoded`) as unknown as DecodedFrame;
  if (frame.decodeError !== undefined)
    result.decodeError = string(frame.decodeError, `${path}.decodeError`);
  return result;
}

function readRequest(value: unknown, index: number): FixtureRequest {
  const path = `summary.requests[${index}]`;
  const request = object(value, path);
  const result: FixtureRequest = {
    kind: oneOf(request.kind, REQUEST_KINDS, `${path}.kind`),
    outcome: oneOf(request.outcome, OUTCOMES, `${path}.outcome`),
  };
  if (request.estTimeoutMs !== undefined)
    result.estTimeoutMs = number(request.estTimeoutMs, `${path}.estTimeoutMs`);
  if (request.latencyMs !== undefined)
    result.latencyMs = number(request.latencyMs, `${path}.latencyMs`);
  return result;
}

function readSummary(value: unknown): FixtureSummary {
  const summary = object(value, "summary");
  const frames = object(summary.frames, "summary.frames");
  const result: FixtureSummary = {
    frames: {
      tx: number(frames.tx, "summary.frames.tx"),
      rx: number(frames.rx, "summary.frames.rx"),
      decodeErrors: number(frames.decodeErrors, "summary.frames.decodeErrors"),
    },
    requests: array(summary.requests, "summary.requests").map(readRequest),
  };
  if (summary.aborted !== undefined) result.aborted = string(summary.aborted, "summary.aborted");
  return result;
}

/** Checks the shape of parsed fixture JSON. Throws `FixtureFormatError` naming the bad field. */
export function readFixture(json: unknown): Fixture {
  const fixture = object(json, "root");
  if (fixture.formatVersion !== FIXTURE_FORMAT_VERSION)
    fail("formatVersion", String(FIXTURE_FORMAT_VERSION));
  return {
    formatVersion: FIXTURE_FORMAT_VERSION,
    header: readHeader(fixture.header),
    frames: array(fixture.frames, "frames").map(readFrame),
    summary: readSummary(fixture.summary),
  };
}
