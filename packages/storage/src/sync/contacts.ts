import {
  roleFromContactType,
  type ContactReport,
  type GeoPoint,
  type SyncOutcome,
} from "@guardian/domain";

import type { SqlDriver } from "../driver";

/**
 * Merges one contact sync in a single transaction (plan D-8). Reported values are refreshed; the
 * user's label, role and pin are never touched, and rows are never deleted. Only a complete,
 * non-empty batch may mark absent nodes as missing.
 */
export async function applyContactSync(
  driver: SqlDriver,
  reports: readonly ContactReport[],
  opts: {
    complete: boolean;
    now: number;
    origin: { companionPublicKey: string; position: GeoPoint | null };
  },
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
           (public_key, reported_name, reported_role, reported_type, last_heard_at, path_hops, path_companion_key, adv_lat, adv_lon, in_contacts, created_at, synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
         ON CONFLICT(public_key) DO UPDATE SET
           reported_name = excluded.reported_name,
           reported_role = excluded.reported_role,
           reported_type = excluded.reported_type,
           last_heard_at = excluded.last_heard_at,
           path_hops = excluded.path_hops,
           path_companion_key = excluded.path_companion_key,
           adv_lat = excluded.adv_lat,
           adv_lon = excluded.adv_lon,
           in_contacts = 1,
           synced_at = excluded.synced_at`,
        [
          r.publicKey,
          r.name,
          roleFromContactType(r.type),
          r.type,
          r.lastHeardAt,
          r.pathHops,
          opts.origin.companionPublicKey,
          r.position?.lat ?? null,
          r.position?.lon ?? null,
          opts.now,
          opts.now,
        ],
      );
    }

    await tx.run(
      `INSERT INTO contact_sync_origin (id, companion_public_key, companion_lat, companion_lon, synced_at)
       VALUES (1, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         companion_public_key = excluded.companion_public_key,
         companion_lat = excluded.companion_lat,
         companion_lon = excluded.companion_lon,
         synced_at = excluded.synced_at`,
      [
        opts.origin.companionPublicKey,
        opts.origin.position?.lat ?? null,
        opts.origin.position?.lon ?? null,
        opts.now,
      ],
    );

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
