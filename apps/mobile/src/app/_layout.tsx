import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { I18nextProvider, useTranslation } from "react-i18next";

import { i18n } from "../i18n";
import { ThemeProvider, useTheme } from "../theme/theme-provider";

function Navigator() {
  const { t } = useTranslation();
  const { scheme, colors, font } = useTheme();
  return (
    <>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      <Stack
        screenOptions={{
          contentStyle: { backgroundColor: colors.ground },
          headerStyle: { backgroundColor: colors.ground },
          headerTintColor: colors.text,
          headerTitleStyle: { fontFamily: font.sans, fontWeight: "600" },
          headerShadowVisible: false,
        }}
      >
        <Stack.Screen name="index" options={{ title: t("dashboard.title"), headerShown: false }} />
        <Stack.Screen name="connect" options={{ title: t("connect.title"), headerShown: false }} />
        <Stack.Screen name="node/[id]" options={{ title: t("node.title") }} />
        <Stack.Screen name="run/[id]" options={{ title: t("run.title") }} />
        <Stack.Screen name="debug/scenario/[name]" options={{ headerShown: false }} />
        <Stack.Screen name="debug/theme/[scheme]" options={{ headerShown: false }} />
        <Stack.Screen name="settings" options={{ title: t("settings.title"), headerShown: false }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <I18nextProvider i18n={i18n}>
      <ThemeProvider>
        <Navigator />
      </ThemeProvider>
    </I18nextProvider>
  );
}
