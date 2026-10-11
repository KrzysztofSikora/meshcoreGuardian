import { Link } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import type { Node } from "@guardian/domain";

import { nodeRowModel } from "../application/nodes/presenter";
import { tr } from "./translate";

export function formatTime(ms: number): string {
  return new Date(ms).toLocaleString();
}

/** One known node. Role and "not in contacts" are words, never colour (FR-04, NFR-05). */
export function NodeRow({ node }: { node: Node }) {
  const { t } = useTranslation();
  const model = nodeRowModel(node, formatTime);
  const name = tr(t, model.name);
  const role = tr(t, model.role);
  const lastHeard = tr(t, model.lastHeard);
  const missing = t("nodes.notInContacts");
  const label = [name, role, lastHeard, ...(model.notInContacts ? [missing] : [])].join(". ");
  return (
    <Link href={{ pathname: "/node/[id]", params: { id: node.publicKey } }} asChild>
      <Pressable accessibilityRole="button" accessibilityLabel={label} style={styles.row}>
        <View style={styles.body}>
          <Text style={styles.name}>{name}</Text>
          <Text>{role}</Text>
          <Text>{lastHeard}</Text>
          {model.notInContacts && <Text>{missing}</Text>}
        </View>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  row: { paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  body: { gap: 2 },
  name: { fontSize: 16, fontWeight: "600" },
});
