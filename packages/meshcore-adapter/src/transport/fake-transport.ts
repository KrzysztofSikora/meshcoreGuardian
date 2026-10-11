// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- the ambient declaration must travel with the source to consumers
/// <reference path="../types/timers.d.ts" />
import { TransportUnavailableError } from "../client/errors";

import type { MeshTransport, Unsubscribe } from "./mesh-transport";

/** The part of a recorded frame the replay needs; a `FixtureFrame` satisfies it. */
export interface ScriptFrame {
  dir: "tx" | "rx";
  tMs: number;
  hex: string;
}

interface Exchange {
  code: number;
  txMs: number;
  replies: { rxSeq: number; delayMs: number; frame: Uint8Array }[];
  consumed: boolean;
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Replays a recorded exchange (plan D-1, D-2). A write releases the rx frames recorded after the
 * first unconsumed tx frame with the same command code, each after its recorded gap. A write that
 * matches nothing gets no reply. Faults are chained before use. Timing uses `setTimeout`.
 */
export class FakeTransport implements MeshTransport {
  readonly writtenFrames: Uint8Array[] = [];
  closed = false;

  private readonly exchanges: Exchange[];
  private readonly silenced = new Set<number>();
  private readonly corrupted = new Set<number>();
  private dropAfter: number | null = null;
  private dropped = false;
  private readonly timers = new Set<unknown>();
  private readonly frameListeners = new Set<(frame: Uint8Array) => void>();
  private readonly disconnectListeners = new Set<() => void>();

  private constructor(exchanges: Exchange[]) {
    this.exchanges = exchanges;
  }

  static fromFrames(frames: readonly ScriptFrame[]): FakeTransport {
    const exchanges: Exchange[] = [];
    let rxSeq = 0;
    for (const { dir, tMs, hex } of frames) {
      const bytes = fromHex(hex);
      if (dir === "tx") {
        exchanges.push({ code: bytes[0] ?? -1, txMs: tMs, replies: [], consumed: false });
        continue;
      }
      const current = exchanges[exchanges.length - 1];
      if (current === undefined) throw new Error("Script starts with an rx frame");
      current.replies.push({ rxSeq, delayMs: Math.max(0, tMs - current.txMs), frame: bytes });
      rxSeq += 1;
    }
    return new FakeTransport(exchanges);
  }

  static fromFixture(fixture: { frames: readonly ScriptFrame[] }): FakeTransport {
    return FakeTransport.fromFrames(fixture.frames);
  }

  /** The matching write is consumed but gets no reply. */
  silence(code: number): this {
    this.silenced.add(code);
    return this;
  }

  /** Truncates the rx frame with this 0-based position among the script's rx frames to 1 byte. */
  corrupt(rxSeq: number): this {
    this.corrupted.add(rxSeq);
    return this;
  }

  /** Drops the link right after the n-th accepted write. */
  dropAfterWrites(count: number): this {
    this.dropAfter = count;
    return this;
  }

  /** The link goes away: pending replies are cancelled and the disconnect listeners run. */
  drop(): void {
    if (this.dropped || this.closed) return;
    this.dropped = true;
    this.clearTimers();
    for (const listener of [...this.disconnectListeners]) listener();
  }

  async write(frame: Uint8Array): Promise<void> {
    if (this.dropped || this.closed) throw new TransportUnavailableError();
    this.writtenFrames.push(frame);
    const exchange = this.exchanges.find((e) => !e.consumed && e.code === frame[0]);
    if (exchange !== undefined) {
      exchange.consumed = true;
      if (!this.silenced.has(exchange.code)) {
        for (const reply of exchange.replies) this.schedule(reply);
      }
    }
    if (this.dropAfter !== null && this.writtenFrames.length >= this.dropAfter) this.drop();
  }

  onFrame(callback: (frame: Uint8Array) => void): Unsubscribe {
    this.frameListeners.add(callback);
    return () => this.frameListeners.delete(callback);
  }

  onDisconnect(callback: () => void): Unsubscribe {
    this.disconnectListeners.add(callback);
    return () => this.disconnectListeners.delete(callback);
  }

  async close(): Promise<void> {
    this.closed = true;
    this.clearTimers();
    this.frameListeners.clear();
    this.disconnectListeners.clear();
  }

  private schedule(reply: Exchange["replies"][number]): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      const frame = this.corrupted.has(reply.rxSeq) ? reply.frame.slice(0, 1) : reply.frame;
      for (const listener of [...this.frameListeners]) listener(frame);
    }, reply.delayMs);
    this.timers.add(timer);
  }

  private clearTimers(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
  }
}
