import type { GeoPoint } from "../geo/geo";
import type { ContactReport, Node, NodeRole } from "./node";

export interface SyncOutcome {
  added: number;
  updated: number;
  markedMissing: number;
}

/** The companion a contact sync came from; the stored hop counts are relative to it (plan D-2). */
export interface SyncOrigin {
  companionPublicKey: string;
  /** Position set on the companion at sync time; `null` = not set. */
  position: GeoPoint | null;
  /** Time of the last sync (ms). */
  at: number;
}

export interface NodeRepository {
  /** Merges a contact sync. Only a complete sync may mark absent nodes as missing. */
  applySync(
    reports: readonly ContactReport[],
    opts: {
      complete: boolean;
      now: number;
      origin: { companionPublicKey: string; position: GeoPoint | null };
    },
  ): Promise<SyncOutcome>;
  /** The companion and time of the last contact sync; `null` before the first one. */
  syncOrigin(): Promise<SyncOrigin | null>;
  listAll(): Promise<Node[]>;
  get(publicKey: string): Promise<Node | null>;
  /** `null` removes the label. */
  setLabel(publicKey: string, label: string | null): Promise<void>;
  /** `null` goes back to the reported role. */
  setRole(publicKey: string, role: NodeRole | null): Promise<void>;
  pinToDashboard(publicKey: string): Promise<void>;
}
