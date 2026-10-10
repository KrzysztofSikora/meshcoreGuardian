import { parseTransportMode } from "../config/transport-mode";
import { createTransport } from "./transport";

// Literal `process.env.EXPO_PUBLIC_*` access: Expo inlines it into the bundle at build time.
const transportMode = parseTransportMode(process.env.EXPO_PUBLIC_TRANSPORT);

export const container = {
  transport: createTransport(transportMode),
};
