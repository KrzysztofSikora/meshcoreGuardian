import { roleFromContactType, type ContactReport, type SyncOutcome } from "@guardian/domain";

import type { SqlDriver } from "../driver";

/**
 * Merges one contact sync in a single transaction (plan D-8). Reported values are refreshed; the
 * user's label, role and pin are never touched, and rows are never deleted. Only a complete,
 * non-empty batch may mark absent nodes as missing.
 */
export async function applyContactSync(
  driver: SqlDriver,
  reports: readonly ContactReport[],
  opts: { complete: boolean; now: number },
): Promise<SyncOutcome> {
  return driver.transaction(async (tx) => {
    const keys = JSON.stringify(reports.map((r) => r.publicKey));
    const known = await tx.all<{ n: number }>(
      "SELECT count(*) AS n FROM devices WHERE public_key IN (SELECT value FROM json_each(?))",
      [keys],
    );
    const existing = known[0]?.n ?? 0;

    for (const r of reports) {
      await tx.run(
        `INSERT INTO devices
           (public_key, reported_name, reported_role, reported_type, last_heard_at, in_contacts, created_at, synced_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?)
         ON CONFLICT(public_key) DO UPDATE SET
           reported_name = excluded.reported_name,
           reported_role = excluded.reported_role,
           reported_type = excluded.reported_type,
           last_heard_at = excluded.last_heard_at,
           in_contacts = 1,
           synced_at = excluded.synced_at`,
        [r.publicKey, r.name, roleFromContactType(r.type), r.type, r.lastHeardAt, opts.now, opts.now],
      );
    }

    let markedMissing = 0;
    if (opts.complete && reports.length > 0) {
      const result = await tx.run(
        `UPDATE devices SET in_contacts = 0
         WHERE in_contacts = 1 AND public_key NOT IN (SELECT value FROM json_each(?))`,
        [keys],
      );
      markedMissing = result.changes;
    }

    return { added: reports.length - existing, updated: existing, markedMissing };
  });
}
