import { useTranslation } from "react-i18next";

import { PlaceholderScreen } from "../components/placeholder-screen";

export default function DashboardScreen() {
  const { t } = useTranslation();
  return (
    <PlaceholderScreen title={t("dashboard.title")} placeholder={t("dashboard.placeholder")} />
  );
}
