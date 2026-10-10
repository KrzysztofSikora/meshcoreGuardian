import type { TransportMode } from "../config/transport-mode";

/** Placeholder until S-01 defines `MeshTransport` and S-02 adds the BLE and fake transports. */
export type StubTransport = { readonly kind: TransportMode };

export function createTransport(mode: TransportMode): StubTransport {
  return { kind: mode };
}
