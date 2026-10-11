import { MeshCoreConnection } from "@guardian/meshcore-adapter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FakeTransport } from "../test/support/fake-transport";
import {
  contactFrame,
  contactsStartFrame,
  deviceInfoFrame,
  endOfContactsFrame,
  errFrame,
  loginFailFrame,
  loginSuccessFrame,
  publicKey,
  selfInfoFrame,
  sentFrame,
  statusResponseFrame,
  telemetryResponseFrame,
} from "../test/support/frames";
import { NODE_SPACING_MS, RequestBudget, type Clock } from "./budget";
import {
  COMPANION_REPLY_TIMEOUT_MS,
  CONTACT_IDLE_TIMEOUT_MS,
  REPLY_CAP_MS,
  REPLY_MARGIN_MS,
  runCapture,
  type CaptureResult,
  type Scenario,
} from "./capture";

const CANARY = "pw-LEAK-CANARY";
const TARGET = publicKey(0xa0);

const Cmd = { AppStart: 1, GetContacts: 4, DeviceQuery: 22, Login: 26, Status: 27, Telemetry: 39 };
const REMOTE_CODES = [Cmd.Login, Cmd.Status, Cmd.Telemetry];

/** What the companion does for one command: frames at once, and frames `afterMs` later. */
interface Reply {
  now?: Uint8Array[];
  later?: { frames: Uint8Array[]; afterMs: number };
}
const silent: Reply = {};
/** A remote request the companion acknowledges and the node answers `afterMs` later. */
const answered = (estTimeoutMs: number, frame: Uint8Array, afterMs: number): Reply => ({
  now: [sentFrame(estTimeoutMs)],
  later: { frames: [frame], afterMs },
});
const unanswered = (estTimeoutMs: number): Reply => ({ now: [sentFrame(estTimeoutMs)] });

/**
 * A companion that answers each command code from a script (one entry per call; the last one
 * repeats) and logs when each remote request went out and when its reply came back.
 */
class ScriptedCompanion extends FakeTransport {
  readonly remoteLog: { code: number; sentAt: number; repliedAt?: number }[] = [];
  private readonly calls = new Map<number, number>();

  constructor(private readonly script: Record<number, Reply[]>) {
    super();
  }

  override async write(frame: Uint8Array): Promise<void> {
    await super.write(frame);
    const code = frame[0] ?? -1;
    const call = this.calls.get(code) ?? 0;
    this.calls.set(code, call + 1);
    const replies = this.script[code] ?? [silent];
    const reply = replies[Math.min(call, replies.length - 1)] ?? silent;
    const entry: (typeof this.remoteLog)[number] = { code, sentAt: Date.now() };
    if (REMOTE_CODES.includes(code)) this.remoteLog.push(entry);
    for (const frame of reply.now ?? []) this.push(frame);
    const later = reply.later;
    if (later)
      setTimeout(() => {
        entry.repliedAt = Date.now();
        for (const frame of later.frames) this.push(frame);
      }, later.afterMs);
  }

  codes(): number[] {
    return this.writes.map((frame) => frame[0] ?? -1);
  }
}

const contacts = [
  contactFrame({ type: 1, key: publicKey(0x01), name: "Alice" }),
  contactFrame({ type: 2, key: publicKey(0x30), name: "Repeater" }),
  contactFrame({ type: 3, key: TARGET, name: "Room K" }),
];

const handshakeScript: Record<number, Reply[]> = {
  [Cmd.DeviceQuery]: [{ now: [deviceInfoFrame()] }],
  [Cmd.AppStart]: [{ now: [selfInfoFrame()] }],
  [Cmd.GetContacts]: [
    { now: [contactsStartFrame(contacts.length), ...contacts, endOfContactsFrame()] },
  ],
};

/** A companion that completes the handshake and a node that answers every request. */
const companion = (overrides: Record<number, Reply[]> = {}) =>
  new ScriptedCompanion({
    ...handshakeScript,
    [Cmd.Login]: [answered(3_000, loginSuccessFrame(), 2_000)],
    [Cmd.Status]: [answered(4_000, statusResponseFrame(), 2_500)],
    [Cmd.Telemetry]: [answered(4_000, telemetryResponseFrame(), 3_000)],
    ...overrides,
  });

const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** Runs a capture on fake timers until it finishes. */
async function run(scenario: Scenario, transport: ScriptedCompanion, targetPrefix = "a0a1a2") {
  const log: string[] = [];
  let result: CaptureResult | undefined;
  let failure: unknown;
  runCapture(scenario, {
    connection: new MeshCoreConnection(transport),
    link: transport,
    budget: new RequestBudget(systemClock),
    clock: systemClock,
    targetPrefix,
    guestPassword: CANARY,
    log: (line) => log.push(line),
  }).then(
    (value) => (result = value),
    (error: unknown) => (failure = error ?? new Error("rejected")),
  );
  for (let step = 0; result === undefined && failure === undefined; step += 1) {
    if (step > 1_000) throw new Error("capture did not finish");
    await vi.advanceTimersToNextTimerAsync();
  }
  if (failure !== undefined) throw failure;
  return { result: result as CaptureResult, log };
}

beforeEach(() => {
  vi.useFakeTimers({ now: 0 });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("runCapture: handshake", () => {
  it("queries the companion and reads its contacts without any remote request", async () => {
    const transport = companion();
    const { result, log } = await run("handshake", transport);

    expect(result).toEqual({ requests: [] });
    expect(transport.codes()).toEqual([Cmd.DeviceQuery, Cmd.AppStart, Cmd.GetContacts]);
    expect(transport.writes[0]).toEqual(Uint8Array.from([22, 3]));
    expect(log).toEqual([
      "device info: Heltec V3 v1.17.1 (11 Oct 2026)",
      "contacts: 3 received, 3 announced",
    ]);
  });

  it.each<[string, Record<number, Reply[]>, string]>([
    ["a silent device query", { [Cmd.DeviceQuery]: [silent] }, "device_query_no_response"],
    ["a silent app start", { [Cmd.AppStart]: [silent] }, "app_start_no_response"],
    ["a silent contact request", { [Cmd.GetContacts]: [silent] }, "contacts_no_response"],
    ["a refused contact request", { [Cmd.GetContacts]: [{ now: [errFrame()] }] }, "contacts_error"],
  ])("stops on %s", async (_, overrides, aborted) => {
    const { result, log } = await run("remote", companion(overrides));
    expect(result).toEqual({ requests: [], aborted });
    expect(log.at(-1)).toBe(`aborted: ${aborted}`);
  });

  it("gives up the device query after the companion reply timeout", async () => {
    const transport = companion({
      [Cmd.DeviceQuery]: [
        { later: { frames: [deviceInfoFrame()], afterMs: COMPANION_REPLY_TIMEOUT_MS + 1 } },
      ],
    });
    const { result } = await run("handshake", transport);
    expect(result.aborted).toBe("device_query_no_response");
    expect(Date.now()).toBe(COMPANION_REPLY_TIMEOUT_MS);
  });

  it("waits for contacts that trickle in below the idle timeout", async () => {
    const transport = companion({
      [Cmd.GetContacts]: [
        {
          now: [contactsStartFrame(2), contacts[0] as Uint8Array],
          later: { frames: [contacts[1] as Uint8Array, endOfContactsFrame()], afterMs: 4_999 },
        },
      ],
    });
    const { result, log } = await run("handshake", transport);
    expect(result).toEqual({ requests: [] });
    expect(log.at(-1)).toBe("contacts: 2 received, 2 announced");
  });

  it("aborts a contact sync that stalls instead of hanging (plan-review #3)", async () => {
    const transport = companion({
      [Cmd.GetContacts]: [{ now: [contactsStartFrame(3), contacts[0] as Uint8Array] }],
    });
    const { result } = await run("remote", transport);

    expect(result).toEqual({ requests: [], aborted: "contact_sync_stalled" });
    expect(Date.now()).toBe(CONTACT_IDLE_TIMEOUT_MS);
    expect(transport.remoteLog).toEqual([]);
  });
});

describe("runCapture: remote", () => {
  it("logs in, then requests status and telemetry from the target only", async () => {
    const transport = companion();
    const { result, log } = await run("remote", transport);

    expect(result).toEqual({
      requests: [
        { kind: "login", outcome: "responded", estTimeoutMs: 3_000, latencyMs: 2_000 },
        { kind: "status", outcome: "responded", estTimeoutMs: 4_000, latencyMs: 2_500 },
        { kind: "telemetry", outcome: "responded", estTimeoutMs: 4_000, latencyMs: 3_000 },
      ],
    });
    expect(transport.codes()).toEqual([22, 1, 4, Cmd.Login, Cmd.Status, Cmd.Telemetry]);
    for (const write of transport.writes.slice(3))
      expect(Array.from(write)).toEqual(expect.arrayContaining(TARGET));
    expect(log).toContain('target: a0a1a2a3a4a5 "Room K" (type 3)');
    expect(log).toContain("login: responded, estTimeout 3000 ms, latency 2000 ms");
  });

  it("spaces requests to the node a minute apart and never has two in flight", async () => {
    const transport = companion();
    await run("remote", transport);

    const sent = transport.remoteLog;
    expect(sent).toHaveLength(3);
    for (let index = 1; index < sent.length; index += 1) {
      const previous = sent[index - 1];
      const current = sent[index];
      expect(current?.sentAt).toBeGreaterThanOrEqual((previous?.sentAt ?? 0) + NODE_SPACING_MS);
      expect(current?.sentAt).toBeGreaterThan(previous?.repliedAt ?? Infinity);
    }
  });

  it("tries a request without a reply once more, then reports No response", async () => {
    const transport = companion({
      [Cmd.Login]: [unanswered(3_000)],
      [Cmd.Status]: [unanswered(3_000)],
      [Cmd.Telemetry]: [unanswered(3_000)],
    });
    const { result, log } = await run("remote", transport);

    const noResponse = { outcome: "no_response", estTimeoutMs: 3_000 };
    expect(result.requests).toEqual([
      { kind: "login", ...noResponse },
      { kind: "login", ...noResponse },
      { kind: "status", ...noResponse },
      { kind: "status", ...noResponse },
      { kind: "telemetry", ...noResponse },
      { kind: "telemetry", ...noResponse },
    ]);
    expect(result.aborted).toBeUndefined();
    expect(log).toContain("login: No response — cause unknown, estTimeout 3000 ms");
    const sentAt = transport.remoteLog.map((entry) => entry.sentAt);
    for (let index = 1; index < sentAt.length; index += 1)
      expect((sentAt[index] ?? 0) - (sentAt[index - 1] ?? 0)).toBe(NODE_SPACING_MS);
  });

  it.each<[string, number, number, string]>([
    ["just inside estTimeout + margin", 1_000, 1_000 + REPLY_MARGIN_MS - 1, "responded"],
    ["just after estTimeout + margin", 1_000, 1_000 + REPLY_MARGIN_MS + 1, "no_response"],
    ["just inside the cap", 60_000, REPLY_CAP_MS - 1, "responded"],
    ["just after the cap", 60_000, REPLY_CAP_MS + 1, "no_response"],
  ])("waits for a status reply %s", async (_, estTimeoutMs, afterMs, outcome) => {
    const transport = companion({
      [Cmd.Status]: [answered(estTimeoutMs, statusResponseFrame(), afterMs), unanswered(1)],
    });
    const { result } = await run("remote", transport);
    expect(result.requests[1]).toMatchObject({ kind: "status", outcome, estTimeoutMs });
  });

  it("reports a rejected login, does not retry it, and still asks for status and telemetry", async () => {
    const transport = companion({ [Cmd.Login]: [answered(3_000, loginFailFrame(), 1_000)] });
    const { result } = await run("remote", transport);

    expect(result.requests.map(({ kind, outcome }) => [kind, outcome])).toEqual([
      ["login", "rejected"],
      ["status", "responded"],
      ["telemetry", "responded"],
    ]);
  });

  it("reports a refused request as an error without retrying it", async () => {
    const transport = companion({ [Cmd.Status]: [{ now: [errFrame()] }] });
    const { result } = await run("remote", transport);
    expect(result.requests[1]).toEqual({ kind: "status", outcome: "error" });
    expect(result.requests.map((request) => request.kind)).toEqual([
      "login",
      "status",
      "telemetry",
    ]);
  });

  it("treats a companion that does not acknowledge as no response, after its timeout", async () => {
    const transport = companion({ [Cmd.Telemetry]: [silent] });
    const { result } = await run("remote", transport);
    expect(result.requests.slice(2)).toEqual([
      { kind: "telemetry", outcome: "no_response" },
      { kind: "telemetry", outcome: "no_response" },
    ]);
  });

  it("ignores replies from other nodes", async () => {
    const transport = companion({
      [Cmd.Status]: [answered(1_000, statusResponseFrame(0x30), 500), unanswered(1)],
    });
    const { result } = await run("remote", transport);
    expect(result.requests[1]).toEqual({
      kind: "status",
      outcome: "no_response",
      estTimeoutMs: 1_000,
    });
  });

  it("ignores a reply of another kind from the target", async () => {
    const transport = companion({
      [Cmd.Telemetry]: [answered(1_000, statusResponseFrame(), 500), unanswered(1)],
    });
    const { result } = await run("remote", transport);
    expect(result.requests[2]).toMatchObject({ kind: "telemetry", outcome: "no_response" });
  });

  it("does not contact any node when the target is not in the contact list", async () => {
    const transport = companion();
    const { result } = await run("remote", transport, "ffee");
    expect(result).toEqual({ requests: [], aborted: "target_not_in_contacts" });
    expect(transport.remoteLog).toEqual([]);
  });

  it("does not guess between two contacts that share the target prefix", async () => {
    const twin = contactFrame({ type: 2, key: [0xa0, 0xff, ...TARGET.slice(2)], name: "Twin" });
    const transport = companion({
      [Cmd.GetContacts]: [
        { now: [contactsStartFrame(4), ...contacts, twin, endOfContactsFrame()] },
      ],
    });
    const { result } = await run("remote", transport, "a0");
    expect(result).toEqual({ requests: [], aborted: "target_ambiguous" });
    expect(transport.remoteLog).toEqual([]);
  });

  it("keeps what it has when the companion disconnects mid-run", async () => {
    const transport = companion({ [Cmd.Status]: [unanswered(10_000)] });
    setTimeout(() => transport.drop(), NODE_SPACING_MS + 5_000);
    const { result, log } = await run("remote", transport);

    expect(result).toEqual({
      requests: [{ kind: "login", outcome: "responded", estTimeoutMs: 3_000, latencyMs: 2_000 }],
      aborted: "transport_disconnected",
    });
    expect(log.at(-1)).toBe("aborted: transport_disconnected");
    expect(transport.remoteLog.map((entry) => entry.code)).toEqual([Cmd.Login, Cmd.Status]);
  });

  it("stops at once when the link is gone before the next request", async () => {
    const transport = companion();
    setTimeout(() => transport.drop(), 10_000);
    const { result } = await run("remote", transport);
    expect(result.aborted).toBe("transport_disconnected");
    expect(transport.remoteLog.map((entry) => entry.code)).toEqual([Cmd.Login]);
  });

  it("stops when a write fails", async () => {
    const transport = companion();
    const write = transport.write.bind(transport);
    transport.write = async (frame) => {
      if (frame[0] === Cmd.Status) throw new Error("Write failed");
      await write(frame);
    };
    const { result } = await run("remote", transport);
    expect(result.aborted).toBe("transport_error");
    expect(result.requests.map((request) => request.kind)).toEqual(["login"]);
  });

  it("never puts the password in a log line", async () => {
    const { log } = await run("remote", companion({ [Cmd.Login]: [unanswered(1)] }));
    expect(log.join("\n")).not.toContain(CANARY);
  });
});
