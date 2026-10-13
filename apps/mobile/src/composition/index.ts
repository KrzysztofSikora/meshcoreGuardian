import { DEFAULT_DIAGNOSTIC_POLICY } from "@guardian/domain";
import { SqliteDiagnosticRunRepository, SqliteNodeRepository } from "@guardian/storage";

import { CompanionSession } from "../application/connection/companion-session";
import { RunController } from "../application/diagnostics/run-controller";
import { GuestPasswords } from "../application/nodes/guest-passwords";
import { NodesController } from "../application/nodes/nodes-controller";
import { parseTransportMode } from "../config/transport-mode";
import { KvAirtimeNoticeStore } from "../platform/airtime-notice-store";
import { ExpoSecretStore } from "../platform/secure-store";
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

// One database handle for every repository; opened on first use.
let opened: ReturnType<typeof openGuardianDb> | null = null;
const db = () => (opened ??= openGuardianDb());

// Real Keystore storage in both modes; only the radio is faked (plan D-6).
const passwords = new GuestPasswords(new ExpoSecretStore());

export const container = {
  mode,
  platform,
  session,
  // Real SQLite in both modes: only the radio is faked (plan D-13). Opened on first use.
  nodes: new NodesController({
    session,
    appState: platform.appState,
    clock: Date.now,
    repository: async () => new SqliteNodeRepository(await db()),
  }),
  passwords,
  runs: new RunController({
    session,
    appState: platform.appState,
    clock: Date.now,
    repository: async () => new SqliteDiagnosticRunRepository(await db()),
    notice: new KvAirtimeNoticeStore(),
    password: (publicKey) => passwords.password(publicKey),
    policy: () => DEFAULT_DIAGNOSTIC_POLICY,
  }),
};
