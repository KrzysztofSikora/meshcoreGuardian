import { useTranslation } from "react-i18next";

import { PlaceholderScreen } from "../../components/placeholder-screen";

export default function RunScreen() {
  const { t } = useTranslation();
  return <PlaceholderScreen title={t("run.title")} placeholder={t("run.placeholder")} />;
}
