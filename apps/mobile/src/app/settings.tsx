import Constants from "expo-constants";
import { useEffect, useState } from "react";
import { Alert, Switch, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useStore } from "zustand";

import type { Text as ViewText } from "../application/nodes/presenter";
import type { DeletionResult } from "../application/settings/data-deletion";
import { dataView, deletionMessage, saveProblem, settingsView } from "../application/settings/presenter";
import type { SaveResult } from "../application/settings/settings-controller";
import { TIMEOUT_RANGE_S } from "../application/settings/settings";
import { tr } from "../components/translate";
import { AppButton } from "../components/ui/button";
import { Card, SectionHeading } from "../components/ui/card";
import { Screen } from "../components/ui/screen";
import { Segmented } from "../components/ui/segmented";
import { container } from "../composition";
import { useStyles, useTheme } from "../theme/theme-provider";

const ATTEMPT_IDS = ["1", "2", "3"] as const;

export default function SettingsScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const state = useStore(container.settings.store);
  const session = useStore(container.session.store);
  const runs = useStore(container.runs.store);
  const nodes = useStore(container.nodes.store);
  const [result, setResult] = useState<ViewText | null>(null);
  useEffect(() => {
    void container.nodes.load();
    void container.runs.load();
  }, []);
  const [timeoutText, setTimeoutText] = useState("");
  const [problem, setProblem] = useState<ViewText | null>(null);
  const styles = useStyles((th) => ({
    section: { gap: th.space.md },
    body: { ...th.type.body },
    small: { ...th.type.small },
    strong: { ...th.type.bodyStrong },
    row: { flexDirection: "row", alignItems: "center", gap: th.space.sm },
    input: {
      ...th.type.body,
      flex: 1,
      minHeight: 44,
      borderWidth: 1,
      borderRadius: th.radius.button,
      paddingHorizontal: th.space.md,
    },
    switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: th.space.md },
    switchLabel: { ...th.type.bodyStrong, flexShrink: 1 },
  }));

  const view = settingsView(state, session, Constants.expoConfig?.version ?? "unknown");
  const mode = t(`transport.${container.mode}`);

  const data = dataView(runs, nodes);
  const busy = data.busyNote !== null;

  const report = (scope: "node" | "all") => (outcome: DeletionResult) =>
    setResult(deletionMessage(outcome, scope));

  const confirmDelete = (publicKey: string, name: string) =>
    Alert.alert(t("settings.confirmDeleteTitle"), t("settings.confirmDeleteMessage", { name }), [
      { text: t("settings.cancel"), style: "cancel" },
      {
        text: t("settings.confirmDelete"),
        style: "destructive",
        onPress: () => void container.deletion.deleteNodeHistory(publicKey).then(report("node")),
      },
    ]);

  const confirmClear = () =>
    Alert.alert(t("settings.confirmClearTitle"), t("settings.confirmClearMessage"), [
      { text: t("settings.cancel"), style: "cancel" },
      {
        text: t("settings.confirmClear"),
        style: "destructive",
        onPress: () => void container.deletion.clearAll().then(report("all")),
      },
    ]);

  const finish = (result: SaveResult) => setProblem(saveProblem(result));

  return (
    <Screen title={t("settings.title")} nav="settings" scroll>
      {view.loading ? (
        <Text style={[styles.body, { color: colors.textMuted }]}>{t("settings.loading")}</Text>
      ) : (
        <View style={styles.section}>
          {view.unreadableNote !== null && (
            <Text accessibilityRole="alert" style={[styles.body, { color: colors.danger }]}>
              {tr(t, view.unreadableNote)}
            </Text>
          )}

          <Card>
            <SectionHeading>{t("settings.diagnostics")}</SectionHeading>
            <Text style={[styles.strong, { color: colors.text }]}>{tr(t, view.timeout)}</Text>
            <Text style={[styles.small, { color: colors.textMuted }]}>
              {t("settings.timeoutHelp", { min: TIMEOUT_RANGE_S[0], max: TIMEOUT_RANGE_S[1] })}
            </Text>
            <View style={styles.row}>
              <TextInput
                testID="settings-timeout-input"
                accessibilityLabel={t("settings.timeoutLabel")}
                keyboardType="number-pad"
                value={timeoutText}
                onChangeText={setTimeoutText}
                style={[styles.input, { color: colors.text, borderColor: colors.borderStrong }]}
              />
              <AppButton
                testID="settings-timeout-save"
                title={t("settings.timeoutSave")}
                onPress={() => void container.settings.setTimeout(timeoutText).then(finish)}
              />
              <AppButton
                testID="settings-timeout-auto"
                title={t("settings.timeoutAutoButton")}
                variant="secondary"
                onPress={() => {
                  setTimeoutText("");
                  void container.settings.setTimeout("auto").then(finish);
                }}
              />
            </View>
            {problem !== null && (
              <Text accessibilityRole="alert" style={[styles.body, { color: colors.danger }]}>
                {tr(t, problem)}
              </Text>
            )}
            <Text style={[styles.strong, { color: colors.text }]}>{t("settings.attemptsLabel")}</Text>
            <Segmented<(typeof ATTEMPT_IDS)[number]>
              options={ATTEMPT_IDS.map((id) => ({
                id,
                label: t(`settings.attempts${id}`),
                testID: `settings-attempts-${id}`,
              }))}
              value={`${view.attempts}` as (typeof ATTEMPT_IDS)[number]}
              onChange={(id) => void container.settings.setAttempts(Number(id)).then(finish)}
            />
          </Card>

          <Card>
            <SectionHeading>{t("settings.export")}</SectionHeading>
            <View style={styles.switchRow}>
              <Text style={[styles.switchLabel, { color: colors.text }]}>{t("settings.redact")}</Text>
              <Switch
                testID="settings-redact"
                accessibilityLabel={t("settings.redact")}
                value={view.redactKeys}
                onValueChange={(on) => void container.settings.setRedactKeys(on).then(finish)}
              />
            </View>
            <Text style={[styles.small, { color: colors.textMuted }]}>{t("settings.redactHelp")}</Text>
          </Card>

          <Card>
            <SectionHeading>{t("settings.about")}</SectionHeading>
            <Text style={[styles.body, { color: colors.text }]}>{tr(t, view.appVersion)}</Text>
            {view.companion.kind === "none" ? (
              <Text style={[styles.body, { color: colors.textMuted }]}>{tr(t, view.companion.text)}</Text>
            ) : (
              <>
                <Text style={[styles.strong, { color: colors.text }]}>{view.companion.name}</Text>
                {view.companion.lines.map((line) => (
                  <Text key={line.key} style={[styles.body, { color: colors.text }]}>
                    {tr(t, line)}
                  </Text>
                ))}
                {view.companion.untested && (
                  <Text style={[styles.small, { color: colors.textMuted }]}>
                    {t("settings.untested", { title: t("connect.untested"), body: t("connect.untestedBody") })}
                  </Text>
                )}
              </>
            )}
            <Text style={[styles.small, { color: colors.textMuted }]}>{t("settings.transport", { mode })}</Text>
          </Card>

          <Card>
            <SectionHeading>{t("settings.data")}</SectionHeading>
            <Text style={[styles.small, { color: colors.textMuted }]}>{t("settings.dataHelp")}</Text>
            {data.empty !== null && (
              <Text style={[styles.body, { color: colors.text }]}>{tr(t, data.empty)}</Text>
            )}
            {data.rows.map((row) => {
              const name = tr(t, row.name);
              return (
                <AppButton
                  key={row.publicKey}
                  testID={`settings-delete-${row.prefix}`}
                  title={t("settings.deleteHistory", { name })}
                  variant="secondary"
                  disabled={busy}
                  onPress={() => confirmDelete(row.publicKey, name)}
                />
              );
            })}
            <AppButton
              testID="settings-clear-all"
              title={t("settings.clearAll")}
              variant="danger"
              disabled={busy}
              onPress={confirmClear}
            />
            {data.busyNote !== null && (
              <Text style={[styles.small, { color: colors.textMuted }]}>{tr(t, data.busyNote)}</Text>
            )}
            {result !== null && (
              <Text accessibilityRole="alert" style={[styles.body, { color: colors.text }]}>
                {tr(t, result)}
              </Text>
            )}
          </Card>
        </View>
      )}
    </Screen>
  );
}
