import type { CheckEvidence } from "./check";

export type SessionRole = "guest" | "read_only" | "read_write" | "admin" | "unknown";

type LoginEvidence = Extract<CheckEvidence, { kind: "login" }>;

const ACL_ROLE_MASK = 0b11;
const ACL_ROLES = ["guest", "read_only", "read_write", "admin"] as const;

/**
 * The role a login granted, from the ACL byte of the login reply (lowest two bits: guest,
 * read-only, read-write, admin). Where the node sent no ACL byte, only the admin flag is known.
 * UNVERIFIED: observed on hardware only as ACL 3 with flag 1 and flag 0; see docs/compatibility.md.
 */
export function sessionRole(
  evidence: Pick<LoginEvidence, "permissions" | "aclPermissions">,
): SessionRole {
  if (evidence.aclPermissions !== null) return ACL_ROLES[evidence.aclPermissions & ACL_ROLE_MASK]!;
  return evidence.permissions === 1 ? "admin" : "unknown";
}

/** The login evidence of a run's checks, if a login check replied with a session. */
export function loginEvidence(
  checks: readonly { evidence: CheckEvidence | null }[],
): LoginEvidence | null {
  for (const check of checks) if (check.evidence?.kind === "login") return check.evidence;
  return null;
}
