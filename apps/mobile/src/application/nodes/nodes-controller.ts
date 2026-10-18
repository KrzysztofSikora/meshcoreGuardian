import {
  normalizeLabel,
  sortNodes,
  type ContactSyncFailure,
  type ContactSyncState,
  type Node,
  type NodeRepository,
  type NodeRole,
  type SyncOrigin,
} from "@guardian/domain";
import {
  AbortError,
  BusyError,
  CommandRejectedError,
  ContactsTimeoutError,
  MalformedFrameError,
  TransportUnavailableError,
  type ContactsResult,
} from "@guardian/meshcore-adapter";
import { createStore, type StoreApi } from "zustand/vanilla";

import type { CompanionSession, SessionState } from "../connection/companion-session";
import type { AppStatePort } from "../connection/ports";

export interface NodesState {
  nodes: Node[];
  loaded: boolean;
  /** Companion and time of the last contact sync; the stored paths are relative to it. */
  origin: SyncOrigin | null;
  storage: "ok" | "error";
  sync: ContactSyncState;
}

export type EditResult = { ok: true } | { ok: false; reason: "TOO_LONG" | "STORAGE_ERROR" };

export interface NodesPorts {
  /** The session's contact fetch; the controller never sees the `MeshClient` (plan D-16). */
  session: Pick<CompanionSession, "fetchContacts"> & {
    store: StoreApi<SessionState>;
  };
  repository: () => Promise<NodeRepository>;
  appState: AppStatePort;
  clock: () => number;
}

const INITIAL: NodesState = {
  nodes: [],
  loaded: false,
  origin: null,
  storage: "ok",
  sync: { kind: "idle" },
};

function failureFor(error: unknown): ContactSyncFailure | null {
  if (error instanceof AbortError) return null;
  if (error instanceof BusyError) return "BUSY";
  if (error instanceof ContactsTimeoutError) return "NO_RESPONSE";
  if (error instanceof TransportUnavailableError) return "TRANSPORT_UNAVAILABLE";
  if (error instanceof CommandRejectedError) return "UNSUPPORTED";
  if (error instanceof MalformedFrameError) return "MALFORMED_RESPONSE";
  return "UNEXPECTED"; // an unknown cause is not claimed to be a link loss
}

/**
 * Known nodes and the contact sync (plan D-6, D-8, D-16). A sync starts once when a connection is
 * established and when the user asks for one; never from a timer and never in the background.
 */
export class NodesController {
  readonly store: StoreApi<NodesState> = createStore<NodesState>(() => INITIAL);

  private repo: Promise<NodeRepository> | null = null;
  private loading: Promise<void> | null = null;
  private syncing = false;
  private abort: AbortController | null = null;
  private readonly unsubscribe: () => void;

  constructor(private readonly ports: NodesPorts) {
    let wasConnected = ports.session.store.getState().connection.kind === "connected";
    this.unsubscribe = ports.session.store.subscribe((state) => {
      const connected = state.connection.kind === "connected";
      if (connected && !wasConnected) this.onConnected(state);
      if (!connected && wasConnected) this.abort?.abort();
      wasConnected = connected;
    });
  }

  getState(): NodesState {
    return this.store.getState();
  }

  /** Reads the stored nodes once; later calls return the same work. */
  load(): Promise<void> {
    this.loading ??= this.reload();
    return this.loading;
  }

  /** Starts a contact sync unless one is running. Resolves when it has ended. */
  async sync(): Promise<void> {
    if (this.syncing) return;
    this.syncing = true;
    const abort = new AbortController();
    this.abort = abort;
    // The stored hops belong to this companion; the session is already cleared if the link drops
    // during the fetch (lessons: capture the context when the operation starts).
    const connection = this.ports.session.store.getState().connection;
    const companion = connection.kind === "connected" ? connection.companion : null;
    this.set({ sync: { kind: "syncing" } });
    try {
      const repository = await this.open();
      if (repository === null || abort.signal.aborted) return this.set({ sync: { kind: "idle" } });
      if (companion === null)
        return this.set({ sync: { kind: "failed", reason: "TRANSPORT_UNAVAILABLE" } });
      const result = await this.fetch(abort);
      if (result === "aborted") return this.set({ sync: { kind: "idle" } });
      if (typeof result === "string") return this.set({ sync: { kind: "failed", reason: result } });
      const complete = result.contacts.length === result.expected;
      const now = this.ports.clock();
      try {
        await repository.applySync(result.contacts, {
          complete,
          now,
          origin: { companionPublicKey: companion.publicKey, position: companion.position },
        });
        await this.refresh(repository);
      } catch {
        return this.set({ sync: { kind: "failed", reason: "STORAGE_ERROR" } });
      }
      this.set({
        sync: complete
          ? { kind: "done", at: now, total: result.contacts.length }
          : {
              kind: "partial",
              at: now,
              received: result.contacts.length,
              expected: result.expected,
            },
      });
    } finally {
      this.syncing = false;
      if (this.abort === abort) this.abort = null;
    }
  }

  async setLabel(publicKey: string, input: string): Promise<EditResult> {
    const label = normalizeLabel(input);
    if (!label.ok) return { ok: false, reason: label.reason };
    return this.write((repository) => repository.setLabel(publicKey, label.value));
  }

  setRole(publicKey: string, role: NodeRole | null): Promise<EditResult> {
    return this.write((repository) => repository.setRole(publicKey, role));
  }

  pin(publicKey: string): Promise<EditResult> {
    return this.write((repository) => repository.pinToDashboard(publicKey));
  }

  dispose(): void {
    this.unsubscribe();
    this.abort?.abort();
  }

  private onConnected(session: SessionState): void {
    // Only an active app with a supported `contacts` capability syncs on its own (D-6, TR-18).
    if (this.ports.appState.current() !== "active") return;
    if (session.capabilities?.contacts.supported !== true) return;
    void this.sync();
  }

  private async fetch(
    abort: AbortController,
  ): Promise<ContactsResult | ContactSyncFailure | "aborted"> {
    try {
      return await this.ports.session.fetchContacts({ signal: abort.signal });
    } catch (error) {
      return failureFor(error) ?? "aborted";
    }
  }

  /** The repository, or `null` after marking storage as failed. */
  private async open(): Promise<NodeRepository | null> {
    this.repo ??= this.ports.repository();
    try {
      return await this.repo;
    } catch {
      this.set({ storage: "error", loaded: true, nodes: [], origin: null });
      return null;
    }
  }

  /** Re-reads the stored nodes, also after `load()` (after a deletion). */
  async reload(): Promise<void> {
    const repository = await this.open();
    if (repository === null) return;
    try {
      await this.refresh(repository);
    } catch {
      this.set({ storage: "error", loaded: true, nodes: [], origin: null });
    }
  }

  private async refresh(repository: NodeRepository): Promise<void> {
    const nodes = sortNodes(await repository.listAll());
    const origin = await repository.syncOrigin();
    this.set({ nodes, origin, loaded: true, storage: "ok" });
  }

  private async write(action: (repository: NodeRepository) => Promise<void>): Promise<EditResult> {
    const repository = await this.open();
    if (repository === null) return { ok: false, reason: "STORAGE_ERROR" };
    try {
      await action(repository);
      await this.refresh(repository);
      return { ok: true };
    } catch {
      return { ok: false, reason: "STORAGE_ERROR" };
    }
  }

  private set(partial: Partial<NodesState>): void {
    this.store.setState(partial);
  }
}
