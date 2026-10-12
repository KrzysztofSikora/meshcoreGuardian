import type { GeoPoint } from "../geo/geo";

/** Identity and firmware of the connected MeshCore companion, from the handshake. */
export interface CompanionInfo {
  publicKey: string;
  name: string;
  model: string;
  firmwareVersion: string;
  firmwareVerCode: number;
  buildDate: string;
  /** Position set on the companion; `null` = not set. */
  position: GeoPoint | null;
}
