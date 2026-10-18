import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { CheckOutcome, DiagnosticRun, DataEraser } from "@guardian/domain";
import {
  SqliteDataEraser,
  SqliteDiagnosticRunRepository,
  SqliteNodeRepository,
} from "@guardian/storage";
import { openTestDb, type TestDb } from "@guardian/storage/testing";

import { InMemorySecretStore } from "../../platform/fake/in-memory";
import { GuestPasswords } from "../nodes/guest-passwords";
import { DataDeletion } from "./data-deletion";
import type { DeletionPorts } from "./ports";

const A = "ab".repeat(32);
const B = "cd".repeat(32);

const check: CheckOutcome = {
  kind: "login",
  result: "RESPONDED",
  reason: "ALL_CHECKS_REPLIED",
  attempts: 1,
  timeoutMs: 5_000,
  timeoutSource: "estimate",
  startedAt: 1,
  durationMs: 1,
  evidence: { kind: "login", permissions: 1, aclPermissions: 0, firmwareLevel: null },
};

const run = (nodePublicKey: string): DiagnosticRun => ({
  nodePublicKey,
  companion: { publicKey: "ef".repeat(32), name: "C", firmwareVersion: "v1" },
  startedAt: 1,
  finishedAt: 2,
  durationMs: 1,
  attemptsUsed: 1,
  attemptsPerCheck: 2,
  result: "RESPONDED",
  reason: "ALL_CHECKS_REPLIED",
  limitations: [],
  checks: [check],
});

const report = (publicKey: string) => ({
  publicKey,
  name: "N",
  type: 2,
  lastHeardAt: 1,
  pathHops: null,
  position: null,
});

describe("DataDeletion (FR-15 AC2, FR-14 AC3, TR-21)", () => {
  let testDb: TestDb;
  let secrets: InMemorySecretStore;
  let passwords: GuestPasswords;
  let calls: string[];
  let busy: boolean;
  let eraser: () => Promise<DataEraser>;

  beforeEach(async () => {
    testDb = await openTestDb();
    secrets = new InMemorySecretStore();
    passwords = new GuestPasswords(secrets);
    calls = [];
    busy = false;
    eraser = async () => new SqliteDataEraser(testDb.driver);
    const nodes = new SqliteNodeRepository(testDb.driver);
    const runs = new SqliteDiagnosticRunRepository(testDb.driver);
    await nodes.applySync([report(A), report(B)], {
      complete: true,
      now: 1,
      origin: { companionPublicKey: "ef".repeat(32), position: null },
    });
    for (const key of [A, B]) {
      await nodes.setLabel(key, "Label");
      await runs.save(run(key));
      await passwords.save(key, "guest-pw");
    }
  });
  afterEach(() => testDb.close());

  const deletion = (overrides: Partial<DeletionPorts> = {}) =>
    new DataDeletion({
      eraser: () => eraser(),
      passwords,
      busy: () => busy,
      refresh: {
        nodes: async () => void calls.push("nodes"),
        runs: async () => void calls.push("runs"),
        history: (key) => void calls.push(`history:${key}`),
      },
      ...overrides,
    });

  const count = async (table: string) =>
    (await testDb.driver.all<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`))[0]!.n;
  const hasPassword = async (key: string) =>
    (await secrets.get(`guest-password.${key}`)) !== null;

  it("deletes one node's rows, label and password, keeps the other, and refreshes", async () => {
    await expect(deletion().deleteNodeHistory(A)).resolves.toEqual({ ok: true });

    expect(await count("diagnostic_runs")).toBe(1);
    const labels = await testDb.driver.all<{ public_key: string; user_label: string | null }>(
      "SELECT public_key, user_label FROM devices ORDER BY public_key",
    );
    expect(labels).toEqual([
      { public_key: A, user_label: null },
      { public_key: B, user_label: "Label" },
    ]);
    expect(await hasPassword(A)).toBe(false);
    expect(await hasPassword(B)).toBe(true);
    expect(calls.sort()).toEqual([`history:${A}`, "nodes", "runs"]);
  });

  it("clears everything: no rows and no key left in the secret store (TR-21)", async () => {
    await expect(deletion().clearAll()).resolves.toEqual({ ok: true });

    for (const table of ["devices", "diagnostic_runs", "diagnostic_checks", "contact_sync_origin"]) {
      expect(await count(table)).toBe(0);
    }
    expect(secrets.keys()).toEqual([]);
    expect(calls.sort()).toEqual(["history:null", "nodes", "runs"]);
  });

  it("refuses while a run or sync is active and touches nothing", async () => {
    busy = true;

    await expect(deletion().clearAll()).resolves.toEqual({ ok: false, reason: "BUSY" });
    await expect(deletion().deleteNodeHistory(A)).resolves.toEqual({ ok: false, reason: "BUSY" });

    expect(await count("diagnostic_runs")).toBe(2);
    expect(await hasPassword(A)).toBe(true);
    expect(calls).toEqual([]);
  });

  it("leaves the secrets when the rows cannot be deleted", async () => {
    eraser = async () => {
      throw new Error("db closed");
    };

    await expect(deletion().clearAll()).resolves.toEqual({ ok: false, reason: "STORAGE_ERROR" });
    await expect(deletion().deleteNodeHistory(A)).resolves.toEqual({
      ok: false,
      reason: "STORAGE_ERROR",
    });

    expect(await hasPassword(A)).toBe(true);
    expect(calls).toEqual([]);
  });

  it("reports SECRET_ERROR after the rows are gone, and a retry finishes the job", async () => {
    secrets.failWith = new Error("keystore locked");
    await expect(deletion().deleteNodeHistory(A)).resolves.toEqual({
      ok: false,
      reason: "SECRET_ERROR",
    });
    await expect(deletion().clearAll()).resolves.toEqual({ ok: false, reason: "SECRET_ERROR" });
    expect(await count("diagnostic_runs")).toBe(0);
    expect(calls).toContain("nodes");

    secrets.failWith = null;
    await expect(deletion().clearAll()).resolves.toEqual({ ok: true });
    expect(secrets.keys()).toEqual([]);
  });

  it("does not report a failed refresh as a failed deletion", async () => {
    const result = await deletion({
      refresh: {
        nodes: async () => {
          throw new Error("read failed");
        },
        runs: async () => undefined,
        history: () => undefined,
      },
    }).clearAll();

    expect(result).toEqual({ ok: true });
  });

  it("shares one run between concurrent calls", async () => {
    let erasures = 0;
    const real = new SqliteDataEraser(testDb.driver);
    eraser = async () => ({
      eraseNodeHistory: (key) => real.eraseNodeHistory(key),
      eraseAll: async () => {
        erasures += 1;
        await real.eraseAll();
      },
    });
    const d = deletion();

    const [first, second] = await Promise.all([d.clearAll(), d.clearAll()]);

    expect(first).toEqual({ ok: true });
    expect(second).toBe(first);
    expect(erasures).toBe(1);
  });

  it("answers BUSY to a different deletion while one is in flight, and clears nothing it did not run", async () => {
    const d = deletion();

    const [node, all] = await Promise.all([d.deleteNodeHistory(A), d.clearAll()]);

    expect(node).toEqual({ ok: true });
    expect(all).toEqual({ ok: false, reason: "BUSY" });
    expect(await hasPassword(B)).toBe(true);
    expect(await count("diagnostic_runs")).toBe(1);
  });

  it("runs again once the previous deletion has finished", async () => {
    let erasures = 0;
    const real = new SqliteDataEraser(testDb.driver);
    eraser = async () => ({
      eraseNodeHistory: (key) => real.eraseNodeHistory(key),
      eraseAll: async () => {
        erasures += 1;
        await real.eraseAll();
      },
    });
    const d = deletion();

    await d.clearAll();
    await d.clearAll();

    expect(erasures).toBe(2);
  });

  it("reports SECRET_ERROR when the password store throws, not only when it answers not-ok", async () => {
    const throwing = {
      remove: async () => {
        throw new Error("keystore locked");
      },
      clearAll: async () => {
        throw new Error("keystore locked");
      },
    } as unknown as GuestPasswords;

    await expect(deletion({ passwords: throwing }).deleteNodeHistory(A)).resolves.toEqual({
      ok: false,
      reason: "SECRET_ERROR",
    });
    await expect(deletion({ passwords: throwing }).clearAll()).resolves.toEqual({
      ok: false,
      reason: "SECRET_ERROR",
    });
    expect(calls).toContain(`history:${A}`);
    expect(calls).toContain("history:null");
  });
});
