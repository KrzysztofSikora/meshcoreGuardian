import { Link } from "expo-router";
import { Pressable, Text } from "react-native";
import { useTranslation } from "react-i18next";

import type { RecentRunRow } from "../application/nodes/history-presenter";
import { RunStatus } from "./run-status";
import { tr } from "./translate";
import { useStyles, useTheme } from "../theme/theme-provider";

/** One stored run: time, status as text plus icon, duration. Opens the run screen. */
export function RunRow({ runId, row }: { runId: number; row: RecentRunRow }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useStyles((th) => ({
    row: {
      borderWidth: 1,
      borderRadius: th.radius.card,
      padding: th.space.md,
      gap: th.space.xs,
      minHeight: 44,
    },
    body: { ...th.type.body },
    small: { ...th.type.small },
  }));
  return (
    <Link href={{ pathname: "/run/[id]", params: { id: String(runId) } }} asChild>
      <Pressable
        accessibilityRole="link"
        style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}
      >
        <Text style={[styles.body, { color: colors.text }]}>{tr(t, row.time)}</Text>
        <RunStatus status={row.status} />
        <Text style={[styles.small, { color: colors.textMuted }]}>{tr(t, row.duration)}</Text>
      </Pressable>
    </Link>
  );
}
