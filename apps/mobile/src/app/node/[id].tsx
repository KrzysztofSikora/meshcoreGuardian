import { NODE_ROLES, effectiveRole, isOnDashboard, keyPrefix, type Node } from "@guardian/domain";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Button, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useStore } from "zustand";

import {
  lastHeardText,
  nameText,
  reportedAsText,
  roleText,
} from "../../application/nodes/presenter";
import { formatTime } from "../../components/node-row";
import { tr } from "../../components/translate";
import { container } from "../../composition";

const { nodes: controller } = container;

export default function NodeScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const state = useStore(controller.store);

  useEffect(() => {
    void controller.load();
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
      {reported !== null && <Text>{tr(t, reported)}</Text>}
      <Text>{tr(t, heard)}</Text>
      {!node.inContacts && <Text>{t("nodes.notInContacts")}</Text>}

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

const styles = StyleSheet.create({
  container: { padding: 24, gap: 12 },
  title: { fontSize: 24, fontWeight: "600" },
  section: { gap: 8 },
  name: { fontSize: 18, fontWeight: "600" },
  heading: { fontSize: 16, fontWeight: "600", marginTop: 8 },
  input: { borderWidth: 1, borderColor: "#6b7280", padding: 8, fontSize: 16 },
});
