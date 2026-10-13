import { cooldownRemaining } from "@guardian/domain";
import { Link, useIsFocused, useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useStore } from "zustand";

import { runButton } from "../application/diagnostics/presenter";
import {
  nearestCard,
  type CandidateModel,
  type NearestText,
} from "../application/nodes/nearest-presenter";
import { container } from "../composition";
import { useStyles, useTheme } from "../theme/theme-provider";
import { formatTime } from "./node-row";
import { tr } from "./translate";
import { Icon } from "./ui/icons";
import { AppButton } from "./ui/button";
import { Card } from "./ui/card";
import { useNow } from "./use-now";

const { nodes: controller, session, runs } = container;

/** The cooldown countdown under the button ticks like the one on the node screen. */
const COUNTDOWN_TICK_MS = 1000;

type T = ReturnType<typeof useTranslation>["t"];

/** Resolves a nested compass `Text` before the outer line is interpolated. */
function nt(t: T, text: NearestText): string {
  const params: Record<string, string | number> = {};
  for (const [name, value] of Object.entries(text.params ?? {})) {
    params[name] = typeof value === "object" ? tr(t, value) : value;
  }
  return tr(t, { key: text.key, params });
}

/**
 * The nearest contact repeater or room server by last known path, then advertised distance (FR-21). Everything
 * here comes from the last contact sync; nothing says the node is in range or online (AC4).
 */
export function NearestRepeaterCard() {
  const { t } = useTranslation();
  const router = useRouter();
  const nodes = useStore(controller.store);
  const connection = useStore(session.store);
  const runState = useStore(runs.store);
  const [open, setOpen] = useState(false);
  const { colors } = useTheme();
  const styles = useCardStyles();
  const heading = (
    <View style={styles.headingRow}>
      <Icon name="compass" size={15} color={colors.accent} />
      <Text accessibilityRole="header" style={[styles.heading, { color: colors.accent }]}>
        {t("nearest.heading")}
      </Text>
    </View>
  );
  const now = useNow(useIsFocused(), COUNTDOWN_TICK_MS);

  if (!nodes.loaded || nodes.storage !== "ok") return null;
  const card = nearestCard(nodes.nodes, nodes.origin, formatTime);

  if (card.kind === "empty") {
    return (
      <Card variant="accent" testID="nearest-card">
        {heading}
        <Text style={[styles.text, { color: colors.text }]}>{tr(t, card.text)}</Text>
        <Text style={[styles.text, { color: colors.textMuted }]}>{tr(t, card.syncHint)}</Text>
      </Card>
    );
  }

  const nearest = card.nearest;
  const node = nodes.nodes.find((n) => n.publicKey === nearest.publicKey);
  const button = runButton({
    connected: connection.connection.kind === "connected",
    capabilities: connection.capabilities,
    running: runState.active !== null,
    inContacts: node?.inContacts ?? false,
    cooldownMs: cooldownRemaining(runState.latest[nearest.publicKey] ?? null, now),
  });
  const name = tr(t, nearest.name);

  return (
    <Card variant="accent" testID="nearest-card">
      {heading}
      <Link href={{ pathname: "/node/[id]", params: { id: nearest.publicKey } }} asChild>
        <Pressable accessibilityRole="button">
          <Candidate model={nearest} t={t} large />
        </Pressable>
      </Link>
      {card.asOf !== null && <Text style={[styles.small, { color: colors.textMuted }]}>{tr(t, card.asOf)}</Text>}
      <AppButton
        title={t("diagnostic.run")}
        icon="play"
        fullWidth
        accessibilityLabel={t("nearest.runLabel", { name })}
        disabled={!button.enabled}
        onPress={() => {
          void runs.start(nearest.publicKey);
          router.push({ pathname: "/node/[id]", params: { id: nearest.publicKey } });
        }}
      />
      {button.reason !== null && <Text style={[styles.small, { color: colors.textMuted }]}>{tr(t, button.reason)}</Text>}
      {card.others.length > 0 && (
        <View style={styles.others}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: open }}
            onPress={() => setOpen(!open)}
          >
            <Text style={[styles.link, { color: colors.accent }]}>
              {t(open ? "nearest.otherHide" : "nearest.otherShow", { count: card.others.length })}
            </Text>
          </Pressable>
          {open &&
            card.others.map((other) => (
              <Link
                key={other.publicKey}
                href={{ pathname: "/node/[id]", params: { id: other.publicKey } }}
                asChild
              >
                <Pressable accessibilityRole="button" style={[styles.other, { borderTopColor: colors.divider }]}>
                  <Candidate model={other} t={t} />
                </Pressable>
              </Link>
            ))}
        </View>
      )}
    </Card>
  );
}

function Candidate({ model, t, large }: { model: CandidateModel; t: T; large?: boolean }) {
  const { colors } = useTheme();
  const styles = useCardStyles();
  const muted = [styles.small, { color: colors.textMuted }];
  return (
    <View style={styles.body}>
      <Text style={[large ? styles.name : styles.otherName, { color: colors.text }]}>{tr(t, model.name)}</Text>
      <Text style={muted}>{tr(t, model.role)}</Text>
      <Text style={muted}>{tr(t, model.path)}</Text>
      <Text style={muted}>{nt(t, model.position)}</Text>
      {large && <Text style={muted}>{tr(t, model.lastHeard)}</Text>}
    </View>
  );
}

function useCardStyles() {
  return useStyles((th) => ({
    headingRow: { flexDirection: "row", alignItems: "center", gap: th.space.sm },
    heading: { ...th.type.section },
    text: { ...th.type.body },
    small: { ...th.type.small },
    body: { gap: 2 },
    name: { ...th.type.name, fontSize: 18 },
    otherName: { ...th.type.bodyStrong },
    others: { gap: th.space.sm },
    other: { paddingVertical: th.space.sm, borderTopWidth: 1 },
    link: { ...th.type.bodyStrong },
  }));
}
