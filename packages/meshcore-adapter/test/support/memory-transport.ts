import type { MeshTransport, Unsubscribe } from "../../src/transport/mesh-transport";

/** In-memory `MeshTransport` for tests: records writes, `push` delivers a frame, `drop` disconnects. */
export class MemoryTransport implements MeshTransport {
  readonly writes: Uint8Array[] = [];
  closed = false;
  private readonly frameListeners = new Set<(frame: Uint8Array) => void>();
  private readonly disconnectListeners = new Set<() => void>();

  async write(frame: Uint8Array): Promise<void> {
    this.writes.push(frame);
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
  }

  get listenerCount(): number {
    return this.frameListeners.size + this.disconnectListeners.size;
  }

  push(frame: Uint8Array): void {
    for (const listener of this.frameListeners) listener(frame);
  }

  drop(): void {
    for (const listener of this.disconnectListeners) listener();
  }
}
