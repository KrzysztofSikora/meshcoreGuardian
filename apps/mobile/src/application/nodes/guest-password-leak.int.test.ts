import { existsSync, readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_DIAGNOSTIC_POLICY } from "@guardian/domain";
import { SqliteDiagnosticRunRepository, SqliteNodeRepository } from "@guardian/storage";
import { openTestDb, type TestDb } from "@guardian/storage/testing";

import { SCENARIOS } from "../../debug/scenarios";
import { FakeBlePlatform } from "../../platform/fake/fake-ble-platform";
import {
  InMemoryAirtimeNoticeStore,
  InMemoryAppState,
  InMemoryLastCompanionStore,
  InMemorySecretStore,
} from "../../platform/fake/in-memory";
import { CompanionSession } from "../connection/companion-session";
import { RunController } from "../diagnostics/run-controller";
import { GuestPasswords } from "./guest-passwords";
import { NodesController } from "./nodes-controller";

const ID = "AA:BB:CC:DD:EE:01";
const ROOM_K = "7c73a8cd01d92e249bf6ed13af3f60499260e408c674ad5e11a44000d87acc28";
const CANARY = "pw-LEAK-CANARY";

const CONSOLE_METHODS = ["log", "info", "warn", "error", "debug", "trace"] as const;

describe("guest password leak scan (FR-14 AC2, TR-09)", () => {
  let testDb: TestDb;

  beforeEach(async () => {
    vi.useFakeTimers();
    testDb = await openTestDb();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    testDb.close();
  });

  it("the canary is sent on the radio but never reaches the database files or the log", async () => {
    const logged: string[] = [];
    for (const method of CONSOLE_METHODS) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        logged.push(
          args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "),
        );
      });
    }

    const platform = new FakeBlePlatform(SCENARIOS["diag-ok"]);
    const appState = new InMemoryAppState();
    const session = new CompanionSession({
      platform,
      appState,
      lastCompanionStore: new InMemoryLastCompanionStore(),
    });
    const passwords = new GuestPasswords(new InMemorySecretStore());
    const nodes = new NodesController({
      session,
      appState,
      clock: Date.now,
      repository: async () => new SqliteNodeRepository(testDb.driver),
    });
    const runs = new RunController({
      session,
      appState,
      clock: Date.now,
      repository: async () => new SqliteDiagnosticRunRepository(testDb.driver),
      notice: new InMemoryAirtimeNoticeStore(true),
      password: (publicKey) => passwords.password(publicKey),
      adminPassword: async (publicKey) => void (await passwords.discardAdminPassword(publicKey)),
      policy: () => DEFAULT_DIAGNOSTIC_POLICY,
    });

    const connecting = session.connect(ID);
    await vi.runAllTimersAsync();
    await connecting;
    await vi.runAllTimersAsync();
    expect(nodes.getState().sync.kind).toBe("done");

    expect(await passwords.save(ROOM_K, CANARY)).toEqual({ ok: true });
    const running = runs.start(ROOM_K);
    await vi.runAllTimersAsync();
    await running;
    expect(runs.getState().last?.result).toBe("RESPONDED");

    // Sanity: the canary really went out in the login frame, so the scan below is not vacuous.
    const login = platform.lastTransport!.writtenFrames.find((frame) => frame[0] === 0x1a)!;
    expect(Buffer.from(login).includes(Buffer.from(CANARY, "utf8"))).toBe(true);

    // Scan the files while they still exist: `testDb.close()` deletes the temp directory.
    testDb.db.close();
    expect(existsSync(testDb.path)).toBe(true);
    const files = [testDb.path, `${testDb.path}-wal`, `${testDb.path}-shm`].filter(existsSync);
    const bytes = files.map((file) => readFileSync(file));
    expect(bytes[0]!.includes(Buffer.from(ROOM_K, "utf8"))).toBe(true);
    const needles = [Buffer.from(CANARY, "utf8"), Buffer.from(Buffer.from(CANARY).toString("hex"))];
    for (const content of bytes) {
      for (const needle of needles) expect(content.includes(needle)).toBe(false);
    }
    const log = logged.join("\n");
    expect(log).not.toContain(CANARY);
    expect(log).not.toContain(Buffer.from(CANARY).toString("hex"));
  });
});
