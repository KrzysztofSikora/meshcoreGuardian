import { Text } from "react-native";
import { useTranslation } from "react-i18next";

import { PlaceholderScreen } from "../components/placeholder-screen";
import { container } from "../composition";

export default function SettingsScreen() {
  const { t } = useTranslation();
  const mode = t(`transport.${container.mode}`);
  return (
    <PlaceholderScreen title={t("settings.title")} placeholder={t("settings.placeholder")}>
      <Text>{t("settings.transport", { mode })}</Text>
    </PlaceholderScreen>
  );
}
