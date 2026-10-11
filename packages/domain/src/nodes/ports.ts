import type { ContactReport, Node, NodeRole } from "./node";

export interface SyncOutcome {
  added: number;
  updated: number;
  markedMissing: number;
}

export interface NodeRepository {
  /** Merges a contact sync. Only a complete sync may mark absent nodes as missing. */
  applySync(
    reports: readonly ContactReport[],
    opts: { complete: boolean; now: number },
  ): Promise<SyncOutcome>;
  listAll(): Promise<Node[]>;
  get(publicKey: string): Promise<Node | null>;
  /** `null` removes the label. */
  setLabel(publicKey: string, label: string | null): Promise<void>;
  /** `null` goes back to the reported role. */
  setRole(publicKey: string, role: NodeRole | null): Promise<void>;
  pinToDashboard(publicKey: string): Promise<void>;
}
