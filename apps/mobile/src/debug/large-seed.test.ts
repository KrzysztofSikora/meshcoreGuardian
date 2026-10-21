import { describe, expect, it } from "vitest";

import { SqliteDiagnosticRunRepository, SqliteNodeRepository } from "@guardian/storage";
import { openTestDb } from "@guardian/storage/testing";

import {
  LARGE_SEED_TARGET,
  largeSeedContacts,
  largeSeedRuns,
} from "./large-seed";

const NOW = 1_800_000_000_000;
const DAY_MS = 86_400_000;
const COMPANION = { publicKey: "ef".repeat(32), name: "Seed companion", firmwareVersion: "v1.17.1" };

describe("large seed (NFR-06 trace data)", () => {
  const contacts = largeSeedContacts(NOW);
  const runs = largeSeedRuns(NOW, COMPANION);

  it("has 200 contacts with unique 64-hex keys, repeaters and room servers", () => {
    expect(contacts).toHaveLength(200);
    expect(new Set(contacts.map((c) => c.publicKey)).size).toBe(200);
    for (const c of contacts) expect(c.publicKey).toMatch(/^[0-9a-f]{64}$/);
    expect(new Set(contacts.map((c) => c.type))).toEqual(new Set([2, 3]));
  });

  it("has 1,000 runs, 801 on the target within 30 days, at least 50 with a battery reading", () => {
    expect(runs).toHaveLength(1000);
    const target = runs.filter((r) => r.nodePublicKey === LARGE_SEED_TARGET);
    expect(target).toHaveLength(801);
    for (const r of target) {
      expect(r.startedAt).toBeGreaterThanOrEqual(NOW - 30 * DAY_MS);
      expect(r.finishedAt).toBeLessThan(NOW);
    }
    const withVoltage = target.filter((r) =>
      r.checks.some((c) => c.evidence?.kind === "status" && c.evidence.battMilliVolts > 0),
    );
    expect(withVoltage.length).toBeGreaterThanOrEqual(50);
    const others = runs.filter((r) => r.nodePublicKey !== LARGE_SEED_TARGET);
    expect(new Set(others.map((r) => r.nodePublicKey)).size).toBe(199);
  });

  it("is deterministic for a given now", () => {
    expect(largeSeedRuns(NOW, COMPANION)).toEqual(runs);
    expect(largeSeedContacts(NOW)).toEqual(contacts);
  });

  it("stores through the repositories without marking a real node missing or moving the origin", async () => {
    const db = await openTestDb();
    const nodes = new SqliteNodeRepository(db.driver);
    const real = "ab".repeat(32);
    const origin = { companionPublicKey: "cd".repeat(32), position: null };
    await nodes.applySync(
      [{ publicKey: real, name: "Real", type: 2, lastHeardAt: 1, pathHops: 1, position: null }],
      { complete: true, now: NOW - 1000, origin },
    );
    const before = await nodes.syncOrigin();

    await nodes.applySync(contacts, { complete: false, now: NOW, origin: { ...origin } });
    const repository = new SqliteDiagnosticRunRepository(db.driver);
    for (const r of runs) await repository.save(r);

    expect((await nodes.get(real))?.inContacts).toBe(true);
    expect((await nodes.listAll()).length).toBe(201);
    expect((await nodes.syncOrigin())?.companionPublicKey).toBe(before?.companionPublicKey);
    expect((await repository.recentForNode(LARGE_SEED_TARGET, 50)).length).toBe(50);
  });
});
