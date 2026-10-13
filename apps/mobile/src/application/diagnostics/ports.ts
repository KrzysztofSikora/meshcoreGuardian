import type { CheckOutcome, DiagnosticPolicy, DiagnosticRunRepository } from "@guardian/domain";
import type { RunChecksRequest } from "@guardian/meshcore-adapter";
import type { StoreApi } from "zustand/vanilla";

import type { SessionState } from "../connection/companion-session";
import type { AppStatePort } from "../connection/ports";

/** The "airtime is shared" notice shows once; this remembers that it was accepted (plan D-14). */
export interface AirtimeNoticeStore {
  seen(): Promise<boolean>;
  markSeen(): Promise<void>;
}

/** The guest password stored for a node, or "" for the open guest login. Rejects when storage fails. */
export type GuestPasswordSource = (publicKey: string) => Promise<string>;

/**
 * Called when a password opened an admin session; Guardian takes only guest passwords. `sent` is
 * the value the run sent, so a password saved meanwhile is not removed.
 */
export type AdminPasswordHandler = (publicKey: string, sent: string) => Promise<void>;

/** What the controller needs from the session; it never sees the `MeshClient` (plan D-10). */
export interface RunSession {
  store: StoreApi<SessionState>;
  runChecks(request: RunChecksRequest): Promise<CheckOutcome[]>;
}

export interface RunPorts {
  session: RunSession;
  repository: () => Promise<DiagnosticRunRepository>;
  appState: AppStatePort;
  notice: AirtimeNoticeStore;
  password: GuestPasswordSource;
  adminPassword: AdminPasswordHandler;
  policy: () => DiagnosticPolicy;
  clock: () => number;
}
