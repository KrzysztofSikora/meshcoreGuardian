import { Link } from "expo-router";
import { Text } from "react-native";
import { useTranslation } from "react-i18next";
import { useStore } from "zustand";

import { ConnectionStatus } from "../components/connection-status";
import { PlaceholderScreen } from "../components/placeholder-screen";
import { container } from "../composition";

export default function DashboardScreen() {
  const { t } = useTranslation();
  const connection = useStore(container.session.store, (state) => state.connection);
  return (
    <PlaceholderScreen title={t("dashboard.title")} placeholder={t("dashboard.placeholder")}>
      <ConnectionStatus connection={connection} />
      <Link href="/connect">
        <Text accessibilityRole="link" style={{ fontSize: 16, textDecorationLine: "underline" }}>
          {t("dashboard.connect")}
        </Text>
      </Link>
    </PlaceholderScreen>
  );
}
