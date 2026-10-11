// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- the ambient module must travel with the source to consumers (plan-review #7)
/// <reference path="../types/meshcore-js.d.ts" />
import { Connection, Constants } from "@liamcottle/meshcore.js";

import type { MeshTransport, Unsubscribe } from "../transport/mesh-transport";

/** Payload of the `Constants.PushCodes.LoginFail` event, which meshcore.js 1.15.0 does not emit. */
export interface LoginFailEvent {
  pubKeyPrefix: Uint8Array;
}

/** The companion protocol version meshcore.js speaks; the device query announces it. */
export const COMPANION_PROTOCOL_VERSION: number = Constants.SupportedCompanionProtocolVersion;

const LOGIN_FAIL_PREFIX_START = 2;
const LOGIN_FAIL_PREFIX_END = 8;

/** meshcore.js `Connection` over any `MeshTransport`: the library is the codec, the transport the link. */
export class MeshCoreConnection extends Connection {
  private readonly unsubscribes: Unsubscribe[];

  constructor(private readonly transport: MeshTransport) {
    super();
    this.unsubscribes = [
      transport.onFrame((frame) => this.onFrameReceived(frame)),
      transport.onDisconnect(() => this.onDisconnected()),
    ];
  }

  override async sendToRadioFrame(frame: Uint8Array): Promise<void> {
    await this.transport.write(frame);
  }

  override async close(): Promise<void> {
    for (const unsubscribe of this.unsubscribes.splice(0)) unsubscribe();
    await this.transport.close();
  }

  override onFrameReceived(frame: Uint8Array): void {
    if (frame[0] === Constants.PushCodes.LoginFail) {
      // Firmware layout: [0x86, reserved, pub_key prefix (6)]. The library logs it as unhandled.
      this.emit("rx", frame);
      const event: LoginFailEvent = {
        pubKeyPrefix: frame.slice(LOGIN_FAIL_PREFIX_START, LOGIN_FAIL_PREFIX_END),
      };
      this.emit(Constants.PushCodes.LoginFail, event);
      return;
    }
    super.onFrameReceived(frame);
  }
}
