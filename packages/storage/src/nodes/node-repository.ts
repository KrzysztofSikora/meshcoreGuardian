import { z } from "zod";

import {
  NODE_ROLES,
  type GeoPoint,
  type Node,
  type NodeRepository,
  type NodeRole,
  type SyncOrigin,
} from "@guardian/domain";

import type { SqlDriver } from "../driver";
import { applyContactSync } from "../sync/contacts";

export class NodeNotFoundError extends Error {
  constructor(readonly publicKey: string) {
    super(`No node with key ${publicKey}`);
    this.name = "NodeNotFoundError";
  }
}

const role = z.enum(NODE_ROLES);

/** A position needs both coordinates; half a pair counts as not advertised. */
function point(lat: number | null, lon: number | null): GeoPoint | null {
  return lat === null || lon === null ? null : { lat, lon };
}

const originSchema = z
  .object({
    companion_public_key: z.string().length(64),
    companion_lat: z.number().min(-90).max(90).nullable(),
    companion_lon: z.number().min(-180).max(180).nullable(),
    synced_at: z.number(),
  })
  .transform((row): SyncOrigin => ({
    companionPublicKey: row.companion_public_key,
    position: point(row.companion_lat, row.companion_lon),
    at: row.synced_at,
  }));

const rowSchema = z
  .object({
    public_key: z.string().length(64),
    reported_name: z.string(),
    reported_role: role,
    reported_type: z.number().int(),
    user_label: z.string().nullable(),
    user_role: role.nullable(),
    last_heard_at: z.number().nullable(),
    path_hops: z.number().int().min(0).max(63).nullable(),
    path_companion_key: z.string().length(64).nullable(),
    adv_lat: z.number().min(-90).max(90).nullable(),
    adv_lon: z.number().min(-180).max(180).nullable(),
    in_contacts: z.number().int().min(0).max(1),
    dashboard_pinned: z.number().int().min(0).max(1),
    created_at: z.number(),
    synced_at: z.number(),
  })
  .transform((row): Node => ({
    publicKey: row.public_key,
    reportedName: row.reported_name,
    reportedRole: row.reported_role,
    reportedType: row.reported_type,
    userLabel: row.user_label,
    userRole: row.user_role,
    lastHeardAt: row.last_heard_at,
    pathHops: row.path_hops,
    position: point(row.adv_lat, row.adv_lon),
    pathCompanionKey: row.path_companion_key,
    inContacts: row.in_contacts === 1,
    dashboardPinned: row.dashboard_pinned === 1,
    createdAt: row.created_at,
    syncedAt: row.synced_at,
  }));

const COLUMNS = `public_key, reported_name, reported_role, reported_type, user_label, user_role,
  last_heard_at, path_hops, path_companion_key, adv_lat, adv_lon, in_contacts, dashboard_pinned, created_at, synced_at`;

export class SqliteNodeRepository implements NodeRepository {
  constructor(private readonly driver: SqlDriver) {}

  applySync(
    reports: Parameters<NodeRepository["applySync"]>[0],
    opts: Parameters<NodeRepository["applySync"]>[1],
  ) {
    return applyContactSync(this.driver, reports, opts);
  }

  async syncOrigin(): Promise<SyncOrigin | null> {
    const rows = await this.driver.all<unknown>(
      "SELECT companion_public_key, companion_lat, companion_lon, synced_at FROM contact_sync_origin WHERE id = 1",
    );
    return rows[0] === undefined ? null : originSchema.parse(rows[0]);
  }

  async listAll(): Promise<Node[]> {
    const rows = await this.driver.all<unknown>(`SELECT ${COLUMNS} FROM devices`);
    return rows.map((row) => rowSchema.parse(row));
  }

  async get(publicKey: string): Promise<Node | null> {
    const rows = await this.driver.all<unknown>(
      `SELECT ${COLUMNS} FROM devices WHERE public_key = ?`,
      [publicKey],
    );
    return rows[0] === undefined ? null : rowSchema.parse(rows[0]);
  }

  setLabel(publicKey: string, label: string | null): Promise<void> {
    return this.update("user_label", label, publicKey);
  }

  setRole(publicKey: string, userRole: NodeRole | null): Promise<void> {
    return this.update("user_role", userRole, publicKey);
  }

  pinToDashboard(publicKey: string): Promise<void> {
    return this.update("dashboard_pinned", 1, publicKey);
  }

  private async update(column: string, value: string | number | null, publicKey: string) {
    const { changes } = await this.driver.run(
      `UPDATE devices SET ${column} = ? WHERE public_key = ?`,
      [value, publicKey],
    );
    if (changes === 0) throw new NodeNotFoundError(publicKey);
  }
}
