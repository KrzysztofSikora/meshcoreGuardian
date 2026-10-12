import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type AbortSignalLike,
  BusyError,
  CooldownError,
  FakeTransport,
  MeshClient,
  type MeshTransport,
  REMOTE_FRAMES,
  RemoteRequestLedger,
  TransportUnavailableError,
  type RunChecksRequest,
} from "../src";

const ROOM_K = "7c73a8cd01d92e249bf6ed13af3f60499260e408c674ad5e11a44000d87acc28";
const PREFIX = "7c73a8cd01d9";
const POLICY = { attempts: 2, overrideMs: null };
const ALL = ["login", "status", "telemetry"] as const;

const bytes = (hex: string) => Uint8Array.from(hex.match(/../g) ?? [], (b) => parseInt(b, 16));
const hex = (data: Uint8Array) => Array.from(data, (b) => b.toString(16).padStart(2, "0")).join("");
const recordedHex = (index: number) => REMOTE_FRAMES[index]!.hex;
const LOGIN_TX = recordedHex(0);
const STATUS_TX = recordedHex(3);
const TELEMETRY_TX = recordedHex(6);

/** `sent` with the given estimate (ms), the way the companion confirms a request. */
const sentFrame = (estMs: number) =>
  bytes(
    `0600aabbccdd${[0, 8, 16, 24].map((s) => ((estMs >>> s) & 0xff).toString(16).padStart(2, "0")).join("")}`,
  );
const LOGIN_OK = bytes(recordedHex(2));
const STATUS_OK = bytes(recordedHex(5));
const LOGIN_FAIL = bytes(`8600${PREFIX}`);

function abortable() {
  const listeners = new Set<() => void>();
  const signal: AbortSignalLike & { aborted: boolean } = {
    aborted: false,
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener),
  };
  return {
    signal,
    listenerCount: () => listeners.size,
    abort() {
      signal.aborted = true;
      for (const listener of [...listeners]) listener();
    },
  };
}

/** A minimal port double: the test decides which frame arrives when. */
function scriptedTransport() {
  const frameListeners = new Set<(frame: Uint8Array) => void>();
  const disconnectListeners = new Set<() => void>();
  const written: string[] = [];
  const transport: MeshTransport = {
    write: async (data) => void written.push(hex(data)),
    close: async () => undefined,
    onFrame: (callback) => {
      frameListeners.add(callback);
      return () => frameListeners.delete(callback);
    },
    onDisconnect: (callback) => {
      disconnectListeners.add(callback);
      return () => disconnectListeners.delete(callback);
    },
  };
  return {
    transport,
    written,
    emit(data: Uint8Array) {
      for (const listener of [...frameListeners]) listener(data);
    },
    drop() {
      for (const listener of [...disconnectListeners]) listener();
    },
  };
}

function request(overrides: Partial<RunChecksRequest> = {}): RunChecksRequest {
  return { publicKey: ROOM_K, checks: ALL, password: "", policy: POLICY, ...overrides };
}

/** Starts a run and keeps the outcome observable without unhandled rejections. */
function start(client: MeshClient, overrides: Partial<RunChecksRequest> = {}) {
  return client.runChecks(request(overrides)).then(
    (value) => ({ value }) as const,
    (error: unknown) => ({ error }) as const,
  );
}

async function tick(ms = 0) {
  await vi.advanceTimersByTimeAsync(ms);
}

describe("MeshClient.runChecks", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  describe("on the recorded exchanges", () => {
    it("replies to login, status and telemetry with the recorded evidence, writing the recorded frames", async () => {
      const transport = FakeTransport.fromFrames(REMOTE_FRAMES);
      const client = new MeshClient(transport);
      const progress: unknown[] = [];
      const outcome = start(client, { onProgress: (p) => progress.push(p) });
      await tick(10_000);
      const result = await outcome;
      if (!("value" in result)) throw result.error;

      expect(transport.writtenFrames.map(hex)).toEqual([LOGIN_TX, STATUS_TX, TELEMETRY_TX]);
      expect(result.value.map((o) => [o.kind, o.result, o.reason, o.attempts])).toEqual([
        ["login", "RESPONDED", "ALL_CHECKS_REPLIED", 1],
        ["status", "RESPONDED", "ALL_CHECKS_REPLIED", 1],
        ["telemetry", "RESPONDED", "ALL_CHECKS_REPLIED", 1],
      ]);
      const [login, status, telemetry] = result.value;
      expect(login!.evidence).toEqual({
        kind: "login",
        permissions: 1,
        aclPermissions: 3,
        firmwareLevel: 1,
      });
      expect(status!.evidence).toMatchObject({
        kind: "status",
        battMilliVolts: 3353,
        noiseFloor: -117,
        lastRssi: -34,
        totalUpTimeSecs: 2837,
        lastSnrX4: 53,
      });
      expect(telemetry!.evidence).toEqual({
        kind: "telemetry",
        values: [
          { channel: 1, type: 116, value: 3.35 },
          { channel: 1, type: 103, value: 30 },
        ],
        lppHex: "0174014f0167012c00000000",
      });
      expect(login).toMatchObject({ timeoutMs: 7_356, timeoutSource: "estimate" });
      expect(status).toMatchObject({ timeoutMs: 5_388, timeoutSource: "estimate" });
      expect(login!.durationMs).toBeGreaterThan(0);
      expect(progress).toEqual([
        { check: "login", attempt: 1, of: 2 },
        { check: "status", attempt: 1, of: 2 },
        { check: "telemetry", attempt: 1, of: 2 },
      ]);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("carries the given password in the login frame", async () => {
      const t = scriptedTransport();
      const client = new MeshClient(t.transport);
      void start(client, { checks: ["login"], password: "hello" });
      await tick();
      expect(t.written).toEqual([`${LOGIN_TX}68656c6c6f`]);
    });
  });

  describe("replies", () => {
    it("ends the run at a rejected login without writing status", async () => {
      const t = scriptedTransport();
      const client = new MeshClient(t.transport);
      const outcome = start(client);
      await tick();
      t.emit(sentFrame(2_694));
      t.emit(LOGIN_FAIL);
      const result = await outcome;
      if (!("value" in result)) throw result.error;
      expect(result.value.map((o) => [o.kind, o.result, o.reason])).toEqual([
        ["login", "RESPONDED", "LOGIN_REJECTED"],
      ]);
      expect(t.written).toEqual([LOGIN_TX]);
    });

    it("ignores a push from another node and unrelated frames", async () => {
      const t = scriptedTransport();
      const client = new MeshClient(t.transport);
      const outcome = start(client, { checks: ["status"] });
      await tick();
      t.emit(sentFrame(2_694));
      t.emit(bytes(`87007c73a8cd01d8${STATUS_OK_PAYLOAD}`)); // another node's prefix
      t.emit(bytes("8837de")); // rx log
      t.emit(bytes("8300")); // advert push
      await tick(1_000);
      t.emit(STATUS_OK);
      const result = await outcome;
      if (!("value" in result)) throw result.error;
      expect(result.value[0]).toMatchObject({ kind: "status", result: "RESPONDED" });
    });

    it("ignores a kind that does not fit the current check", async () => {
      const t = scriptedTransport();
      const client = new MeshClient(t.transport);
      const outcome = start(client, { checks: ["login"] });
      await tick();
      t.emit(sentFrame(2_694));
      t.emit(STATUS_OK);
      await tick(7_355);
      t.emit(LOGIN_OK);
      const result = await outcome;
      if (!("value" in result)) throw result.error;
      expect(result.value[0]).toMatchObject({ kind: "login", result: "RESPONDED" });
    });

    it("accepts a late reply of attempt 1 while attempt 2 waits", async () => {
      const t = scriptedTransport();
      const client = new MeshClient(t.transport);
      const outcome = start(client, { checks: ["status"] });
      await tick();
      t.emit(sentFrame(2_694));
      await tick(5_388);
      expect(t.written).toHaveLength(2);
      t.emit(STATUS_OK);
      const result = await outcome;
      if (!("value" in result)) throw result.error;
      expect(result.value[0]).toMatchObject({ result: "RESPONDED", attempts: 2 });
    });
  });

  describe("timeouts and attempts", () => {
    it("arms the timer from sent with the estimate times two, and repeats once", async () => {
      const t = scriptedTransport();
      const client = new MeshClient(t.transport);
      const outcome = start(client, { checks: ["status"] });
      await tick();
      t.emit(sentFrame(2_694));
      await tick(5_387);
      expect(t.written).toEqual([STATUS_TX]);
      await tick(1);
      expect(t.written).toEqual([STATUS_TX, STATUS_TX]);
      t.emit(sentFrame(2_694));
      await tick(5_387);
      expect(t.written).toHaveLength(2);
      await tick(1);
      const result = await outcome;
      if (!("value" in result)) throw result.error;
      expect(result.value).toHaveLength(1);
      expect(result.value[0]).toMatchObject({
        result: "NO_RESPONSE",
        reason: "NO_REPLY",
        attempts: 2,
        timeoutMs: 5_388,
        timeoutSource: "estimate",
      });
      expect(t.written).toHaveLength(2);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("waits 15 s without an estimate", async () => {
      const t = scriptedTransport();
      const client = new MeshClient(t.transport);
      const outcome = start(client, {
        checks: ["status"],
        policy: { attempts: 1, overrideMs: null },
      });
      await tick();
      t.emit(sentFrame(0));
      await tick(14_999);
      expect(vi.getTimerCount()).toBe(1);
      await tick(1);
      const result = await outcome;
      if (!("value" in result)) throw result.error;
      expect(result.value[0]).toMatchObject({ timeoutMs: 15_000, timeoutSource: "default" });
    });

    it("uses an override over the estimate", async () => {
      const t = scriptedTransport();
      const client = new MeshClient(t.transport);
      const outcome = start(client, {
        checks: ["status"],
        policy: { attempts: 1, overrideMs: 7_000 },
      });
      await tick();
      t.emit(sentFrame(2_694));
      await tick(6_999);
      expect(vi.getTimerCount()).toBe(1);
      await tick(1);
      const result = await outcome;
      if (!("value" in result)) throw result.error;
      expect(result.value[0]).toMatchObject({ timeoutMs: 7_000, timeoutSource: "override" });
    });

    it("sends exactly the allowed number of attempts on silence", async () => {
      const t = scriptedTransport();
      const client = new MeshClient(t.transport);
      const outcome = start(client, {
        checks: ["status"],
        policy: { attempts: 3, overrideMs: null },
      });
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await tick();
        t.emit(sentFrame(2_694));
        await tick(5_388);
      }
      await tick(60_000);
      const result = await outcome;
      if (!("value" in result)) throw result.error;
      expect(t.written).toHaveLength(3);
      expect(result.value[0]).toMatchObject({ attempts: 3, reason: "NO_REPLY" });
    });

    it("stops after a check that did not reply: later checks are not written", async () => {
      const t = scriptedTransport();
      const client = new MeshClient(t.transport);
      const outcome = start(client, { policy: { attempts: 1, overrideMs: null } });
      await tick();
      t.emit(sentFrame(2_694));
      t.emit(LOGIN_OK);
      await tick();
      t.emit(sentFrame(2_694));
      await tick(5_388);
      const result = await outcome;
      if (!("value" in result)) throw result.error;
      expect(result.value.map((o) => [o.kind, o.result])).toEqual([
        ["login", "RESPONDED"],
        ["status", "NO_RESPONSE"],
      ]);
      expect(t.written).toEqual([LOGIN_TX, STATUS_TX]);
    });

    it("rejects an out-of-range override or attempts before writing", async () => {
      const t = scriptedTransport();
      const client = new MeshClient(t.transport);
      const bad = [
        { attempts: 2, overrideMs: 4_999 },
        { attempts: 0, overrideMs: null },
        { attempts: 4, overrideMs: null },
      ];
      for (const policy of bad) {
        await expect(client.runChecks(request({ policy }))).rejects.toThrow(RangeError);
      }
      expect(t.written).toEqual([]);
    });
  });

  describe("when the companion does not confirm or refuses", () => {
    it("reports COMPANION_NO_ACK after 5 s without sent and does not retry", async () => {
      const t = scriptedTransport();
      const client = new MeshClient(t.transport);
      const outcome = start(client);
      await tick(4_999);
      expect(vi.getTimerCount()).toBe(1);
      await tick(1);
      const result = await outcome;
      if (!("value" in result)) throw result.error;
      expect(result.value).toHaveLength(1);
      expect(result.value[0]).toMatchObject({
        result: "TRANSPORT_UNAVAILABLE",
        reason: "COMPANION_NO_ACK",
        attempts: 1,
        timeoutMs: null,
      });
      expect(t.written).toHaveLength(1);
    });

    it("reports COMMAND_REJECTED with the code of an err frame", async () => {
      const t = scriptedTransport();
      const client = new MeshClient(t.transport);
      const outcome = start(client);
      await tick();
      t.emit(bytes("0102"));
      const result = await outcome;
      if (!("value" in result)) throw result.error;
      expect(result.value[0]).toMatchObject({
        result: "UNSUPPORTED",
        reason: "COMMAND_REJECTED",
        evidence: { kind: "rejected", code: 2 },
      });
      expect(t.written).toHaveLength(1);
    });

    it("keeps a null code when the err frame has none", async () => {
      const t = scriptedTransport();
      const client = new MeshClient(t.transport);
      const outcome = start(client);
      await tick();
      t.emit(bytes("01"));
      const result = await outcome;
      if (!("value" in result)) throw result.error;
      expect(result.value[0]!.evidence).toEqual({ kind: "rejected", code: null });
    });

    it("does not treat an err frame after sent as a rejection", async () => {
      const t = scriptedTransport();
      const client = new MeshClient(t.transport);
      const outcome = start(client, {
        checks: ["status"],
        policy: { attempts: 1, overrideMs: null },
      });
      await tick();
      t.emit(sentFrame(2_694));
      t.emit(bytes("0102"));
      await tick(5_388);
      const result = await outcome;
      if (!("value" in result)) throw result.error;
      expect(result.value[0]).toMatchObject({ result: "NO_RESPONSE" });
    });
  });

  describe("malformed frames", () => {
    it("fails the check with a raw summary when the awaited push is malformed", async () => {
      const t = scriptedTransport();
      const client = new MeshClient(t.transport);
      const outcome = start(client, { checks: ["status"] });
      await tick();
      t.emit(sentFrame(2_694));
      t.emit(bytes("8700"));
      const result = await outcome;
      if (!("value" in result)) throw result.error;
      expect(result.value[0]).toMatchObject({
        result: "UNSUPPORTED",
        reason: "MALFORMED_RESPONSE",
        attempts: 1,
        evidence: { kind: "malformed", code: 0x87, length: 2, hex: "8700" },
      });
    });

    it("keeps at most 64 bytes of a long malformed frame", async () => {
      const t = scriptedTransport();
      const client = new MeshClient(t.transport);
      const outcome = start(client, { checks: ["telemetry"] });
      await tick();
      t.emit(sentFrame(2_694));
      // Twenty complete voltage readings, then one cut short: the LPP parser reads past the end.
      t.emit(bytes(`8b00${PREFIX}${"0174014f".repeat(20)}017401`));
      const result = await outcome;
      if (!("value" in result)) throw result.error;
      expect(result.value[0]).toMatchObject({
        reason: "MALFORMED_RESPONSE",
        evidence: { kind: "malformed", code: 0x8b, length: 91 },
      });
      const evidence = result.value[0]!.evidence;
      expect(evidence?.kind === "malformed" && evidence.hex.length).toBe(128);
    });

    it("ignores a malformed frame the check is not waiting for", async () => {
      const t = scriptedTransport();
      const client = new MeshClient(t.transport);
      const outcome = start(client, { checks: ["status"] });
      await tick();
      t.emit(sentFrame(2_694));
      t.emit(bytes("03")); // a contact cut to its code
      t.emit(bytes("85")); // a login push: not awaited by a status check
      t.emit(new Uint8Array(0));
      await tick(100);
      t.emit(STATUS_OK);
      const result = await outcome;
      if (!("value" in result)) throw result.error;
      expect(result.value[0]).toMatchObject({ result: "RESPONDED" });
    });
  });

  describe("abort", () => {
    it("cancels during attempt 1: no attempt 2, a late reply changes nothing, all released", async () => {
      const t = scriptedTransport();
      const { signal, abort, listenerCount } = abortable();
      const client = new MeshClient(t.transport);
      const outcome = start(client, { signal, checks: ["status"] });
      await tick();
      t.emit(sentFrame(2_694));
      await tick(1_000);
      abort();
      const result = await outcome;
      if (!("value" in result)) throw result.error;
      expect(result.value).toHaveLength(1);
      expect(result.value[0]).toMatchObject({
        result: "NOT_TESTED",
        reason: "CANCELLED",
        attempts: 1,
      });
      t.emit(STATUS_OK);
      await tick(60_000);
      expect(t.written).toEqual([STATUS_TX]);
      expect(listenerCount()).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("writes nothing when the signal is already aborted", async () => {
      const t = scriptedTransport();
      const { signal, abort } = abortable();
      abort();
      const client = new MeshClient(t.transport);
      const result = await start(client, { signal });
      if (!("value" in result)) throw result.error;
      expect(result.value).toEqual([]);
      expect(t.written).toEqual([]);
    });

    it("does not start the next check after an abort between checks", async () => {
      const t = scriptedTransport();
      const { signal, abort } = abortable();
      const client = new MeshClient(t.transport);
      const outcome = start(client, { signal });
      await tick();
      t.emit(sentFrame(2_694));
      abort(); // before the login reply arrives
      const result = await outcome;
      if (!("value" in result)) throw result.error;
      expect(result.value.map((o) => o.reason)).toEqual(["CANCELLED"]);
      expect(t.written).toEqual([LOGIN_TX]);
    });

    it("can run again after a cancelled run", async () => {
      const t = scriptedTransport();
      const { signal, abort } = abortable();
      const client = new MeshClient(t.transport);
      const first = start(client, { signal, checks: ["status"] });
      await tick();
      abort();
      await first;
      await tick(60_000);
      const second = start(client, { checks: ["status"] });
      await tick();
      expect(t.written).toHaveLength(2);
      t.emit(sentFrame(2_694));
      t.emit(STATUS_OK);
      expect(await second).toHaveProperty("value");
    });
  });

  describe("single flight and cooldown", () => {
    it("refuses a second run while one is in flight", async () => {
      const t = scriptedTransport();
      const client = new MeshClient(t.transport);
      void start(client);
      await tick();
      const second = await start(client);
      expect(second).toMatchObject({ error: expect.any(BusyError) });
      expect((second as { error: BusyError }).error.activity).toBe("diagnostic");
      expect(t.written).toHaveLength(1);
    });

    it("refuses a run during a contact sync and a sync during a run", async () => {
      const t = scriptedTransport();
      const client = new MeshClient(t.transport);
      const sync = client.getContacts().catch(() => undefined);
      await tick();
      const run = await start(client);
      expect((run as { error: BusyError }).error).toBeInstanceOf(BusyError);
      expect((run as { error: BusyError }).error.activity).toBe("contacts");
      await tick(120_000);
      await sync;

      void start(client, { checks: ["status"] });
      await tick();
      await expect(client.getContacts()).rejects.toMatchObject({ activity: "diagnostic" });
      await expect(client.handshake()).rejects.toThrow("busy");
    });

    it("refuses a request within 60 s of the last one, even on a new client, and allows it after", async () => {
      const ledger = new RemoteRequestLedger();
      const first = scriptedTransport();
      const clientA = new MeshClient(first.transport, { ledger });
      const run = start(clientA, { checks: ["status"] });
      await tick();
      first.emit(sentFrame(2_694));
      first.emit(STATUS_OK);
      await run;

      await tick(20_000);
      const second = scriptedTransport();
      const clientB = new MeshClient(second.transport, { ledger });
      const refused = await start(clientB, { checks: ["status"] });
      expect((refused as { error: CooldownError }).error).toBeInstanceOf(CooldownError);
      expect((refused as { error: CooldownError }).error.remainingMs).toBe(40_000);
      expect(second.written).toEqual([]);

      await tick(39_999);
      expect(await start(clientB, { checks: ["status"] })).toHaveProperty("error");
      await tick(1);
      void start(clientB, { checks: ["status"] });
      await tick();
      expect(second.written).toEqual([STATUS_TX]);
    });

    it("does not start a cooldown for a run that wrote nothing", async () => {
      const ledger = new RemoteRequestLedger();
      const { signal, abort } = abortable();
      abort();
      const t = scriptedTransport();
      const client = new MeshClient(t.transport, { ledger });
      await start(client, { signal });
      void start(client, { checks: ["status"] });
      await tick();
      expect(t.written).toEqual([STATUS_TX]);
    });

    it("counts the cooldown per node", async () => {
      const ledger = new RemoteRequestLedger();
      const t = scriptedTransport();
      const client = new MeshClient(t.transport, { ledger });
      const first = start(client, {
        checks: ["status"],
        policy: { attempts: 1, overrideMs: null },
      });
      await tick();
      t.emit(sentFrame(2_694));
      t.emit(STATUS_OK);
      await first;
      const other = `${"11".repeat(32)}`;
      void start(client, { publicKey: other, checks: ["status"] });
      await tick();
      expect(t.written).toHaveLength(2);
    });
  });

  describe("link loss", () => {
    it("reports LINK_LOST when the link drops mid-check", async () => {
      const t = scriptedTransport();
      const client = new MeshClient(t.transport);
      const outcome = start(client);
      await tick();
      t.emit(sentFrame(2_694));
      t.emit(LOGIN_OK);
      await tick();
      t.drop();
      const result = await outcome;
      if (!("value" in result)) throw result.error;
      expect(result.value.map((o) => [o.kind, o.result, o.reason])).toEqual([
        ["login", "RESPONDED", "ALL_CHECKS_REPLIED"],
        ["status", "TRANSPORT_UNAVAILABLE", "LINK_LOST"],
      ]);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("reports LINK_LOST when the write fails", async () => {
      const transport = scriptedTransport();
      const failing: MeshTransport = {
        ...transport.transport,
        write: async () => {
          throw new TransportUnavailableError();
        },
      };
      const client = new MeshClient(failing);
      const outcome = start(client, { checks: ["status"] });
      await tick();
      const result = await outcome;
      if (!("value" in result)) throw result.error;
      expect(result.value[0]).toMatchObject({ reason: "LINK_LOST", attempts: 1 });
      expect(vi.getTimerCount()).toBe(0);
    });

    it("throws when the client is closed before the run", async () => {
      const t = scriptedTransport();
      const client = new MeshClient(t.transport);
      await client.close();
      const result = await start(client);
      expect((result as { error: unknown }).error).toBeInstanceOf(TransportUnavailableError);
      expect(t.written).toEqual([]);
    });

    it("stores the link loss for a check that starts after the link dropped", async () => {
      const t = scriptedTransport();
      const client = new MeshClient(t.transport);
      const outcome = start(client);
      await tick();
      t.emit(sentFrame(2_694));
      t.drop(); // sets the unavailable flag and fails the login
      const result = await outcome;
      if (!("value" in result)) throw result.error;
      expect(result.value.map((o) => o.reason)).toEqual(["LINK_LOST"]);
    });
  });
});

const STATUS_OK_PAYLOAD = hex(STATUS_OK).slice(16);
