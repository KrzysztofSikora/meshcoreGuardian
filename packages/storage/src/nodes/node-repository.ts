import { z } from "zod";

import { NODE_ROLES, type Node, type NodeRepository, type NodeRole } from "@guardian/domain";

import type { SqlDriver } from "../driver";
import { applyContactSync } from "../sync/contacts";

export class NodeNotFoundError extends Error {
  constructor(readonly publicKey: string) {
    super(`No node with key ${publicKey}`);
    this.name = "NodeNotFoundError";
  }
}

const role = z.enum(NODE_ROLES);

const rowSchema = z
  .object({
    public_key: z.string().length(64),
    reported_name: z.string(),
    reported_role: role,
    reported_type: z.number().int(),
    user_label: z.string().nullable(),
    user_role: role.nullable(),
    last_heard_at: z.number().nullable(),
    in_contacts: z.number().int().min(0).max(1),
    dashboard_pinned: z.number().int().min(0).max(1),
    created_at: z.number(),
    synced_at: z.number(),
  })
  .transform(
    (row): Node => ({
      publicKey: row.public_key,
      reportedName: row.reported_name,
      reportedRole: row.reported_role,
      reportedType: row.reported_type,
      userLabel: row.user_label,
      userRole: row.user_role,
      lastHeardAt: row.last_heard_at,
      inContacts: row.in_contacts === 1,
      dashboardPinned: row.dashboard_pinned === 1,
      createdAt: row.created_at,
      syncedAt: row.synced_at,
    }),
  );

const COLUMNS = `public_key, reported_name, reported_role, reported_type, user_label, user_role,
  last_heard_at, in_contacts, dashboard_pinned, created_at, synced_at`;

export class SqliteNodeRepository implements NodeRepository {
  constructor(private readonly driver: SqlDriver) {}

  applySync(
    reports: Parameters<NodeRepository["applySync"]>[0],
    opts: { complete: boolean; now: number },
  ) {
    return applyContactSync(this.driver, reports, opts);
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
