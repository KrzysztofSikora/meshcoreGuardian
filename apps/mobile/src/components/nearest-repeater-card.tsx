import { cooldownRemaining } from "@guardian/domain";
import { Link, useRouter } from "expo-router";
import { useState } from "react";
import { Button, Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useStore } from "zustand";

import { runButton } from "../application/diagnostics/presenter";
import {
  nearestCard,
  type CandidateModel,
  type NearestText,
} from "../application/nodes/nearest-presenter";
import { container } from "../composition";
import { formatTime } from "./node-row";
import { tr } from "./translate";
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
 * The nearest contact repeater by last known path, then advertised distance (FR-21). Everything
 * here comes from the last contact sync; nothing says the repeater is in range or online (AC4).
 */
export function NearestRepeaterCard() {
  const { t } = useTranslation();
  const router = useRouter();
  const nodes = useStore(controller.store);
  const connection = useStore(session.store);
  const runState = useStore(runs.store);
  const [open, setOpen] = useState(false);
  const now = useNow(true, COUNTDOWN_TICK_MS);

  if (!nodes.loaded || nodes.storage !== "ok") return null;
  const card = nearestCard(nodes.nodes, nodes.origin, formatTime);

  if (card.kind === "empty") {
    return (
      <View style={styles.card} testID="nearest-card">
        <Text accessibilityRole="header" style={styles.heading}>
          {t("nearest.heading")}
        </Text>
        <Text>{tr(t, card.text)}</Text>
        <Text>{tr(t, card.syncHint)}</Text>
      </View>
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
    <View style={styles.card} testID="nearest-card">
      <Text accessibilityRole="header" style={styles.heading}>
        {t("nearest.heading")}
      </Text>
      <Candidate model={nearest} t={t} large />
      {card.asOf !== null && <Text>{tr(t, card.asOf)}</Text>}
      <Button
        title={t("diagnostic.run")}
        accessibilityLabel={t("nearest.runLabel", { name })}
        disabled={!button.enabled}
        onPress={() => {
          void runs.start(nearest.publicKey);
          router.push({ pathname: "/node/[id]", params: { id: nearest.publicKey } });
        }}
      />
      {button.reason !== null && <Text>{tr(t, button.reason)}</Text>}
      {card.others.length > 0 && (
        <View style={styles.others}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: open }}
            onPress={() => setOpen(!open)}
          >
            <Text style={styles.link}>
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
                <Pressable accessibilityRole="button" style={styles.other}>
                  <Candidate model={other} t={t} />
                </Pressable>
              </Link>
            ))}
        </View>
      )}
    </View>
  );
}

function Candidate({ model, t, large }: { model: CandidateModel; t: T; large?: boolean }) {
  return (
    <View style={styles.body}>
      <Text style={large ? styles.name : styles.otherName}>{tr(t, model.name)}</Text>
      <Text>{tr(t, model.path)}</Text>
      <Text>{nt(t, model.position)}</Text>
      {large && <Text>{tr(t, model.lastHeard)}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderColor: "#6b7280", borderRadius: 8, padding: 12, gap: 8 },
  heading: { fontSize: 16, fontWeight: "600" },
  body: { gap: 2 },
  name: { fontSize: 18, fontWeight: "600" },
  otherName: { fontSize: 16, fontWeight: "600" },
  others: { gap: 8 },
  other: { paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth },
  link: { fontSize: 16, textDecorationLine: "underline" },
});
