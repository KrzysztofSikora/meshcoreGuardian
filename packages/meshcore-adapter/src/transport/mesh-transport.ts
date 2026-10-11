export type Unsubscribe = () => void;

/**
 * A link to one MeshCore companion (plan D-2). Each implementation's factory connects; the
 * interface starts at an open link. One `write` sends one complete companion frame and one
 * `onFrame` call delivers one complete frame: any reassembly happens inside the transport.
 */
export interface MeshTransport {
  write(frame: Uint8Array): Promise<void>;
  onFrame(callback: (frame: Uint8Array) => void): Unsubscribe;
  onDisconnect(callback: () => void): Unsubscribe;
  close(): Promise<void>;
}
