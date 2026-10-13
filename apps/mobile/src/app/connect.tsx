import type { Capability, ConnectionState } from "@guardian/domain";
import { CAPABILITIES } from "@guardian/domain";
import { useEffect, useState, type ReactNode } from "react";
import { FlatList, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useStore } from "zustand";

import { ConnectionStatus } from "../components/connection-status";
import { AppButton } from "../components/ui/button";
import { Card, SectionHeading } from "../components/ui/card";
import { Screen } from "../components/ui/screen";
import { StatusChip } from "../components/ui/status-chip";
import { container } from "../composition";
import { useStyles, useTheme } from "../theme/theme-provider";

const { session } = container;

export default function ConnectScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useStyles((th) => ({
    name: { ...th.type.name },
    body: { ...th.type.body },
    mono: { ...th.type.monoSmall },
    device: { gap: th.space.xs, paddingVertical: th.space.sm },
    untested: { gap: th.space.xs },
    technical: { gap: th.space.xs },
  }));
  const state = useStore(session.store);
  // Until the user has answered the system dialog once, "denied" only means "not asked yet".
  const [asked, setAsked] = useState(false);

  useEffect(() => {
    void session.initialize();
    const unsubscribe = container.platform.appState.onChange((next) => {
      if (next === "active") void session.refreshPermission();
    });
    return () => {
      unsubscribe();
      session.stopScan();
    };
  }, []);

  const { connection, permission, bluetooth, scan, lastCompanion, capabilities } = state;
  const busy = connection.kind === "connecting";
  const connected = connection.kind === "connected";
  const granted = permission === "granted";
  const showRequired = permission === "blocked" || (permission === "denied" && asked);

  const grant = async () => {
    await session.requestPermission();
    setAsked(true);
  };

  const text = [styles.body, { color: colors.text }];
  const muted = [styles.body, { color: colors.textMuted }];

  return (
    <Screen title={t("connect.title")} nav="connect" scroll>
      <ConnectionStatus connection={connection} />
      <FailureDetail connection={connection} />
      {state.linkLostNote && <Note>{t("connect.linkLost")}</Note>}

      {!granted && !showRequired && permission !== "unknown" && (
        <Card>
          <Text style={text}>{t("connect.permission.explain")}</Text>
          <AppButton title={t("connect.permission.grant")} onPress={grant} />
        </Card>
      )}
      {showRequired && (
        <Card>
          <Text style={[styles.name, { color: colors.text }]}>{t("connect.permission.required")}</Text>
          <Text style={text}>{t("connect.permission.requiredBody")}</Text>
          <AppButton
            title={t("connect.permission.openSettings")}
            onPress={() => void session.openSettings()}
          />
          <AppButton variant="secondary" title={t("connect.permission.tryAgain")} onPress={grant} />
        </Card>
      )}

      {granted && bluetooth === "off" && (
        <Card>
          <Text style={[styles.name, { color: colors.text }]}>{t("connect.bluetoothOff")}</Text>
          <Text style={text}>{t("connect.bluetoothOffBody")}</Text>
        </Card>
      )}
      {granted && bluetooth === "unavailable" && (
        <Text style={[styles.name, { color: colors.text }]}>{t("connect.bluetoothUnavailable")}</Text>
      )}

      {granted && !connected && (
        <Card>
          {lastCompanion !== null && !busy && (
            <AppButton
              title={t("connect.connectLast", { name: lastCompanion.name })}
              onPress={() => void session.connect(lastCompanion.id, lastCompanion.name)}
            />
          )}
          {connection.kind === "failed" && (
            <AppButton title={t("connect.retry")} onPress={() => void session.retry()} />
          )}
          {state.linkLostNote && (
            <AppButton title={t("connect.reconnect")} onPress={() => void session.reconnect()} />
          )}
          <AppButton
            variant="secondary"
            icon="search"
            title={scan.status === "scanning" ? t("connect.scanning") : t("connect.scan")}
            disabled={scan.status === "scanning" || busy}
            onPress={() => void session.startScan()}
          />
          {scan.status === "done" && scan.devices.length === 0 && bluetooth === "on" && (
            <Text style={muted}>{t("connect.noneFound")}</Text>
          )}
          {scan.status === "failed" && bluetooth === "on" && (
            <Text style={muted}>{t("connect.scanFailed")}</Text>
          )}
          <FlatList
            scrollEnabled={false}
            data={scan.devices}
            keyExtractor={(device) => device.id}
            renderItem={({ item }) => (
              <View style={styles.device}>
                <Text style={[styles.name, { color: colors.text }]}>
                  {item.name ?? t("connect.unnamed")}
                </Text>
                <Text style={[styles.mono, { color: colors.textMuted }]}>{item.id}</Text>
                <AppButton
                  variant="secondary"
                  title={t("connect.connectTo", { name: item.name ?? t("connect.unnamed") })}
                  disabled={busy}
                  onPress={() => void session.connect(item.id, item.name ?? undefined)}
                />
              </View>
            )}
          />
        </Card>
      )}

      {connection.kind === "connected" && (
        <>
          <Card>
            <Text style={[styles.name, { color: colors.text }]}>{connection.companion.name}</Text>
            <Text style={muted}>{t("connect.model", { model: connection.companion.model })}</Text>
            <Text style={[styles.mono, { color: colors.textMuted }]}>
              {t("connect.firmware", { version: connection.companion.firmwareVersion })}
            </Text>
            {state.firmwareTested === false && (
              <View style={styles.untested}>
                <Text style={[styles.name, { color: colors.text }]}>{t("connect.untested")}</Text>
                <Text style={text}>{t("connect.untestedBody")}</Text>
              </View>
            )}
            <AppButton
              variant="secondary"
              title={t("connect.disconnect")}
              onPress={() => void session.disconnect()}
            />
          </Card>
          <Card>
            <SectionHeading>{t("connect.capabilities")}</SectionHeading>
            {capabilities !== null &&
              CAPABILITIES.map((capability) => (
                <CapabilityRow
                  key={capability}
                  capability={capability}
                  status={capabilities[capability]}
                />
              ))}
          </Card>
          <Card>
            <SectionHeading>{t("connect.technical")}</SectionHeading>
            <View style={styles.technical}>
              <Text style={[styles.mono, { color: colors.text }]}>
                {state.mtu === null ? t("connect.mtuUnknown") : t("connect.mtu", { mtu: state.mtu })}
              </Text>
              <Text style={[styles.mono, { color: colors.text }]}>
                {t("connect.build", { date: connection.companion.buildDate })}
              </Text>
            </View>
          </Card>
        </>
      )}
    </Screen>
  );
}

function Note({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  const styles = useStyles((th) => ({
    note: { borderWidth: 1, borderRadius: th.radius.button, padding: th.space.md },
    text: { ...th.type.body },
  }));
  return (
    <View
      style={[styles.note, { backgroundColor: colors.note.bg, borderColor: colors.note.border }]}
    >
      <Text style={[styles.text, { color: colors.note.fg }]}>{children}</Text>
    </View>
  );
}

function FailureDetail({ connection }: { connection: ConnectionState }) {
  const { t } = useTranslation();
  if (connection.kind !== "failed") return null;
  return <Note>{t(`connection.reason.${connection.reason}`)}</Note>;
}

function CapabilityRow({
  capability,
  status,
}: {
  capability: Capability;
  status: NonNullable<ReturnType<typeof session.getState>["capabilities"]>[Capability];
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useStyles((th) => ({
    row: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: th.space.sm,
      paddingVertical: th.space.xs,
    },
    name: { ...th.type.bodyStrong, flexShrink: 1 },
  }));
  return (
    <View style={styles.row}>
      <Text style={[styles.name, { color: colors.text }]}>{t(`capability.${capability}`)}</Text>
      <StatusChip
        tone={status.supported ? "ok" : "unsupported"}
        icon={status.supported ? "check" : "slash"}
        label={
          status.supported
            ? t("capability.supported")
            : t("capability.unsupported", { version: status.firmwareVersion })
        }
      />
    </View>
  );
}
