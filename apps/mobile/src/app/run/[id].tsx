import type { DiagnosticRun } from "@guardian/domain";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { runDetails } from "../../application/diagnostics/presenter";
import { tr } from "../../components/translate";
import { Card, SectionHeading } from "../../components/ui/card";
import { Icon } from "../../components/ui/icons";
import { Screen } from "../../components/ui/screen";
import { container } from "../../composition";
import { useStyles, useTheme } from "../../theme/theme-provider";

const { runs } = container;

export default function RunScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  // `undefined` while loading, `null` when there is no such run.
  const [loaded, setLoaded] = useState<DiagnosticRun | null | undefined>(undefined);
  const runId = Number(id);
  const valid = Number.isInteger(runId);

  useEffect(() => {
    if (valid) void runs.get(runId).then(setLoaded);
  }, [valid, runId]);

  const run = valid ? loaded : null;

  return (
    <Screen scroll>
      {run === null && <Text style={{ color: colors.text }}>{t("run.notFound")}</Text>}
      {run !== undefined && run !== null && <Details run={run} />}
    </Screen>
  );
}

function Details({ run }: { run: DiagnosticRun }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const details = runDetails(run);
  const banner = colors.banner[details.look.tone];
  const styles = useStyles((th) => ({
    section: { gap: th.space.md },
    banner: { borderRadius: th.radius.card, padding: th.space.lg, gap: th.space.sm },
    bannerHead: { flexDirection: "row", alignItems: "center", gap: th.space.sm },
    summary: { ...th.type.detailTitle, flexShrink: 1 },
    body: { ...th.type.body },
    small: { ...th.type.small },
    check: { gap: 2, paddingVertical: th.space.sm, borderTopWidth: 1 },
    checkName: { ...th.type.bodyStrong },
    evidence: { ...th.type.monoSmall },
  }));
  return (
    <View style={styles.section}>
      <View style={[styles.banner, { backgroundColor: banner.bg }]}>
        <View style={styles.bannerHead}>
          <Icon name={details.look.icon} size={22} color={banner.fg} />
          <Text accessibilityRole="header" style={[styles.summary, { color: banner.fg }]}>
            {tr(t, details.summary)}
          </Text>
        </View>
        <Text style={[styles.body, { color: banner.fg }]}>{tr(t, details.explanation)}</Text>
      </View>

      <Card>
        <Text style={[styles.small, { color: colors.textMuted }]}>
          {new Date(run.startedAt).toLocaleString()}
        </Text>
        {details.facts.map((fact) => (
          <Text key={fact.key} style={[styles.small, { color: colors.textMuted }]}>
            {tr(t, fact)}
          </Text>
        ))}
        <SectionHeading>{t("diagnostic.section.checks")}</SectionHeading>
        {details.checks.map((check) => (
          <View key={check.name.key} style={[styles.check, { borderTopColor: colors.divider }]}>
            <Text style={[styles.checkName, { color: colors.text }]}>{tr(t, check.name)}</Text>
            <Text style={[styles.body, { color: colors.text }]}>{tr(t, check.outcome)}</Text>
            <Text style={[styles.small, { color: colors.textMuted }]}>{tr(t, check.attempts)}</Text>
            {check.timeout !== null && (
              <Text style={[styles.small, { color: colors.textMuted }]}>{tr(t, check.timeout)}</Text>
            )}
            {check.evidence.map((line, index) => (
              <Text key={index} style={[styles.evidence, { color: colors.textMuted }]}>
                {tr(t, line)}
              </Text>
            ))}
          </View>
        ))}
      </Card>

      <Section title="diagnostic.section.limitations" items={details.limitations} />
      {details.causes.length > 0 && (
        <Card>
          <SectionHeading>{t("diagnostic.section.causes")}</SectionHeading>
          {details.causesNote !== null && (
            <Text style={[styles.body, { color: colors.text }]}>{tr(t, details.causesNote)}</Text>
          )}
          {details.causes.map((cause) => (
            <Text key={cause.key} style={[styles.body, { color: colors.text }]}>
              {t("run.bullet", { text: tr(t, cause) })}
            </Text>
          ))}
        </Card>
      )}
      <Section title="diagnostic.section.nextSteps" items={details.nextSteps} />
    </View>
  );
}

function Section(props: { title: string; items: { key: string }[] }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useStyles((th) => ({ body: { ...th.type.body } }));
  if (props.items.length === 0) return null;
  return (
    <Card>
      <SectionHeading>{(t as unknown as (key: string) => string)(props.title)}</SectionHeading>
      {props.items.map((item) => (
        <Text key={item.key} style={[styles.body, { color: colors.text }]}>
          {t("run.bullet", { text: tr(t, item) })}
        </Text>
      ))}
    </Card>
  );
}
