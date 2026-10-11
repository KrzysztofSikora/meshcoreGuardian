// Ambient types for the subset of @liamcottle/meshcore.js 1.15.0 the adapter uses. The library
// ships no types. Files that import it reference this file with a triple-slash directive, so the
// declaration travels with the adapter source to every workspace that type-checks it.
declare module "@liamcottle/meshcore.js" {
  type Listener = (...data: never[]) => void;
  type EventName = string | number;

  export class EventEmitter {
    on(event: EventName, callback: Listener): void;
    off(event: EventName, callback: Listener): void;
    once(event: EventName, callback: Listener): void;
    /** Delivers to each listener through `setTimeout(0)`, never synchronously. */
    emit(event: EventName, ...data: unknown[]): void;
  }

  export class Connection extends EventEmitter {
    onConnected(): Promise<void>;
    onDisconnected(): void;
    close(): Promise<void>;
    sendToRadioFrame(frame: Uint8Array): Promise<void>;
    /** Dispatches on byte 0 and emits the parsed event under the response or push code. */
    onFrameReceived(frame: Uint8Array): void;
    sendCommandAppStart(): Promise<void>;
    sendCommandDeviceQuery(appTargetVer: number): Promise<void>;
    sendCommandGetContacts(since?: number): Promise<void>;
    sendCommandSendLogin(publicKey: Uint8Array, password: string): Promise<void>;
    sendCommandSendStatusReq(publicKey: Uint8Array): Promise<void>;
    sendCommandSendTelemetryReq(publicKey: Uint8Array): Promise<void>;
    deviceQuery(appTargetVer: number): Promise<unknown>;
  }

  export const Constants: {
    readonly SupportedCompanionProtocolVersion: number;
    readonly Ble: {
      readonly ServiceUuid: string;
      readonly CharacteristicUuidRx: string;
      readonly CharacteristicUuidTx: string;
    };
    readonly CommandCodes: Readonly<Record<string, number>>;
    readonly ResponseCodes: Readonly<Record<string, number>>;
    readonly PushCodes: Readonly<Record<string, number>> & {
      readonly LoginSuccess: number;
      readonly LoginFail: number;
      readonly StatusResponse: number;
      readonly TelemetryResponse: number;
    };
  };

  export const CayenneLpp: {
    parse(bytes: Uint8Array): { channel: number; type: number; value: unknown }[];
  };
}
