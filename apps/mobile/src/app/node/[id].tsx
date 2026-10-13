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
import { Text, TextInput, View } from "react-native";
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
  passwordErrorText,
  passwordStatusText,
  type PasswordProblem,
  reportedAsText,
  reportedNameText,
  roleText,
} from "../../application/nodes/presenter";
import { formatTime } from "../../components/node-row";
import { RunStatus } from "../../components/run-status";
import { tr } from "../../components/translate";
import { AppButton } from "../../components/ui/button";
import { Card, SectionHeading } from "../../components/ui/card";
import { Screen } from "../../components/ui/screen";
import { useNow } from "../../components/use-now";
import { container } from "../../composition";
import { useStyles, useTheme } from "../../theme/theme-provider";

const { nodes: controller, runs, session, passwords } = container;

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
    <Screen scroll>
      {node === undefined ? (
        state.loaded && <Muted>{t("nodes.notFound")}</Muted>
      ) : (
        <NodeDetails node={node} />
      )}
      <Muted>{t("node.placeholder")}</Muted>
    </Screen>
  );
}

function Muted({ children, mono = false }: { children: string; mono?: boolean }) {
  const { colors } = useTheme();
  const styles = useStyles((th) => ({
    body: { ...th.type.small },
    mono: { ...th.type.monoSmall },
  }));
  return <Text style={[mono ? styles.mono : styles.body, { color: colors.textMuted }]}>{children}</Text>;
}

function NodeDetails({ node }: { node: Node }) {
  const { t } = useTranslation();
  const [label, setLabel] = useState(node.userLabel ?? "");
  const [error, setError] = useState<string | null>(null);

  const name = nameText(node);
  const reported = reportedAsText(node);
  const reportedName = reportedNameText(node);
  const heard = lastHeardText(node, formatTime);
  const { colors } = useTheme();
  const styles = useNodeStyles();

  const report = (result: Awaited<ReturnType<typeof controller.setLabel>>) => {
    if (result.ok) return setError(null);
    setError(result.reason === "TOO_LONG" ? "nodes.labelTooLong" : "nodes.saveFailed");
  };

  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={[styles.heading, { color: colors.text }]}>
        {tr(t, name)}
      </Text>
      <Muted mono>{t("nodes.keyPrefix", { prefix: keyPrefix(node.publicKey) })}</Muted>
      <Muted>{t("nodes.role", { role: tr(t, roleText(effectiveRole(node))) })}</Muted>
      {reportedName !== null && <Muted>{tr(t, reportedName)}</Muted>}
      {reported !== null && <Muted>{tr(t, reported)}</Muted>}
      <Muted>{tr(t, heard)}</Muted>
      {!node.inContacts && <Muted>{t("nodes.notInContacts")}</Muted>}

      <RunPanel node={node} />

      <Card>
        <SectionHeading>{t("nodes.label")}</SectionHeading>
        <TextInput
          testID="label-input"
          accessibilityLabel={t("nodes.label")}
          style={[styles.input, { color: colors.text, borderColor: colors.borderStrong, backgroundColor: colors.ground }]}
          value={label}
          onChangeText={setLabel}
          autoCapitalize="none"
        />
        <Muted>{t("nodes.labelHelp")}</Muted>
        <AppButton
          title={t("nodes.saveLabel")}
          variant="secondary"
          onPress={() => void controller.setLabel(node.publicKey, label).then(report)}
        />
      </Card>

      <Card>
        <SectionHeading>{t("nodes.setRole")}</SectionHeading>
        <View style={styles.roles}>
          {NODE_ROLES.map((role) => (
            <AppButton
              key={role}
              title={tr(t, roleText(role))}
              variant={node.userRole === role ? "primary" : "secondary"}
              accessibilityState={{ selected: node.userRole === role }}
              onPress={() => void controller.setRole(node.publicKey, role).then(report)}
            />
          ))}
        </View>
        <AppButton
          title={t("nodes.useReportedRole")}
          variant="secondary"
          disabled={node.userRole === null}
          onPress={() => void controller.setRole(node.publicKey, null).then(report)}
        />
      </Card>

      {!isOnDashboard(node) && (
        <AppButton
          title={t("nodes.addToDashboard")}
          variant="secondary"
          onPress={() => void controller.pin(node.publicKey).then(report)}
        />
      )}
      <GuestPasswordCard publicKey={node.publicKey} />
      {error !== null && (
        <Text accessibilityRole="alert" style={[styles.body, { color: colors.danger }]}>
          {t(error === "nodes.labelTooLong" ? "nodes.labelTooLong" : "nodes.saveFailed")}
        </Text>
      )}
    </View>
  );
}

function GuestPasswordCard({ publicKey }: { publicKey: string }) {
  const { t } = useTranslation();
  const [input, setInput] = useState("");
  const [problem, setProblem] = useState<PasswordProblem | null>(null);
  const saved = useStore(passwords.store).saved[publicKey];
  const { colors } = useTheme();
  const styles = useNodeStyles();
  const status = passwordStatusText(saved);

  useEffect(() => {
    void passwords.load(publicKey);
  }, [publicKey]);

  const save = () =>
    void passwords.save(publicKey, input).then((result) => {
      if (result.ok) {
        setInput("");
        return setProblem(null);
      }
      setProblem(result.reason);
    });
  const remove = () =>
    void passwords.remove(publicKey).then((result) => setProblem(result.ok ? null : "REMOVE_FAILED"));

  return (
    <Card>
      <SectionHeading>{t("password.heading")}</SectionHeading>
      {status !== null && (
        <Text
          accessibilityRole={saved === "error" ? "alert" : undefined}
          style={[styles.body, { color: saved === "error" ? colors.danger : colors.text }]}
        >
          {tr(t, status)}
        </Text>
      )}
      <TextInput
        testID="password-input"
        accessibilityLabel={t("password.heading")}
        style={[styles.input, { color: colors.text, borderColor: colors.borderStrong, backgroundColor: colors.ground }]}
        value={input}
        onChangeText={setInput}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Muted>{t("password.help")}</Muted>
      <AppButton
        title={t("password.save")}
        variant="secondary"
        disabled={input === ""}
        onPress={save}
      />
      {saved === "yes" && <AppButton title={t("password.remove")} variant="secondary" onPress={remove} />}
      {problem !== null && (
        <Text accessibilityRole="alert" style={[styles.body, { color: colors.danger }]}>
          {tr(t, passwordErrorText(problem))}
        </Text>
      )}
    </Card>
  );
}

function RunPanel({ node }: { node: Node }) {
  const { t } = useTranslation();
  const connection = useStore(session.store);
  const state = useStore(runs.store);
  const latest = state.latest[node.publicKey];
  const now = useNow(true, COUNTDOWN_TICK_MS);
  const { colors } = useTheme();
  const styles = useNodeStyles();
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
    <Card>
      <SectionHeading>{t("diagnostic.heading")}</SectionHeading>
      <RunStatus status={statusOf(latest, now)} />
      {state.notice === node.publicKey ? (
        <View style={[styles.note, { backgroundColor: colors.note.bg, borderColor: colors.note.border }]}>
          <Text style={[styles.strong, { color: colors.note.fg }]}>{t("diagnostic.notice.title")}</Text>
          <Text style={[styles.body, { color: colors.note.fg }]}>{t("diagnostic.notice.body")}</Text>
          <AppButton title={t("diagnostic.run")} icon="play" fullWidth onPress={() => void runs.confirmNotice()} />
          <AppButton
            title={t("diagnostic.notice.notNow")}
            variant="secondary"
            fullWidth
            onPress={() => runs.dismissNotice()}
          />
        </View>
      ) : active !== null ? (
        <View style={styles.section}>
          <Text accessibilityLiveRegion="polite" style={[styles.body, { color: colors.text }]}>
            {tr(t, progressText(active))}
          </Text>
          <AppButton title={t("diagnostic.cancel")} variant="danger" fullWidth onPress={() => runs.cancel()} />
        </View>
      ) : (
        <AppButton
          title={t("diagnostic.run")}
          icon="play"
          fullWidth
          disabled={!button.enabled}
          onPress={() => void runs.start(node.publicKey)}
        />
      )}
      {active === null && button.reason !== null && <Muted>{tr(t, button.reason)}</Muted>}
      {refusal !== null && (
        <Text accessibilityRole="alert" style={[styles.body, { color: colors.danger }]}>
          {tr(t, refusal)}
        </Text>
      )}
      {active === null && latest !== undefined && details !== null && (
        <View style={styles.section}>
          <Text style={[styles.strong, { color: colors.text }]}>{tr(t, details.summary)}</Text>
          <Text style={[styles.body, { color: colors.text }]}>{tr(t, details.explanation)}</Text>
          {unsaved && <Muted>{t("diagnostic.notSaved")}</Muted>}
          {latest.id !== undefined && (
            <Link href={{ pathname: "/run/[id]", params: { id: String(latest.id) } }} asChild>
              <AppButton title={t("diagnostic.viewDetails")} variant="secondary" />
            </Link>
          )}
        </View>
      )}
    </Card>
  );
}

function useNodeStyles() {
  return useStyles((th) => ({
    section: { gap: th.space.sm },
    heading: { ...th.type.detailTitle },
    body: { ...th.type.body },
    strong: { ...th.type.bodyStrong },
    roles: { flexDirection: "row", flexWrap: "wrap", gap: th.space.sm },
    input: {
      borderWidth: 1,
      borderRadius: th.radius.button,
      paddingHorizontal: th.space.md,
      paddingVertical: th.space.sm,
      minHeight: 44,
      fontFamily: th.font.sans,
      fontSize: 16,
    },
    note: {
      borderWidth: 1,
      borderRadius: th.radius.button,
      padding: th.space.md,
      gap: th.space.sm,
    },
  }));
}
