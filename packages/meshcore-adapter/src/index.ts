export type { MeshTransport, Unsubscribe } from "./transport/mesh-transport";
export {
  COMPANION_PROTOCOL_VERSION,
  MeshCoreConnection,
  type LoginFailEvent,
} from "./connection/mesh-core-connection";
export { decodeFrame, type DecodedFrame, type TelemetryValue } from "./decode/decode-frame";
export type { DeviceInfo } from "./decode/device-info";
export { MalformedFrameError } from "./decode/errors";
export type { PathLen } from "./decode/path";
export type { RemoteStats } from "./decode/status";
export {
  FIXTURE_FORMAT_VERSION,
  FixtureFormatError,
  readFixture,
  type Fixture,
  type FixtureFirmware,
  type FixtureFrame,
  type FixtureHeader,
  type FixtureRequest,
  type FixtureSummary,
  type RequestKind,
  type RequestOutcome,
} from "./fixtures/format";
export { FakeTransport, type ScriptFrame } from "./transport/fake-transport";
export { HANDSHAKE_FRAMES, withFirmware } from "./transport/handshake-script";
export { CONTACTS_FRAMES } from "./transport/contacts-script";
export {
  MeshClient,
  type AbortSignalLike,
  type ContactsResult,
  type MeshClientOptions,
} from "./client/mesh-client";
export {
  AbortError,
  CommandRejectedError,
  ContactsTimeoutError,
  HandshakeTimeoutError,
  TransportUnavailableError,
  type ContactsStage,
  type HandshakeStep,
} from "./client/errors";
