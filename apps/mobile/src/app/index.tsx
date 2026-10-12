import { Link, useIsFocused } from "expo-router";
import { useEffect, useState } from "react";
import { Button, FlatList, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useStore } from "zustand";

import {
  syncButton,
  syncLine,
  visibleNodes,
  type NodeFilter,
} from "../application/nodes/presenter";
import { ConnectionStatus } from "../components/connection-status";
import { NodeRow } from "../components/node-row";
import { tr } from "../components/translate";
import { statusOf } from "../application/diagnostics/presenter";
import { useNow } from "../components/use-now";
import { container } from "../composition";

const { nodes: controller, session, runs } = container;

/** Relative ages ("2 minutes ago") are recomputed this often while the dashboard is in front. */
const STATUS_REFRESH_MS = 30_000;

export default function DashboardScreen() {
  const { t } = useTranslation();
  const session$ = useStore(session.store);
  const nodes = useStore(controller.store);
  const runState = useStore(runs.store);
  const now = useNow(useIsFocused(), STATUS_REFRESH_MS);
  const [filter, setFilter] = useState<NodeFilter>("dashboard");

  useEffect(() => {
    void controller.load();
    void runs.load();
  }, []);

  const rows = visibleNodes(nodes.nodes, filter);
  const line = syncLine(nodes.sync);
  const button = syncButton({
    connected: session$.connection.kind === "connected",
    capabilities: session$.capabilities,
    sync: nodes.sync,
  });

  return (
    <View style={styles.container}>
      <Text accessibilityRole="header" style={styles.title}>
        {t("dashboard.title")}
      </Text>
      <ConnectionStatus connection={session$.connection} />
      <Link href="/connect">
        <Text accessibilityRole="link" style={styles.link}>
          {t("dashboard.connect")}
        </Text>
      </Link>
      {line !== null && <Text>{tr(t, line)}</Text>}
      <Button
        title={t("dashboard.syncButton")}
        disabled={!button.enabled}
        onPress={() => void controller.sync()}
      />
      {button.reason !== null && <Text>{tr(t, button.reason)}</Text>}
      {nodes.storage === "error" && <Text>{t("dashboard.storageError")}</Text>}
      <View style={styles.filters}>
        <FilterButton
          id="filter-dashboard"
          title={t("dashboard.filterDashboard")}
          selected={filter === "dashboard"}
          onPress={() => setFilter("dashboard")}
        />
        <FilterButton
          id="filter-all"
          title={t("dashboard.filterAll")}
          selected={filter === "all"}
          onPress={() => setFilter("all")}
        />
      </View>
      <FlatList
        style={styles.list}
        data={rows}
        keyExtractor={(node) => node.publicKey}
        renderItem={({ item }) => <NodeRow node={item} status={statusOf(runState.latest[item.publicKey], now)} />}
        ListEmptyComponent={
          nodes.storage === "ok" ? (
            <Text>
              {nodes.nodes.length === 0
                ? t("dashboard.placeholder")
                : t(filter === "dashboard" ? "dashboard.emptyDashboard" : "dashboard.empty")}
            </Text>
          ) : null
        }
      />
    </View>
  );
}

function FilterButton(props: {
  id: string;
  title: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <View style={styles.filter}>
      <Button
        title={props.title}
        testID={props.id}
        accessibilityState={{ selected: props.selected }}
        color={props.selected ? "#1f4e8c" : "#6b7280"}
        onPress={props.onPress}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 12 },
  title: { fontSize: 24, fontWeight: "600" },
  link: { fontSize: 16, textDecorationLine: "underline" },
  filters: { flexDirection: "row", gap: 8 },
  filter: { flex: 1 },
  list: { flex: 1 },
});
