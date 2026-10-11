import type { MeshTransport, Unsubscribe } from "@guardian/meshcore-adapter";

/**
 * In-memory `MeshTransport` for capture tests (plan-review #4: tools do not reach into the
 * adapter's test tree). Records writes; `push` delivers a frame, `drop` disconnects.
 */
export class FakeTransport implements MeshTransport {
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

  get frameListenerCount(): number {
    return this.frameListeners.size;
  }

  push(frame: Uint8Array): void {
    for (const listener of this.frameListeners) listener(frame);
  }

  drop(): void {
    for (const listener of this.disconnectListeners) listener();
  }
}
