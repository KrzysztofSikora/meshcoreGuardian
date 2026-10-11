import type { Capability, ConnectionState } from "@guardian/domain";
import { CAPABILITIES } from "@guardian/domain";
import { useEffect, useState } from "react";
import { Button, FlatList, ScrollView, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useStore } from "zustand";

import { ConnectionStatus } from "../components/connection-status";
import { container } from "../composition";

const { session } = container;

export default function ConnectScreen() {
  const { t } = useTranslation();
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

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text accessibilityRole="header" style={styles.title}>
        {t("connect.title")}
      </Text>
      <ConnectionStatus connection={connection} />
      <FailureDetail connection={connection} />
      {state.linkLostNote && <Text>{t("connect.linkLost")}</Text>}

      {!granted && !showRequired && permission !== "unknown" && (
        <View style={styles.card}>
          <Text>{t("connect.permission.explain")}</Text>
          <Button title={t("connect.permission.grant")} onPress={grant} />
        </View>
      )}
      {showRequired && (
        <View style={styles.card}>
          <Text style={styles.heading}>{t("connect.permission.required")}</Text>
          <Text>{t("connect.permission.requiredBody")}</Text>
          <Button
            title={t("connect.permission.openSettings")}
            onPress={() => void session.openSettings()}
          />
          <Button title={t("connect.permission.tryAgain")} onPress={grant} />
        </View>
      )}

      {granted && bluetooth === "off" && (
        <View style={styles.card}>
          <Text style={styles.heading}>{t("connect.bluetoothOff")}</Text>
          <Text>{t("connect.bluetoothOffBody")}</Text>
        </View>
      )}
      {granted && bluetooth === "unavailable" && (
        <Text style={styles.heading}>{t("connect.bluetoothUnavailable")}</Text>
      )}

      {granted && !connected && (
        <View style={styles.card}>
          {lastCompanion !== null && !busy && (
            <Button
              title={t("connect.connectLast", { name: lastCompanion.name })}
              onPress={() => void session.connect(lastCompanion.id, lastCompanion.name)}
            />
          )}
          {connection.kind === "failed" && (
            <Button title={t("connect.retry")} onPress={() => void session.retry()} />
          )}
          {state.linkLostNote && (
            <Button title={t("connect.reconnect")} onPress={() => void session.reconnect()} />
          )}
          <Button
            title={scan.status === "scanning" ? t("connect.scanning") : t("connect.scan")}
            disabled={scan.status === "scanning" || busy}
            onPress={() => void session.startScan()}
          />
          {scan.status === "done" && scan.devices.length === 0 && bluetooth === "on" && (
            <Text>{t("connect.noneFound")}</Text>
          )}
          {scan.status === "failed" && bluetooth === "on" && <Text>{t("connect.scanFailed")}</Text>}
          <FlatList
            scrollEnabled={false}
            data={scan.devices}
            keyExtractor={(device) => device.id}
            renderItem={({ item }) => (
              <View style={styles.device}>
                <Text style={styles.heading}>{item.name ?? t("connect.unnamed")}</Text>
                <Text>{item.id}</Text>
                <Button
                  title={t("connect.connectTo", { name: item.name ?? t("connect.unnamed") })}
                  disabled={busy}
                  onPress={() => void session.connect(item.id, item.name ?? undefined)}
                />
              </View>
            )}
          />
        </View>
      )}

      {connection.kind === "connected" && (
        <View style={styles.card}>
          <Text style={styles.heading}>{connection.companion.name}</Text>
          <Text>{t("connect.model", { model: connection.companion.model })}</Text>
          <Text>{t("connect.firmware", { version: connection.companion.firmwareVersion })}</Text>
          {state.firmwareTested === false && (
            <View>
              <Text style={styles.heading}>{t("connect.untested")}</Text>
              <Text>{t("connect.untestedBody")}</Text>
            </View>
          )}
          <Text style={styles.heading}>{t("connect.capabilities")}</Text>
          {capabilities !== null &&
            CAPABILITIES.map((capability) => (
              <CapabilityRow
                key={capability}
                capability={capability}
                status={capabilities[capability]}
              />
            ))}
          <Text style={styles.heading}>{t("connect.technical")}</Text>
          <Text>
            {state.mtu === null ? t("connect.mtuUnknown") : t("connect.mtu", { mtu: state.mtu })}
          </Text>
          <Text>{t("connect.build", { date: connection.companion.buildDate })}</Text>
          <Button title={t("connect.disconnect")} onPress={() => void session.disconnect()} />
        </View>
      )}
    </ScrollView>
  );
}

function FailureDetail({ connection }: { connection: ConnectionState }) {
  const { t } = useTranslation();
  if (connection.kind !== "failed") return null;
  return <Text>{t(`connection.reason.${connection.reason}`)}</Text>;
}

function CapabilityRow({
  capability,
  status,
}: {
  capability: Capability;
  status: NonNullable<ReturnType<typeof session.getState>["capabilities"]>[Capability];
}) {
  const { t } = useTranslation();
  const mark = status.supported ? "✓" : "✕";
  return (
    <View style={styles.row}>
      <Text accessibilityElementsHidden importantForAccessibility="no">
        {mark}
      </Text>
      <Text style={styles.capability}>{t(`capability.${capability}`)}</Text>
      <Text>
        {status.supported
          ? t("capability.supported")
          : t("capability.unsupported", { version: status.firmwareVersion })}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, gap: 12 },
  title: { fontSize: 24, fontWeight: "600" },
  heading: { fontSize: 16, fontWeight: "600" },
  card: { gap: 8 },
  device: { gap: 4, paddingVertical: 8 },
  row: { flexDirection: "row", gap: 8, alignItems: "center", flexWrap: "wrap" },
  capability: { fontWeight: "600" },
});
