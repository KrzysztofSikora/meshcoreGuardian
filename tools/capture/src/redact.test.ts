import { decodeFrame } from "@guardian/meshcore-adapter";
import { describe, expect, it } from "vitest";

import {
  contactFrame,
  deviceInfoFrame,
  publicKey,
  selfInfoFrame,
  sendLoginFrame,
  toHex,
} from "../test/support/frames";
import { createRedactionState, redactFrame, type Direction } from "./redact";

const redact = (dir: Direction, frame: Uint8Array, state = createRedactionState()) =>
  redactFrame(dir, frame, state);

describe("redactFrame (D-4)", () => {
  it("drops the login password and keeps the code and public key", () => {
    const login = sendLoginFrame("pw-LEAK-CANARY");
    const { bytes, redactions } = redact("tx", login);
    expect(toHex(bytes)).toBe(toHex([26, ...publicKey(0xa0)]));
    expect(redactions).toEqual(["sendLogin.password"]);
  });

  it("records an empty-password login unchanged", () => {
    const login = sendLoginFrame("");
    expect(redact("tx", login)).toEqual({ bytes: login, redactions: [] });
  });

  it("does not treat an rx frame with the login code as a login", () => {
    const frame = sendLoginFrame("x");
    expect(redact("rx", frame).bytes).toEqual(frame);
  });

  it("zeroes the BLE PIN in device info and leaves every decoded field as it was", () => {
    const info = deviceInfoFrame();
    const { bytes, redactions } = redact("rx", info);
    expect(Array.from(bytes.subarray(4, 8))).toEqual([0, 0, 0, 0]);
    expect(toHex(bytes.subarray(8))).toBe(toHex(info.subarray(8)));
    expect(toHex(bytes.subarray(0, 4))).toBe(toHex(info.subarray(0, 4)));
    expect(decodeFrame(bytes)).toEqual(decodeFrame(info));
    expect(redactions).toEqual(["deviceInfo.blePin"]);
  });

  it("does not touch a tx frame that carries the device-info code", () => {
    const frame = deviceInfoFrame();
    expect(redact("tx", frame)).toEqual({ bytes: frame, redactions: [] });
  });

  it("zeroes the companion's position and replaces its name", () => {
    const self = selfInfoFrame("Operator SP5ABC");
    const { bytes, redactions } = redact("rx", self);
    const decoded = decodeFrame(bytes);
    expect(decoded).toEqual({ ...decodeFrame(self), lat: 0, lon: 0, name: "companion" });
    expect(Array.from(bytes.subarray(36, 44))).toEqual(new Array(8).fill(0));
    expect(redactions).toEqual(["selfInfo.latLon", "selfInfo.name"]);
  });

  it("replaces a short companion name with one of the same fixed length", () => {
    const { bytes } = redact("rx", selfInfoFrame("A"));
    expect(bytes).toHaveLength(58 + "companion".length);
  });

  it("zeroes the position of a self-info frame without a name", () => {
    const self = selfInfoFrame("");
    const { bytes, redactions } = redact("rx", self);
    expect(bytes).toHaveLength(58);
    expect(redactions).toEqual(["selfInfo.latLon"]);
  });

  it.each([3, 0x8a])("renames chat contacts and zeroes their position (code %i)", (code) => {
    const state = createRedactionState();
    const alice = contactFrame({ code, type: 1, key: publicKey(0x01), name: "Alice" });
    const bob = contactFrame({ code, type: 1, key: publicKey(0x02), name: "Bob" });

    const first = redact("rx", alice, state);
    const second = redact("rx", bob, state);
    const again = redact("rx", alice, state);

    expect(first.redactions).toEqual(["chatContact.name", "chatContact.latLon"]);
    expect(Array.from(first.bytes.subarray(100, 132))).toEqual([
      ...Array.from("chat-1", (char) => char.charCodeAt(0)),
      ...new Array(26).fill(0),
    ]);
    expect(Array.from(first.bytes.subarray(136, 144))).toEqual(new Array(8).fill(0));
    expect(toHex(first.bytes.subarray(1, 100))).toBe(toHex(alice.subarray(1, 100)));
    expect(toHex(first.bytes.subarray(132, 136))).toBe(toHex(alice.subarray(132, 136)));
    expect(toHex(first.bytes.subarray(144))).toBe(toHex(alice.subarray(144)));
    expect(toHex(second.bytes.subarray(100, 106))).toBe(
      toHex(Array.from("chat-2", (c) => c.charCodeAt(0))),
    );
    expect(again.bytes).toEqual(first.bytes);
  });

  it("decodes a redacted chat contact with the new name and no position", () => {
    const alice = contactFrame({ type: 1, name: "Alice" });
    expect(decodeFrame(redact("rx", alice).bytes)).toMatchObject({
      kind: "contact",
      name: "chat-1",
      lat: 0,
      lon: 0,
    });
  });

  it.each([2, 3, 4])("keeps infrastructure contacts (type %i) verbatim", (type) => {
    const contact = contactFrame({ type });
    expect(redact("rx", contact)).toEqual({ bytes: contact, redactions: [] });
  });

  it("leaves a truncated chat contact to the decoder", () => {
    const short = contactFrame({ type: 1 }).subarray(0, 143);
    expect(redact("rx", short)).toEqual({ bytes: short, redactions: [] });
  });

  it("leaves truncated device and self info without the redacted bytes alone", () => {
    const info = deviceInfoFrame().subarray(0, 7);
    const self = selfInfoFrame().subarray(0, 43);
    expect(redact("rx", info).redactions).toEqual([]);
    expect(redact("rx", self).redactions).toEqual([]);
  });

  it("never changes the frame it was given", () => {
    const frames: [Direction, Uint8Array][] = [
      ["tx", sendLoginFrame("pw-LEAK-CANARY")],
      ["rx", deviceInfoFrame()],
      ["rx", selfInfoFrame()],
      ["rx", contactFrame({ type: 1 })],
    ];
    for (const [dir, frame] of frames) {
      const before = toHex(frame);
      redact(dir, frame);
      expect(toHex(frame)).toBe(before);
    }
  });

  it("returns a copy even when nothing is redacted", () => {
    const frame = Uint8Array.from([0]);
    expect(redact("rx", frame).bytes).not.toBe(frame);
    expect(redact("tx", frame).bytes).not.toBe(frame);
  });
});
