import { Link, useIsFocused } from "expo-router";
import { useEffect, useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useStore } from "zustand";

import {
  syncButton,
  syncLine,
  visibleNodes,
  type NodeFilter,
} from "../application/nodes/presenter";
import { ConnectionStatus } from "../components/connection-status";
import { NearestRepeaterCard } from "../components/nearest-repeater-card";
import { NodeRow } from "../components/node-row";
import { tr } from "../components/translate";
import { statusOf } from "../application/diagnostics/presenter";
import { AppButton } from "../components/ui/button";
import { Icon } from "../components/ui/icons";
import { Screen } from "../components/ui/screen";
import { Segmented } from "../components/ui/segmented";
import { useNow } from "../components/use-now";
import { useStyles, useTheme } from "../theme/theme-provider";
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
  const { colors } = useTheme();
  const styles = useStyles((th) => ({
    connect: {
      flexDirection: "row",
      alignItems: "center",
      gap: th.space.xs,
      minHeight: 44,
      paddingHorizontal: th.space.md,
    },
    connectLabel: { ...th.type.label },
    syncRow: { gap: th.space.sm },
    syncLine: { ...th.type.small },
    note: { ...th.type.small },
    list: { flex: 1 },
    listContent: { gap: 10, paddingBottom: th.space.lg },
  }));

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
    <Screen
      title={t("dashboard.title")}
      nav="dashboard"
      titleAccessory={
        <Link href="/connect" asChild>
          <Pressable accessibilityRole="link" style={styles.connect}>
            <Icon name="bluetooth" size={16} color={colors.accent} />
            <Text style={[styles.connectLabel, { color: colors.accent }]}>{t("dashboard.connect")}</Text>
          </Pressable>
        </Link>
      }
    >
      <ConnectionStatus connection={session$.connection} />
      <View style={styles.syncRow}>
        {line !== null && <Text style={[styles.syncLine, { color: colors.textMuted }]}>{tr(t, line)}</Text>}
        <AppButton
          title={t("dashboard.syncButton")}
          icon="sync"
          disabled={!button.enabled}
          onPress={() => void controller.sync()}
        />
      </View>
      {button.reason !== null && <Text style={[styles.note, { color: colors.textMuted }]}>{tr(t, button.reason)}</Text>}
      {nodes.storage === "error" && <Text style={[styles.note, { color: colors.danger }]}>{t("dashboard.storageError")}</Text>}
      <Segmented
        value={filter}
        onChange={setFilter}
        options={[
          { id: "dashboard", label: t("dashboard.filterDashboard"), testID: "filter-dashboard" },
          { id: "all", label: t("dashboard.filterAll"), testID: "filter-all" },
        ]}
      />
      <FlatList
        style={styles.list}
        contentContainerStyle={styles.listContent}
        data={rows}
        ListHeaderComponent={<NearestRepeaterCard />}
        keyExtractor={(node) => node.publicKey}
        renderItem={({ item }) => <NodeRow node={item} status={statusOf(runState.latest[item.publicKey], now)} />}
        ListEmptyComponent={
          nodes.storage === "ok" ? (
            <Text style={[styles.note, { color: colors.textMuted }]}>
              {nodes.nodes.length === 0
                ? t("dashboard.placeholder")
                : t(filter === "dashboard" ? "dashboard.emptyDashboard" : "dashboard.empty")}
            </Text>
          ) : null
        }
      />
    </Screen>
  );
}
