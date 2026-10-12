import {
  NODE_ROLES,
  cooldownRemaining,
  effectiveRole,
  isOnDashboard,
  keyPrefix,
  type Node,
} from "@guardian/domain";
import { Link, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Button, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useStore } from "zustand";

import {
  progressText,
  runButton,
  runDetails,
  statusOf,
} from "../../application/diagnostics/presenter";
import {
  lastHeardText,
  nameText,
  reportedAsText,
  reportedNameText,
  roleText,
} from "../../application/nodes/presenter";
import { formatTime } from "../../components/node-row";
import { RunStatus } from "../../components/run-status";
import { tr } from "../../components/translate";
import { useNow } from "../../components/use-now";
import { container } from "../../composition";

const { nodes: controller, runs, session } = container;

const COUNTDOWN_TICK_MS = 1000;

export default function NodeScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const state = useStore(controller.store);

  useEffect(() => {
    void controller.load();
    void runs.load();
  }, []);

  const node = state.nodes.find((candidate) => candidate.publicKey === id);
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text accessibilityRole="header" style={styles.title}>
        {t("node.title")}
      </Text>
      {node === undefined ? (
        state.loaded && <Text>{t("nodes.notFound")}</Text>
      ) : (
        <NodeDetails node={node} />
      )}
      <Text>{t("node.placeholder")}</Text>
    </ScrollView>
  );
}

function NodeDetails({ node }: { node: Node }) {
  const { t } = useTranslation();
  const [label, setLabel] = useState(node.userLabel ?? "");
  const [error, setError] = useState<string | null>(null);

  const name = nameText(node);
  const reported = reportedAsText(node);
  const reportedName = reportedNameText(node);
  const heard = lastHeardText(node, formatTime);

  const report = (result: Awaited<ReturnType<typeof controller.setLabel>>) => {
    if (result.ok) return setError(null);
    setError(result.reason === "TOO_LONG" ? "nodes.labelTooLong" : "nodes.saveFailed");
  };

  return (
    <View style={styles.section}>
      <Text style={styles.name}>{tr(t, name)}</Text>
      <Text>{t("nodes.keyPrefix", { prefix: keyPrefix(node.publicKey) })}</Text>
      <Text>{t("nodes.role", { role: tr(t, roleText(effectiveRole(node))) })}</Text>
      {reportedName !== null && <Text>{tr(t, reportedName)}</Text>}
      {reported !== null && <Text>{tr(t, reported)}</Text>}
      <Text>{tr(t, heard)}</Text>
      {!node.inContacts && <Text>{t("nodes.notInContacts")}</Text>}

      <RunPanel node={node} />

      <Text style={styles.heading}>{t("nodes.label")}</Text>
      <TextInput
        testID="label-input"
        accessibilityLabel={t("nodes.label")}
        style={styles.input}
        value={label}
        onChangeText={setLabel}
        autoCapitalize="none"
      />
      <Text>{t("nodes.labelHelp")}</Text>
      <Button
        title={t("nodes.saveLabel")}
        onPress={() => void controller.setLabel(node.publicKey, label).then(report)}
      />

      <Text style={styles.heading}>{t("nodes.setRole")}</Text>
      {NODE_ROLES.map((role) => (
        <Button
          key={role}
          title={tr(t, roleText(role))}
          accessibilityState={{ selected: node.userRole === role }}
          onPress={() => void controller.setRole(node.publicKey, role).then(report)}
        />
      ))}
      <Button
        title={t("nodes.useReportedRole")}
        disabled={node.userRole === null}
        onPress={() => void controller.setRole(node.publicKey, null).then(report)}
      />

      {!isOnDashboard(node) && (
        <Button
          title={t("nodes.addToDashboard")}
          onPress={() => void controller.pin(node.publicKey).then(report)}
        />
      )}
      {error !== null && (
        <Text accessibilityRole="alert">
          {t(error === "nodes.labelTooLong" ? "nodes.labelTooLong" : "nodes.saveFailed")}
        </Text>
      )}
    </View>
  );
}

function RunPanel({ node }: { node: Node }) {
  const { t } = useTranslation();
  const connection = useStore(session.store);
  const state = useStore(runs.store);
  const latest = state.latest[node.publicKey];
  const now = useNow(true, COUNTDOWN_TICK_MS);
  const active = state.active?.publicKey === node.publicKey ? state.active : null;
  const button = runButton({
    connected: connection.connection.kind === "connected",
    capabilities: connection.capabilities,
    running: state.active !== null,
    inContacts: node.inContacts,
    cooldownMs: cooldownRemaining(latest ?? null, now),
  });
  const refusal = state.refusal?.publicKey === node.publicKey ? state.refusal.text : null;
  const details = latest === undefined ? null : runDetails(latest);
  const unsaved = state.last?.publicKey === node.publicKey && state.last.runId === null;

  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.heading}>
        {t("diagnostic.heading")}
      </Text>
      <RunStatus status={statusOf(latest, now)} />
      {state.notice === node.publicKey ? (
        <View style={styles.section}>
          <Text style={styles.heading}>{t("diagnostic.notice.title")}</Text>
          <Text>{t("diagnostic.notice.body")}</Text>
          <Button title={t("diagnostic.run")} onPress={() => void runs.confirmNotice()} />
          <Button title={t("diagnostic.notice.notNow")} onPress={() => runs.dismissNotice()} />
        </View>
      ) : active !== null ? (
        <View style={styles.section}>
          <Text accessibilityLiveRegion="polite">{tr(t, progressText(active))}</Text>
          <Button title={t("diagnostic.cancel")} onPress={() => runs.cancel()} />
        </View>
      ) : (
        <Button
          title={t("diagnostic.run")}
          disabled={!button.enabled}
          onPress={() => void runs.start(node.publicKey)}
        />
      )}
      {active === null && button.reason !== null && <Text>{tr(t, button.reason)}</Text>}
      {refusal !== null && <Text accessibilityRole="alert">{tr(t, refusal)}</Text>}
      {active === null && latest !== undefined && details !== null && (
        <View style={styles.section}>
          <Text style={styles.name}>{tr(t, details.summary)}</Text>
          <Text>{tr(t, details.explanation)}</Text>
          {unsaved && <Text>{t("diagnostic.notSaved")}</Text>}
          {latest.id !== undefined && (
            <Link href={{ pathname: "/run/[id]", params: { id: String(latest.id) } }} asChild>
              <Button title={t("diagnostic.viewDetails")} />
            </Link>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, gap: 12 },
  title: { fontSize: 24, fontWeight: "600" },
  section: { gap: 8 },
  name: { fontSize: 18, fontWeight: "600" },
  heading: { fontSize: 16, fontWeight: "600", marginTop: 8 },
  input: { borderWidth: 1, borderColor: "#6b7280", padding: 8, fontSize: 16 },
});
