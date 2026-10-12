import type { ScriptFrame } from "./fake-transport";
import { CONTACTS_FRAMES } from "./contacts-script";

export type RemoteStep = "ok" | "no-reply" | "err" | "malformed";

export interface RemoteScriptSpec {
  login?: RemoteStep;
  status?: RemoteStep;
  telemetry?: RemoteStep;
}

interface RecordedStep {
  tx: ScriptFrame;
  sent: ScriptFrame;
  push: ScriptFrame;
}

/**
 * The three remote requests of `fixtures/v1.17.1-d929643/remote.json` against Room K: login
 * (seq 362, 363, 365), status (368, 369, 371) and telemetry (375, 376, 378), byte for byte with
 * their recorded times. `remote-script.int.test.ts` keeps them equal to the capture.
 */
const RECORDED = {
  login: {
    tx: {
      dir: "tx",
      tMs: 21987.2,
      hex: "1a7c73a8cd01d92e249bf6ed13af3f60499260e408c674ad5e11a44000d87acc28",
    },
    sent: { dir: "rx", tMs: 22180.3, hex: "06007c73a8cd5e0e0000" },
    push: { dir: "rx", tMs: 24861.5, hex: "85017c73a8cd01d9c79e44660301" },
  },
  status: {
    tx: {
      dir: "tx",
      tMs: 81990,
      hex: "1b7c73a8cd01d92e249bf6ed13af3f60499260e408c674ad5e11a44000d87acc28",
    },
    sent: { dir: "rx", tMs: 82093.5, hex: "0600ce68cb6a860a0000" },
    push: {
      dir: "rx",
      tMs: 83312.7,
      hex: "87007c73a8cd01d9190d00008bffdeffca0100009f0000006c000000150b00009d00000002000000be010000070000000000350000001b01000000000000000000000000",
    },
  },
  telemetry: {
    tx: {
      dir: "tx",
      tMs: 141994.3,
      hex: "270000007c73a8cd01d92e249bf6ed13af3f60499260e408c674ad5e11a44000d87acc28",
    },
    sent: { dir: "rx", tMs: 142105, hex: "06000a69cb6a860a0000" },
    push: { dir: "rx", tMs: 143081.3, hex: "8b007c73a8cd01d90174014f0167012c00000000" },
  },
} as const satisfies Record<string, RecordedStep>;

const ORDER = ["login", "status", "telemetry"] as const;

/** Companion error frame, code 2. */
const ERR_HEX = "0102";
/** A push cut to its code and one byte: shorter than any layout. */
const MALFORMED_BYTES = 2;

function stepFrames(recorded: RecordedStep, step: RemoteStep): ScriptFrame[] {
  switch (step) {
    case "ok":
      return [recorded.tx, recorded.sent, recorded.push];
    case "no-reply":
      return [recorded.tx, recorded.sent];
    case "err":
      return [recorded.tx, { ...recorded.sent, hex: ERR_HEX }];
    case "malformed":
      return [
        recorded.tx,
        recorded.sent,
        { ...recorded.push, hex: recorded.push.hex.slice(0, MALFORMED_BYTES * 2) },
      ];
  }
}

/**
 * The remote exchanges for `FakeTransport` (plan D-17): each step as recorded, or derived —
 * `no-reply` keeps `sent` and drops the push, `err` replaces `sent` by an error frame,
 * `malformed` truncates the push.
 */
export function remoteScript(spec: RemoteScriptSpec = {}): ScriptFrame[] {
  return ORDER.flatMap((name) => stepFrames(RECORDED[name], spec[name] ?? "ok"));
}

/** Every request answered, exactly as recorded. */
export const REMOTE_FRAMES: readonly ScriptFrame[] = remoteScript();

const ROOM_K_CONTACT: ScriptFrame = {
  dir: "rx",
  tMs: 2170,
  hex: "037c73a8cd01d92e249bf6ed13af3f60499260e408c674ad5e11a44000d87acc2803008000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000526f6f6d204b00000000000000000000000000000000000000000000000000000a804e663983fc02cc05320119a2c86a",
};

/**
 * `CONTACTS_FRAMES` plus Room K, the node the remote requests were recorded against (recorded
 * contact frame, seq 219), with the announced count raised to 32. The existing sync script keeps
 * its 31 contacts.
 */
export const DIAG_CONTACTS_FRAMES: readonly ScriptFrame[] = [
  CONTACTS_FRAMES[0]!,
  { ...CONTACTS_FRAMES[1]!, hex: "0220000000" },
  ...CONTACTS_FRAMES.slice(2, -1),
  ROOM_K_CONTACT,
  CONTACTS_FRAMES.at(-1)!,
];
