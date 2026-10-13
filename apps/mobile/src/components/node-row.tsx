import { Link } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import type { Node, RunStatus as Status } from "@guardian/domain";

import { statusText } from "../application/diagnostics/presenter";
import { nodeRowModel } from "../application/nodes/presenter";
import { useStyles, useTheme } from "../theme/theme-provider";
import { RunStatus } from "./run-status";
import { StatusChip } from "./ui/status-chip";
import { tr } from "./translate";

export function formatTime(ms: number): string {
  return new Date(ms).toLocaleString();
}

/** One known node. Role and "not in contacts" are words, never colour (FR-04, NFR-05). */
export function NodeRow({ node, status }: { node: Node; status: Status }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useStyles((th) => ({
    card: { borderWidth: 1, borderRadius: th.radius.card, padding: th.space.lg, gap: th.space.sm },
    head: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: th.space.md },
    name: { ...th.type.name, flexShrink: 1 },
    role: { ...th.type.small, flexShrink: 0 },
    chips: { flexDirection: "row", flexWrap: "wrap", gap: th.space.sm },
    heard: { ...th.type.small },
  }));
  const model = nodeRowModel(node, formatTime);
  const name = tr(t, model.name);
  const role = tr(t, model.role);
  const lastHeard = tr(t, model.lastHeard);
  const missing = t("nodes.notInContacts");
  const label = [name, role, tr(t, statusText(status)), lastHeard, ...(model.notInContacts ? [missing] : [])].join(". ");
  return (
    <Link href={{ pathname: "/node/[id]", params: { id: node.publicKey } }} asChild>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        style={[
          styles.card,
          {
            backgroundColor: colors.surface,
            borderColor: model.notInContacts ? colors.borderStrong : colors.border,
            borderStyle: model.notInContacts ? "dashed" : "solid",
          },
        ]}
      >
        <View style={styles.head}>
          <Text style={[styles.name, { color: colors.text }]}>{name}</Text>
          <Text style={[styles.role, { color: colors.textMuted }]}>{role}</Text>
        </View>
        <View style={styles.chips}>
          <RunStatus status={status} />
          {model.notInContacts && <StatusChip tone="unsupported" icon="slash" label={missing} />}
        </View>
        <Text style={[styles.heard, { color: colors.textMuted }]}>{lastHeard}</Text>
      </Pressable>
    </Link>
  );
}
