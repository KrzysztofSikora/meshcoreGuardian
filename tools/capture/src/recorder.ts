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

import { fromHex, toHex } from "./hex";
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

/** `decoded` or `decodeError` of a recorded rx frame. */
function decodeRecorded(bytes: Uint8Array): Pick<FixtureFrame, "decoded" | "decodeError"> {
  try {
    return { decoded: decodeFrame(bytes) };
  } catch (error) {
    // A frame the decoder cannot read is still evidence: keep it with the reason (D-3).
    return {
      decodeError: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    };
  }
}

function firmwareOf(frames: readonly FixtureFrame[]): FixtureFirmware | null {
  for (const { decoded } of frames)
    if (decoded?.kind === "deviceInfo")
      return {
        version: decoded.firmwareVersion,
        buildDate: decoded.buildDate,
        verCode: decoded.firmwareVerCode,
        model: decoded.manufacturer,
      };
  return null;
}

/**
 * Decodes every rx frame of a recorded fixture again from its `hex` (plan-review #1): after a
 * decoder fix, the fixture follows without a new capture and without editing it by hand. The
 * frames, their bytes and the run summary stay as recorded; only `decoded`, `decodeError`, the
 * decode-error count and the header firmware are recomputed.
 */
export function redecodeFixture(fixture: Fixture): Fixture {
  const frames = fixture.frames.map((frame): FixtureFrame => {
    const { decoded: _, decodeError: __, ...recorded } = frame;
    return frame.dir === "rx" ? { ...recorded, ...decodeRecorded(fromHex(frame.hex)) } : recorded;
  });
  return {
    ...fixture,
    header: { ...fixture.header, firmware: firmwareOf(frames) },
    frames,
    summary: {
      ...fixture.summary,
      frames: {
        ...fixture.summary.frames,
        decodeErrors: frames.filter((frame) => frame.decodeError !== undefined).length,
      },
    },
  };
}

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
        firmware: firmwareOf(this.frames),
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
    this.frames.push(dir === "rx" ? { ...frame, ...decodeRecorded(bytes) } : frame);
  }
}
