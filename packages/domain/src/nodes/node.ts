export const NODE_ROLES = ["repeater", "room_server", "chat", "unknown"] as const;

export type NodeRole = (typeof NODE_ROLES)[number];

export const LABEL_MAX_LENGTH = 64;

/** One contact as the companion reports it. `lastHeardAt` is epoch ms on the companion clock. */
export interface ContactReport {
  /** 64 lower-case hex characters. */
  publicKey: string;
  name: string;
  type: number;
  lastHeardAt: number | null;
}

/** A known node. Reported values come from the protocol; user values always win. Times are epoch ms. */
export interface Node {
  publicKey: string;
  reportedName: string;
  reportedRole: NodeRole;
  reportedType: number;
  userLabel: string | null;
  userRole: NodeRole | null;
  lastHeardAt: number | null;
  inContacts: boolean;
  dashboardPinned: boolean;
  createdAt: number;
  syncedAt: number;
}

/** Contact type 1 chat, 2 repeater, 3 room server; anything else is Unknown (Q-03). */
export function roleFromContactType(type: number): NodeRole {
  switch (type) {
    case 1:
      return "chat";
    case 2:
      return "repeater";
    case 3:
      return "room_server";
    default:
      return "unknown";
  }
}

export function effectiveRole(node: Node): NodeRole {
  return node.userRole ?? node.reportedRole;
}

/** The user label, else the reported name, else null (the UI shows a key prefix). */
export function displayName(node: Node): string | null {
  if (node.userLabel !== null) return node.userLabel;
  return node.reportedName === "" ? null : node.reportedName;
}

export function keyPrefix(publicKey: string): string {
  return publicKey.slice(0, 8);
}

/** Chat contacts are listed on the Dashboard only when the user pinned them. */
export function isOnDashboard(node: Node): boolean {
  return effectiveRole(node) !== "chat" || node.dashboardPinned;
}

export type LabelResult = { ok: true; value: string | null } | { ok: false; reason: "TOO_LONG" };

/** Trims; empty removes the label; the limit counts code points. */
export function normalizeLabel(input: string): LabelResult {
  const trimmed = input.trim();
  if (trimmed === "") return { ok: true, value: null };
  if ([...trimmed].length > LABEL_MAX_LENGTH) return { ok: false, reason: "TOO_LONG" };
  return { ok: true, value: trimmed };
}

/** `lastMod` is seconds on the companion clock; 0 means not reported (UNVERIFIED, plan D-7). */
export function contactLastHeard(lastMod: number): number | null {
  return lastMod === 0 ? null : lastMod * 1000;
}

function sortName(node: Node): string {
  return (displayName(node) ?? "").toLowerCase();
}

export function sortNodes(nodes: readonly Node[]): Node[] {
  return [...nodes].sort((a, b) => {
    const byName = sortName(a).localeCompare(sortName(b));
    if (byName !== 0) return byName;
    return a.publicKey < b.publicKey ? -1 : a.publicKey > b.publicKey ? 1 : 0;
  });
}
