import type { ExportFormat } from "@guardian/domain";
import { useLocalSearchParams } from "expo-router";
import { useEffect } from "react";
import { Switch, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useStore } from "zustand";

import { EXPORT_DAYS, type ExportDays } from "../../application/export/export-controller";
import { exportPreview } from "../../application/export/presenter";
import { nameText } from "../../application/nodes/presenter";
import { formatTime } from "../../components/node-row";
import { tr } from "../../components/translate";
import { AppButton } from "../../components/ui/button";
import { Card, SectionHeading } from "../../components/ui/card";
import { Screen } from "../../components/ui/screen";
import { Segmented } from "../../components/ui/segmented";
import { container } from "../../composition";
import { useStyles, useTheme } from "../../theme/theme-provider";

const { exporter } = container;

const FORMATS: ExportFormat[] = ["json", "csv"];

export default function ExportScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const state = useStore(exporter.store);
  const { colors } = useTheme();
  const styles = useStyles((th) => ({
    section: { gap: th.space.md },
    heading: { ...th.type.detailTitle },
    body: { ...th.type.body },
    small: { ...th.type.small },
    mono: { ...th.type.monoSmall },
    switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: th.space.md },
    switchLabel: { ...th.type.bodyStrong, flexShrink: 1 },
  }));

  useEffect(() => {
    if (id === undefined) return;
    void exporter.open(id);
    // A new visit starts from the defaults and a fresh read (D-10).
    return () => exporter.close();
  }, [id]);

  const preview = exportPreview(state, formatTime);
  const node = state.input?.node;
  const owned = state.publicKey === id;

  return (
    <Screen scroll>
      <View style={styles.section}>
        <Text accessibilityRole="header" style={[styles.heading, { color: colors.text }]}>
          {node === undefined ? t("export.heading") : tr(t, nameText(node))}
        </Text>

        <Card>
          <SectionHeading>{t("export.rangeLabel")}</SectionHeading>
          <Segmented<`${ExportDays}`>
            options={EXPORT_DAYS.map((days) => ({
              id: `${days}` as `${ExportDays}`,
              label: t(`export.days${days}`),
              testID: `export-days-${days}`,
            }))}
            value={`${state.days}`}
            onChange={(days) => void exporter.setDays(Number(days) as ExportDays)}
          />
          <SectionHeading>{t("export.formatLabel")}</SectionHeading>
          <Segmented<ExportFormat>
            options={FORMATS.map((format) => ({
              id: format,
              label: t(`export.${format}`),
              testID: `export-format-${format}`,
            }))}
            value={state.format}
            onChange={(format) => exporter.setFormat(format)}
          />
          <View style={styles.switchRow}>
            <Text style={[styles.switchLabel, { color: colors.text }]}>{t("export.fullKeys")}</Text>
            <Switch
              testID="export-full-keys"
              accessibilityLabel={t("export.fullKeys")}
              value={!state.redactKeys}
              onValueChange={(on) => exporter.setRedactKeys(!on)}
            />
          </View>
          <Text style={[styles.small, { color: colors.textMuted }]}>{t("export.fullKeysHelp")}</Text>
        </Card>

        {owned && (
          <Card>
            <SectionHeading>{t("export.previewHeading")}</SectionHeading>
            {preview.problem !== null && (
              <Text accessibilityRole="alert" style={[styles.body, { color: colors.danger }]}>
                {tr(t, preview.problem)}
              </Text>
            )}
            {preview.problem === null && !state.loaded && (
              <Text style={[styles.small, { color: colors.textMuted }]}>{t("export.loading")}</Text>
            )}
            {preview.range !== null && <Text style={[styles.body, { color: colors.text }]}>{tr(t, preview.range)}</Text>}
            {preview.counts !== null && (
              <Text style={[styles.body, { color: colors.text }]}>{tr(t, preview.counts)}</Text>
            )}
            {preview.emptyNotice !== null && (
              <Text style={[styles.body, { color: colors.text }]}>{tr(t, preview.emptyNotice)}</Text>
            )}
            <SectionHeading>{t("export.fieldsHeading")}</SectionHeading>
            {preview.fields.kind === "columns" ? (
              <Text testID="export-fields" style={[styles.mono, { color: colors.text }]}>
                {preview.fields.names.join(", ")}
              </Text>
            ) : (
              <View testID="export-fields" style={styles.section}>
                {preview.fields.groups.map((group) => (
                  <Text key={group.group} style={[styles.mono, { color: colors.text }]}>
                    {[group.group, group.keys.join(", ")].join(": ")}
                  </Text>
                ))}
              </View>
            )}
            {preview.redactions.map((text) => (
              <Text key={text.key} style={[styles.body, { color: colors.text }]}>
                {tr(t, text)}
              </Text>
            ))}
            {preview.neverIncluded.map((text) => (
              <Text key={text.key} style={[styles.body, { color: colors.text }]}>
                {tr(t, text)}
              </Text>
            ))}
          </Card>
        )}

        {owned && preview.shareProblem !== null && (
          <Text accessibilityRole="alert" style={[styles.body, { color: colors.danger }]}>
            {tr(t, preview.shareProblem)}
          </Text>
        )}
        <AppButton
          testID="export-share"
          title={state.share === "sharing" ? t("export.sharing") : t("export.share")}
          icon="download"
          fullWidth
          disabled={!owned || preview.shareDisabled}
          onPress={() => void exporter.share()}
        />
      </View>
    </Screen>
  );
}
