import {
  actionAvailability,
  displayName,
  effectiveRole,
  isOnDashboard,
  keyPrefix,
  type Capabilities,
  type ContactSyncState,
  type Node,
  type NodeRole,
} from "@guardian/domain";

/** A catalog key with its interpolation values; the screens pass it straight to `t()`. */
export interface Text {
  key: string;
  params?: Record<string, string | number>;
}

export type NodeFilter = "dashboard" | "all";

export function visibleNodes(nodes: readonly Node[], filter: NodeFilter): Node[] {
  return filter === "all" ? [...nodes] : nodes.filter(isOnDashboard);
}

export function roleText(role: NodeRole): Text {
  return { key: `roles.${role}` };
}

/** The label or reported name; a node without either is shown by its key prefix. */
export function nameText(node: Node): Text {
  const name = displayName(node);
  return name === null
    ? { key: "nodes.unnamed", params: { prefix: keyPrefix(node.publicKey) } }
    : { key: "nodes.name", params: { name } };
}

export function lastHeardText(node: Node, formatTime: (ms: number) => string): Text {
  return node.lastHeardAt === null
    ? { key: "nodes.lastHeardNone" }
    : { key: "nodes.lastHeard", params: { time: formatTime(node.lastHeardAt) } };
}

/**
 * "Reported as …" is shown when the user changed the label or the role (plan D-1), and always for
 * a type the app does not know, so the raw type is never hidden (D-5).
 */
export function reportedAsText(node: Node): Text | null {
  if (node.userRole === null && node.userLabel === null && node.reportedRole !== "unknown") {
    return null;
  }
  return node.reportedRole === "unknown"
    ? { key: "nodes.reportedAs.unknown", params: { type: node.reportedType } }
    : { key: `nodes.reportedAs.${node.reportedRole}` };
}

/** The advertised name a label covers; shown only while a label hides it (roadmap S-03). */
export function reportedNameText(node: Node): Text | null {
  if (node.userLabel === null || node.reportedName === "") return null;
  return { key: "nodes.reportedName", params: { name: node.reportedName } };
}

/** The saved/not saved line of the guest password card; always words, never the password. */
export function passwordStatusText(saved: "yes" | "no" | "error" | undefined): Text | null {
  switch (saved) {
    case undefined:
      return null;
    case "yes":
      return { key: "password.saved" };
    case "no":
      return { key: "password.none" };
    case "error":
      return { key: "password.readFailed" };
  }
}

/** Why a saved password was dropped after an admin session; shown on the password card. */
export function adminDiscardedText(state: "removed" | "kept" | undefined): Text | null {
  return state === undefined ? null : { key: `password.admin.${state}` };
}

export type PasswordProblem = "EMPTY" | "TOO_LONG" | "STORAGE_ERROR" | "REMOVE_FAILED";

export function passwordErrorText(problem: PasswordProblem): Text {
  switch (problem) {
    case "EMPTY":
    case "TOO_LONG":
      return { key: "password.tooLong" };
    case "STORAGE_ERROR":
      return { key: "password.saveFailed" };
    case "REMOVE_FAILED":
      return { key: "password.removeFailed" };
  }
}

export interface NodeRowModel {
  name: Text;
  role: Text;
  lastHeard: Text;
  notInContacts: boolean;
}

export function nodeRowModel(node: Node, formatTime: (ms: number) => string): NodeRowModel {
  return {
    name: nameText(node),
    role: roleText(effectiveRole(node)),
    lastHeard: lastHeardText(node, formatTime),
    notInContacts: !node.inContacts,
  };
}

export function syncLine(sync: ContactSyncState): Text | null {
  switch (sync.kind) {
    case "idle":
      return null;
    case "syncing":
      return { key: "sync.syncing" };
    case "done":
      return { key: "sync.done", params: { count: sync.total } };
    case "partial":
      return { key: "sync.partial", params: { received: sync.received, expected: sync.expected } };
    case "failed":
      return { key: `sync.failed.${sync.reason}` };
  }
}

export interface SyncButtonModel {
  enabled: boolean;
  /** Why the button is disabled, when the user can do something about it. */
  reason: Text | null;
}

export function syncButton(input: {
  connected: boolean;
  capabilities: Capabilities | null;
  sync: ContactSyncState;
}): SyncButtonModel {
  if (!input.connected || input.capabilities === null) {
    return { enabled: false, reason: { key: "sync.needConnection" } };
  }
  const availability = actionAvailability(input.capabilities, "contacts");
  if (!availability.enabled) {
    return {
      enabled: false,
      reason: { key: "capability.unsupported", params: { version: availability.firmwareVersion } },
    };
  }
  return { enabled: input.sync.kind !== "syncing", reason: null };
}
