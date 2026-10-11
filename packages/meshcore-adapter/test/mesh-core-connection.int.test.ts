import { Constants } from "@liamcottle/meshcore.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MeshCoreConnection, type LoginFailEvent } from "../src";
import { MemoryTransport } from "./support/memory-transport";

/** meshcore.js delivers every event through `setTimeout(0)`. */
const nextEvent = <T>(connection: MeshCoreConnection, event: string | number) =>
  new Promise<T>((resolve) => connection.once(event, resolve as (...data: never[]) => void));

// The adapter compiles without Node or DOM globals (it must run under Hermes), so no TextEncoder.
const ascii = (text: string) => Array.from(text, (char) => char.charCodeAt(0));

const consoleOf = globalThis as unknown as { console: { log: (...data: unknown[]) => void } };

function deviceInfoFrame(): Uint8Array {
  const date = new Uint8Array(12);
  date.set(ascii("11 Oct 2026"));
  return Uint8Array.from([
    Constants.ResponseCodes.DeviceInfo!,
    9,
    ...new Uint8Array(6),
    ...date,
    ...ascii("Heltec V3"),
  ]);
}

describe("MeshCoreConnection over a MeshTransport", () => {
  afterEach(() => vi.restoreAllMocks());

  it("completes a device query round trip through the transport", async () => {
    const transport = new MemoryTransport();
    const connection = new MeshCoreConnection(transport);

    const reply = connection.deviceQuery(3);
    await vi.waitFor(() => expect(transport.writes).toHaveLength(1));
    expect(Array.from(transport.writes[0]!)).toEqual([Constants.CommandCodes.DeviceQuery, 3]);
    transport.push(deviceInfoFrame());

    await expect(reply).resolves.toMatchObject({
      firmwareVer: 9,
      firmware_build_date: "11 Oct 2026",
    });
  });

  it("hands frames passed to sendToRadioFrame to transport.write unchanged", async () => {
    const transport = new MemoryTransport();
    const connection = new MeshCoreConnection(transport);
    const frame = Uint8Array.from([1, 2, 3]);

    await connection.sendToRadioFrame(frame);

    expect(transport.writes).toEqual([frame]);
  });

  it("emits disconnected when the transport drops", async () => {
    const transport = new MemoryTransport();
    const connection = new MeshCoreConnection(transport);
    const disconnected = nextEvent<void>(connection, "disconnected");

    transport.drop();

    await expect(disconnected).resolves.toBeUndefined();
  });

  it("emits LoginFail with the key prefix for a 0x86 push and logs nothing", async () => {
    const log = vi.spyOn(consoleOf.console, "log").mockImplementation(() => {});
    const transport = new MemoryTransport();
    const connection = new MeshCoreConnection(transport);
    const loginFail = nextEvent<LoginFailEvent>(connection, Constants.PushCodes.LoginFail);
    const rx = nextEvent<Uint8Array>(connection, "rx");
    const frame = Uint8Array.from([0x86, 0, 0xa1, 0xb2, 0xc3, 0xd4, 0xe5, 0xf6]);

    transport.push(frame);

    const event = await loginFail;
    expect(Array.from(event.pubKeyPrefix)).toEqual([0xa1, 0xb2, 0xc3, 0xd4, 0xe5, 0xf6]);
    expect(await rx).toBe(frame);
    expect(log).not.toHaveBeenCalled();
  });

  it("still passes other frames to the library parser", async () => {
    const transport = new MemoryTransport();
    const connection = new MeshCoreConnection(transport);
    const start = nextEvent<{ count: number }>(connection, Constants.ResponseCodes.ContactsStart!);

    transport.push(Uint8Array.from([Constants.ResponseCodes.ContactsStart!, 7, 1, 0, 0]));

    await expect(start).resolves.toEqual({ count: 263 });
  });

  it("unsubscribes from the transport and closes it on close()", async () => {
    const transport = new MemoryTransport();
    const connection = new MeshCoreConnection(transport);
    const onRx = vi.fn();
    connection.on("rx", onRx);

    await connection.close();
    transport.push(Uint8Array.from([0]));
    // Events are delivered in order, so an rx event would arrive before this probe.
    const probe = nextEvent<void>(connection, "probe");
    connection.emit("probe");
    await probe;

    expect(transport.closed).toBe(true);
    expect(transport.listenerCount).toBe(0);
    expect(onRx).not.toHaveBeenCalled();
  });
});
