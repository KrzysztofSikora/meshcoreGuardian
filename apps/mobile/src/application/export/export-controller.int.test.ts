import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_DIAGNOSTIC_POLICY,
  type Node,
  type NodeRepository,
  type TelemetryRepository,
  buildReport,
  toCsv,
  toJson,
  type DiagnosticRun,
  type DiagnosticRunRepository,
} from "@guardian/domain";
import {
  SqliteDiagnosticRunRepository,
  SqliteNodeRepository,
  SqliteTelemetryRepository,
} from "@guardian/storage";
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
import { GuestPasswords } from "../nodes/guest-passwords";
import { NodesController } from "../nodes/nodes-controller";
import { ExportController, exportFileName, type ExportPorts } from "./export-controller";
import type { ExportFile, ExportFilePort } from "./ports";

const ID = "AA:BB:CC:DD:EE:01";
const ROOM_K = "7c73a8cd01d92e249bf6ed13af3f60499260e408c674ad5e11a44000d87acc28";
const CANARY = "pw-LEAK-CANARY";
const DAY = 86_400_000;

/** A minimal port double (lesson): records what the controller hands over. */
class FilesDouble implements ExportFilePort {
  shared: ExportFile[] = [];
  isAvailable = true;
  failWith: Error | null = null;
  gate: Promise<void> | null = null;
  async available(): Promise<boolean> {
    return this.isAvailable;
  }
  async share(file: ExportFile): Promise<void> {
    if (this.gate !== null) await this.gate;
    if (this.failWith !== null) throw this.failWith;
    this.shared.push(file);
  }
}

describe("ExportController (FR-13)", () => {
  let testDb: TestDb;
  let files: FilesDouble;
  let secrets: InMemorySecretStore;
  let passwords: GuestPasswords;
  let platform: FakeBlePlatform;
  let now: number;

  beforeEach(async () => {
    vi.useFakeTimers();
    testDb = await openTestDb();
    files = new FilesDouble();
    secrets = new InMemorySecretStore();
    passwords = new GuestPasswords(secrets);
    now = Date.UTC(2026, 9, 18, 12, 0, 0);
    vi.setSystemTime(now);
  });
  afterEach(() => {
    vi.useRealTimers();
    testDb.close();
  });

  const runRepo = () => new SqliteDiagnosticRunRepository(testDb.driver);

  const controller = (over: { runs?: () => Promise<DiagnosticRunRepository> } = {}) =>
    new ExportController({
      nodes: async () => new SqliteNodeRepository(testDb.driver),
      runs: over.runs ?? (async () => runRepo()),
      telemetry: async () => new SqliteTelemetryRepository(testDb.driver),
      files,
      clock: () => now,
      redactionDefault: async () => true,
      generatedBy: "meshcore-guardian 0.0.0",
    });

  /** Syncs contacts and runs one real diagnostic; returns the stored run. */
  async function runOnce(): Promise<DiagnosticRun> {
    platform = new FakeBlePlatform(SCENARIOS["diag-ok"]);
    const appState = new InMemoryAppState();
    const session = new CompanionSession({
      platform,
      appState,
      lastCompanionStore: new InMemoryLastCompanionStore(),
    });
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
      repository: async () => runRepo(),
      notice: new InMemoryAirtimeNoticeStore(true),
      password: (publicKey) => passwords.password(publicKey),
      adminPassword: async (publicKey, sent) =>
        void (await passwords.discardAdminPassword(publicKey, sent)),
      policy: () => DEFAULT_DIAGNOSTIC_POLICY,
    });
    const connecting = session.connect(ID);
    await vi.runAllTimersAsync();
    await connecting;
    await vi.runAllTimersAsync();
    expect(nodes.getState().sync.kind).toBe("done");
    const running = runs.start(ROOM_K);
    await vi.runAllTimersAsync();
    await running;
    expect(runs.getState().last?.result).toBe("RESPONDED");
    // Fake timers moved the clock while the run executed; the range ends after it.
    now = Date.now();
    const stored = await runRepo().recentForNode(ROOM_K, 1);
    return (await runRepo().get(stored[0]!.id!))!;
  }

  /** Stores a copy of `run` that finished `daysAgo` days before `now` (samples follow its time). */
  async function copyAt(run: DiagnosticRun, daysAgo: number): Promise<void> {
    const finishedAt = now - daysAgo * DAY;
    const { id: _id, ...rest } = run;
    await runRepo().save({ ...rest, startedAt: finishedAt - run.durationMs, finishedAt });
  }

  async function seedThreeRanges(): Promise<void> {
    const base = await runOnce();
    await copyAt(base, 60);
    await copyAt(base, 20);
    await copyAt(base, 3);
  }

  it("opens on the last 30 days, JSON and the redaction default; older runs are left out (AC1)", async () => {
    await seedThreeRanges();
    const exporter = controller();
    await exporter.open(ROOM_K);
    const state = exporter.getState();
    expect(state).toMatchObject({
      days: 30,
      format: "json",
      redactKeys: true,
      status: "ok",
      loaded: true,
    });
    // The real run plus the copies 20 and 3 days back; the 60-day copy is out.
    expect(state.input!.runs).toHaveLength(3);
    expect(state.input!.samples.length).toBeGreaterThan(0);
    expect(state.input!.range).toEqual({ from: now - 30 * DAY, to: now });
  });

  it("setDays changes the counts for 7 and 90 days", async () => {
    await seedThreeRanges();
    const exporter = controller();
    await exporter.open(ROOM_K);
    await exporter.setDays(7);
    expect(exporter.getState().input!.runs).toHaveLength(2);
    await exporter.setDays(90);
    expect(exporter.getState().input!.runs).toHaveLength(4);
    expect(exporter.getState().days).toBe(90);
  });

  it("a slow earlier read does not overwrite a later one", async () => {
    await seedThreeRanges();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let calls = 0;
    const exporter = controller({
      runs: async () => {
        const repo = runRepo();
        const call = ++calls;
        // Call 1 is open, call 2 the slow 90-day read, call 3 the later 7-day read.
        return new Proxy(repo, {
          get(target, prop, receiver) {
            if (prop === "forNodeBetween" && call === 2)
              return async (...args: Parameters<typeof repo.forNodeBetween>) => {
                await gate;
                return target.forNodeBetween(...args);
              };
            return Reflect.get(target, prop, receiver) as unknown;
          },
        });
      },
    });
    await exporter.open(ROOM_K);
    const slow = exporter.setDays(90);
    await exporter.setDays(7);
    release();
    await slow;
    expect(exporter.getState().days).toBe(7);
    expect(exporter.getState().input!.runs).toHaveLength(2);
  });

  it("open with the same key keeps the user's choices; a new key resets them", async () => {
    await seedThreeRanges();
    const exporter = controller();
    await exporter.open(ROOM_K);
    await exporter.setDays(7);
    exporter.setFormat("csv");
    exporter.setRedactKeys(false);
    await exporter.open(ROOM_K);
    expect(exporter.getState()).toMatchObject({ days: 7, format: "csv", redactKeys: false });
    await exporter.open("00".repeat(32));
    expect(exporter.getState()).toMatchObject({
      days: 30,
      format: "json",
      redactKeys: true,
      status: "notFound",
      loaded: false,
    });
  });

  it("shares a file named by prefix and range whose content equals the serialiser output (AC5)", async () => {
    await seedThreeRanges();
    const exporter = controller();
    await exporter.open(ROOM_K);
    await exporter.share();
    const input = exporter.getState().input!;
    expect(files.shared).toHaveLength(1);
    expect(files.shared[0]).toEqual({
      name: exportFileName(ROOM_K, input.range, "json"),
      mimeType: "application/json",
      content: toJson(buildReport(input, { redactKeys: true })),
    });
    expect(files.shared[0]!.name).toMatch(/^guardian-7c73a8cd-20260918-20261018\.json$/);

    exporter.setFormat("csv");
    await exporter.share();
    expect(files.shared[1]).toEqual({
      name: exportFileName(ROOM_K, input.range, "csv"),
      mimeType: "text/csv",
      content: toCsv(buildReport(input, { redactKeys: true })),
    });
    expect(exporter.getState().share).toBe("idle");
  });

  it("redaction off puts the full keys in the file, on puts none (AC3)", async () => {
    await seedThreeRanges();
    const exporter = controller();
    await exporter.open(ROOM_K);
    await exporter.share();
    expect(files.shared[0]!.content).not.toMatch(/[0-9a-f]{64}/);
    expect(files.shared[0]!.content).toContain('"public_key": "7c73a8cd"');
    exporter.setRedactKeys(false);
    await exporter.share();
    expect(files.shared[1]!.content).toContain(ROOM_K);
    expect(files.shared[1]!.name).not.toContain(ROOM_K);
  });

  it("never exports the guest password or any secure-storage value (AC4, TR-09)", async () => {
    expect(await passwords.save(ROOM_K, CANARY)).toEqual({ ok: true });
    const run = await runOnce();
    const login = platform.lastTransport!.writtenFrames.find((frame) => frame[0] === 0x1a)!;
    // Sanity: the password really went out, so the scan below is not vacuous.
    expect(Buffer.from(login).includes(Buffer.from(CANARY, "utf8"))).toBe(true);
    await copyAt(run, 2);

    const held = [CANARY, await secrets.get(`guest-password.${ROOM_K}`)].filter(
      (v): v is string => v !== null,
    );
    expect(held).toContain(CANARY);
    const exporter = controller();
    await exporter.open(ROOM_K);
    for (const format of ["json", "csv"] as const) {
      for (const redactKeys of [true, false]) {
        exporter.setFormat(format);
        exporter.setRedactKeys(redactKeys);
        await exporter.share();
      }
    }
    expect(files.shared).toHaveLength(4);
    for (const file of files.shared) {
      for (const secret of held) {
        expect(file.content).not.toContain(secret);
        expect(file.content).not.toContain(Buffer.from(secret).toString("hex"));
        expect(file.name).not.toContain(secret);
      }
    }
  });

  it("refuses to share an empty range and makes no port call", async () => {
    await seedThreeRanges();
    now += 200 * DAY;
    const exporter = controller();
    await exporter.open(ROOM_K);
    expect(exporter.getState()).toMatchObject({ status: "ok", loaded: true });
    expect(exporter.getState().input!.runs).toEqual([]);
    await exporter.share();
    expect(files.shared).toEqual([]);
    expect(exporter.getState().share).toBe("idle");
  });

  it("a failing repository is an error, not an empty range; open reads again after it", async () => {
    await seedThreeRanges();
    let failing = true;
    const exporter = controller({
      runs: async () => {
        if (failing) throw new Error("disk");
        return runRepo();
      },
    });
    await exporter.open(ROOM_K);
    expect(exporter.getState()).toMatchObject({ status: "error", loaded: false, input: null });
    await exporter.share();
    expect(files.shared).toEqual([]);
    failing = false;
    await exporter.open(ROOM_K);
    expect(exporter.getState()).toMatchObject({ status: "ok", loaded: true });
  });

  it("reports unavailable sharing without writing, and a throwing share as failed", async () => {
    await seedThreeRanges();
    const exporter = controller();
    await exporter.open(ROOM_K);
    files.isAvailable = false;
    await exporter.share();
    expect(exporter.getState().share).toBe("unavailable");
    expect(files.shared).toEqual([]);
    files.isAvailable = true;
    files.failWith = new Error("EACCES");
    await exporter.share();
    expect(exporter.getState().share).toBe("failed");
    expect(exporter.getState().status).toBe("ok");
    files.failWith = null;
    await exporter.share();
    expect(exporter.getState().share).toBe("idle");
    expect(files.shared).toHaveLength(1);
  });

  it("an export that fails the schema is failed and never reaches the port", async () => {
    await seedThreeRanges();
    const exporter = controller();
    await exporter.open(ROOM_K);
    const input = exporter.getState().input!;
    // A node key that is not hex cannot satisfy the key form of either redaction mode.
    exporter.store.setState({ input: { ...input, node: { ...input.node, publicKey: "xyz" } } });
    await exporter.share();
    expect(exporter.getState().share).toBe("failed");
    expect(files.shared).toEqual([]);
  });

  it("the format changed during a share does not change the file being shared", async () => {
    await seedThreeRanges();
    const exporter = controller();
    await exporter.open(ROOM_K);
    let release!: () => void;
    files.gate = new Promise<void>((resolve) => (release = resolve));
    const sharing = exporter.share();
    exporter.setFormat("csv");
    exporter.setRedactKeys(false);
    expect(exporter.getState().share).toBe("sharing");
    // A second tap while the first is in flight is ignored.
    await exporter.share();
    release();
    await sharing;
    expect(files.shared).toHaveLength(1);
    expect(files.shared[0]!.name.endsWith(".json")).toBe(true);
    expect(files.shared[0]!.content).not.toMatch(/[0-9a-f]{64}/);
  });
});

/** Port doubles with gates, to drive the controller's read ordering and guards (lesson). */
describe("ExportController read and share guards (FR-13)", () => {
  const KEY = "ab".repeat(32);
  const NOW = Date.UTC(2026, 9, 18, 12, 0, 0);
  const node = { publicKey: KEY, reportedName: "n", reportedRole: "repeater" } as unknown as Node;
  const saved = (id?: number) =>
    ({ ...(id === undefined ? {} : { id }), finishedAt: NOW - 1000 }) as unknown as DiagnosticRun;

  interface Doubles {
    nodeCalls: number;
    forRunsArgs: number[][];
    shared: ExportFile[];
    redaction: () => Promise<boolean>;
    node: (call: number) => Promise<Node | null>;
    runs: () => DiagnosticRun[];
  }

  const build = (over: Partial<Doubles> = {}) => {
    const d: Doubles = {
      nodeCalls: 0,
      forRunsArgs: [],
      shared: [],
      redaction: async () => true,
      node: async () => node,
      runs: () => [saved(1)],
      ...over,
    };
    const ports: ExportPorts = {
      nodes: async () =>
        ({
          get: async () => {
            d.nodeCalls++;
            return d.node(d.nodeCalls);
          },
        }) as unknown as NodeRepository,
      runs: async () =>
        ({ forNodeBetween: async () => d.runs() }) as unknown as DiagnosticRunRepository,
      telemetry: async () =>
        ({
          forRuns: async (ids: number[]) => {
            d.forRunsArgs.push(ids);
            return [];
          },
        }) as unknown as TelemetryRepository,
      files: {
        available: async () => true,
        share: async (file) => void d.shared.push(file),
      },
      clock: () => NOW,
      redactionDefault: () => d.redaction(),
      generatedBy: "t",
    };
    return { d, exporter: new ExportController(ports) };
  };

  const gate = () => {
    let release!: () => void;
    const promise = new Promise<void>((resolve) => (release = resolve));
    return { promise, release };
  };

  it("starts idle and redacting before anything is opened, and setDays does nothing", async () => {
    const { d, exporter } = build();
    expect(exporter.getState()).toMatchObject({
      publicKey: null,
      redactKeys: true,
      status: "loading",
      loaded: false,
      share: "idle",
    });
    await exporter.setDays(7);
    expect(d.nodeCalls).toBe(0);
    expect(exporter.getState().days).toBe(30);
    await exporter.share();
    expect(d.shared).toEqual([]);
    expect(exporter.getState().share).toBe("idle");
  });

  it("an open of the key being read joins that read instead of starting another", async () => {
    const hold = gate();
    const { d, exporter } = build({
      node: async () => {
        await hold.promise;
        return node;
      },
    });
    const first = exporter.open(KEY);
    await vi.waitFor(() => expect(exporter.getState().publicKey).toBe(KEY));
    const second = exporter.open(KEY);
    hold.release();
    await Promise.all([first, second]);
    expect(d.nodeCalls).toBe(1);
    expect(exporter.getState().status).toBe("ok");
    await exporter.open(KEY);
    expect(d.nodeCalls).toBe(1);
  });

  it("takes the redaction default from the setting, and redacts when it cannot be read", async () => {
    const off = build({ redaction: async () => false });
    await off.exporter.open(KEY);
    expect(off.exporter.getState().redactKeys).toBe(false);
    const broken = build({
      redaction: async () => {
        throw new Error("settings");
      },
    });
    await broken.exporter.open(KEY);
    expect(broken.exporter.getState()).toMatchObject({ redactKeys: true, status: "ok" });
  });

  it("asks for telemetry of saved runs only", async () => {
    const { d, exporter } = build({ runs: () => [saved(5), saved(), saved(7)] });
    await exporter.open(KEY);
    expect(d.forRunsArgs).toEqual([[5, 7]]);
  });

  it("shows loading until the first read finishes, then keeps the preview while it re-reads", async () => {
    const first = gate();
    const second = gate();
    const { d, exporter } = build({
      node: async (call) => {
        await (call === 1 ? first : second).promise;
        return node;
      },
    });
    const opening = exporter.open(KEY);
    await vi.waitFor(() => expect(d.nodeCalls).toBe(1));
    expect(exporter.getState()).toMatchObject({ status: "loading", loaded: false, share: "idle" });
    first.release();
    await opening;
    exporter.store.setState({ share: "failed" });
    const rereading = exporter.setDays(7);
    expect(exporter.getState()).toMatchObject({ status: "ok", loaded: true, share: "idle" });
    second.release();
    await rereading;
    expect(d.nodeCalls).toBe(2);
  });

  it("refuses to share while a re-read has failed, though the old preview is still there", async () => {
    const { d, exporter } = build({
      node: async (call) => {
        if (call === 2) throw new Error("disk");
        return node;
      },
    });
    await exporter.open(KEY);
    await exporter.setDays(7);
    expect(exporter.getState()).toMatchObject({ status: "error", loaded: true });
    expect(exporter.getState().input).not.toBeNull();
    await exporter.share();
    expect(d.shared).toEqual([]);
    // Refused outright: not attempted and failed.
    expect(exporter.getState().share).toBe("idle");
  });

  it("a slow earlier read that finds no node or fails does not overwrite a later good one", async () => {
    for (const late of ["missing", "failing"] as const) {
      const hold = gate();
      const { exporter } = build({
        node: async (call) => {
          if (call === 2) {
            await hold.promise;
            if (late === "failing") throw new Error("disk");
            return null;
          }
          return node;
        },
      });
      await exporter.open(KEY);
      const slow = exporter.setDays(90);
      await exporter.setDays(7);
      hold.release();
      await slow;
      expect(exporter.getState()).toMatchObject({ status: "ok", loaded: true, days: 7 });
      expect(exporter.getState().input).not.toBeNull();
    }
  });
});
