import { useTranslation } from "react-i18next";

import { PlaceholderScreen } from "../../components/placeholder-screen";

export default function NodeScreen() {
  const { t } = useTranslation();
  return <PlaceholderScreen title={t("node.title")} placeholder={t("node.placeholder")} />;
}
