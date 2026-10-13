import { Text } from "react-native";
import { useTranslation } from "react-i18next";

import { PlaceholderScreen } from "../components/placeholder-screen";
import { container } from "../composition";
import { useTheme } from "../theme/theme-provider";

export default function SettingsScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const mode = t(`transport.${container.mode}`);
  return (
    <PlaceholderScreen title={t("settings.title")} placeholder={t("settings.placeholder")} nav="settings">
      <Text style={{ color: colors.textMuted }}>{t("settings.transport", { mode })}</Text>
    </PlaceholderScreen>
  );
}
