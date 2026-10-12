import type { DiagnosticRun } from "@guardian/domain";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { runDetails } from "../../application/diagnostics/presenter";
import { tr } from "../../components/translate";
import { container } from "../../composition";

const { runs } = container;

export default function RunScreen() {
  const { t } = useTranslation();
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
    <ScrollView contentContainerStyle={styles.container}>
      <Text accessibilityRole="header" style={styles.title}>
        {t("run.title")}
      </Text>
      {run === null && <Text>{t("run.notFound")}</Text>}
      {run !== undefined && run !== null && <Details run={run} />}
    </ScrollView>
  );
}

function Details({ run }: { run: DiagnosticRun }) {
  const { t } = useTranslation();
  const details = runDetails(run);
  return (
    <View style={styles.section}>
      <Text style={styles.summary}>{tr(t, details.summary)}</Text>
      <Text>{tr(t, details.explanation)}</Text>
      <Text>{new Date(run.startedAt).toLocaleString()}</Text>
      {details.facts.map((fact) => (
        <Text key={fact.key}>{tr(t, fact)}</Text>
      ))}

      <Text accessibilityRole="header" style={styles.heading}>
        {t("diagnostic.section.checks")}
      </Text>
      {details.checks.map((check) => (
        <View key={check.name.key} style={styles.check}>
          <Text style={styles.name}>{tr(t, check.name)}</Text>
          <Text>{tr(t, check.outcome)}</Text>
          <Text>{tr(t, check.attempts)}</Text>
          {check.timeout !== null && <Text>{tr(t, check.timeout)}</Text>}
          {check.evidence.map((line, index) => (
            <Text key={index}>{tr(t, line)}</Text>
          ))}
        </View>
      ))}

      <Section title="diagnostic.section.limitations" items={details.limitations} />
      {details.causes.length > 0 && (
        <View style={styles.section}>
          <Text accessibilityRole="header" style={styles.heading}>
            {t("diagnostic.section.causes")}
          </Text>
          {details.causesNote !== null && <Text>{tr(t, details.causesNote)}</Text>}
          {details.causes.map((cause) => (
            <Text key={cause.key}>{t("run.bullet", { text: tr(t, cause) })}</Text>
          ))}
        </View>
      )}
      <Section title="diagnostic.section.nextSteps" items={details.nextSteps} />
    </View>
  );
}

function Section(props: { title: string; items: { key: string }[] }) {
  const { t } = useTranslation();
  if (props.items.length === 0) return null;
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.heading}>
        {(t as unknown as (key: string) => string)(props.title)}
      </Text>
      {props.items.map((item) => (
        <Text key={item.key}>{t("run.bullet", { text: tr(t, item) })}</Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, gap: 12 },
  title: { fontSize: 24, fontWeight: "600" },
  summary: { fontSize: 20, fontWeight: "600" },
  section: { gap: 6 },
  heading: { fontSize: 16, fontWeight: "600", marginTop: 8 },
  name: { fontSize: 16, fontWeight: "600" },
  check: { gap: 2, paddingVertical: 4 },
});
