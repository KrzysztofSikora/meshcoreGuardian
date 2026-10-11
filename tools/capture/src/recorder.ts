import {
  decodeFrame,
  FIXTURE_FORMAT_VERSION,
  type Fixture,
  type FixtureFirmware,
  type FixtureFrame,
  type FixtureRequest,
  type MeshTransport,
  type Unsubscribe,
} from "@guardian/meshcore-adapter";

import { createRedactionState, redactFrame, type Direction, type RedactionLabel } from "./redact";

/** What the capture run knows about itself; the recorder adds the firmware, frames and counts. */
export interface FixtureMeta {
  captureDate: string;
  tool: string;
  libraries: Record<string, string>;
  scenario: string;
  targetKeyPrefix: string | null;
  requests: FixtureRequest[];
  aborted?: string;
}

const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

/**
 * Wraps a transport and records every frame in both directions (plan D-3). The recorded copy is
 * redacted (D-4) and rx frames are decoded from it; the frames passed through to the companion
 * and to listeners are the original bytes, so redaction never changes what the run does.
 */
export class RecordingTransport implements MeshTransport {
  private readonly frames: FixtureFrame[] = [];
  private readonly redactions = new Set<RedactionLabel>();
  private readonly redaction = createRedactionState();
  private readonly listeners = new Set<(frame: Uint8Array) => void>();
  private readonly unsubscribe: Unsubscribe;
  private readonly start: number;

  constructor(
    private readonly inner: MeshTransport,
    private readonly now: () => number = () => performance.now(),
  ) {
    this.start = now();
    this.unsubscribe = inner.onFrame((frame) => {
      this.record("rx", frame);
      for (const listener of this.listeners) listener(frame);
    });
  }

  async write(frame: Uint8Array): Promise<void> {
    this.record("tx", frame);
    await this.inner.write(frame);
  }

  onFrame(callback: (frame: Uint8Array) => void): Unsubscribe {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  onDisconnect(callback: () => void): Unsubscribe {
    return this.inner.onDisconnect(callback);
  }

  async close(): Promise<void> {
    this.unsubscribe();
    this.listeners.clear();
    await this.inner.close();
  }

  /** The frames recorded so far, redacted. */
  get recorded(): readonly FixtureFrame[] {
    return this.frames;
  }

  fixture(meta: FixtureMeta): Fixture {
    const count = (dir: Direction) => this.frames.filter((frame) => frame.dir === dir).length;
    const summary: Fixture["summary"] = {
      frames: {
        tx: count("tx"),
        rx: count("rx"),
        decodeErrors: this.frames.filter((frame) => frame.decodeError !== undefined).length,
      },
      requests: meta.requests,
    };
    if (meta.aborted !== undefined) summary.aborted = meta.aborted;
    return {
      formatVersion: FIXTURE_FORMAT_VERSION,
      header: {
        firmware: this.firmware(),
        captureDate: meta.captureDate,
        tool: meta.tool,
        libraries: meta.libraries,
        scenario: meta.scenario,
        targetKeyPrefix: meta.targetKeyPrefix,
        redactions: [...this.redactions].sort(),
      },
      frames: [...this.frames],
      summary,
    };
  }

  private record(dir: Direction, original: Uint8Array): void {
    const { bytes, redactions } = redactFrame(dir, original, this.redaction);
    for (const label of redactions) this.redactions.add(label);
    const frame: FixtureFrame = {
      seq: this.frames.length,
      dir,
      tMs: Math.round((this.now() - this.start) * 10) / 10,
      hex: toHex(bytes),
    };
    if (dir === "rx") {
      try {
        frame.decoded = decodeFrame(bytes);
      } catch (error) {
        // A frame the decoder cannot read is still evidence: keep it with the reason (D-3).
        frame.decodeError =
          error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      }
    }
    this.frames.push(frame);
  }

  private firmware(): FixtureFirmware | null {
    for (const { decoded } of this.frames)
      if (decoded?.kind === "deviceInfo")
        return {
          version: decoded.firmwareVersion,
          buildDate: decoded.buildDate,
          verCode: decoded.firmwareVerCode,
          model: decoded.manufacturer,
        };
    return null;
  }
}
