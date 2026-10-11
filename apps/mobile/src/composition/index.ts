import { CompanionSession } from "../application/connection/companion-session";
import { parseTransportMode } from "../config/transport-mode";
import { createPlatform } from "./platform";

// Literal `process.env.EXPO_PUBLIC_*` access: Expo inlines it into the bundle at build time.
const mode = parseTransportMode(process.env.EXPO_PUBLIC_TRANSPORT);

const platform = createPlatform(mode);

export const container = {
  mode,
  platform,
  session: new CompanionSession({
    platform: platform.ble,
    appState: platform.appState,
    lastCompanionStore: platform.lastCompanion,
  }),
};
