import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { I18nextProvider, useTranslation } from "react-i18next";

import { i18n } from "../i18n";

function Navigator() {
  const { t } = useTranslation();
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: t("dashboard.title") }} />
      <Stack.Screen name="connect" options={{ title: t("connect.title") }} />
      <Stack.Screen name="node/[id]" options={{ title: t("node.title") }} />
      <Stack.Screen name="run/[id]" options={{ title: t("run.title") }} />
      <Stack.Screen name="settings" options={{ title: t("settings.title") }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <I18nextProvider i18n={i18n}>
      <StatusBar style="auto" />
      <Navigator />
    </I18nextProvider>
  );
}
