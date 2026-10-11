import { SqliteNodeRepository } from "@guardian/storage";

import { CompanionSession } from "../application/connection/companion-session";
import { NodesController } from "../application/nodes/nodes-controller";
import { parseTransportMode } from "../config/transport-mode";
import { openGuardianDb } from "../platform/sqlite/open-guardian-db";
import { createPlatform } from "./platform";

// Literal `process.env.EXPO_PUBLIC_*` access: Expo inlines it into the bundle at build time.
const mode = parseTransportMode(process.env.EXPO_PUBLIC_TRANSPORT);

const platform = createPlatform(mode);

const session = new CompanionSession({
  platform: platform.ble,
  appState: platform.appState,
  lastCompanionStore: platform.lastCompanion,
});

export const container = {
  mode,
  platform,
  session,
  // Real SQLite in both modes: only the radio is faked (plan D-13). Opened on first use.
  nodes: new NodesController({
    session,
    appState: platform.appState,
    clock: Date.now,
    repository: async () => new SqliteNodeRepository(await openGuardianDb()),
  }),
};
