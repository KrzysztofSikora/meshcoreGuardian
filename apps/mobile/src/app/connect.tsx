import { useTranslation } from "react-i18next";

import { PlaceholderScreen } from "../components/placeholder-screen";

export default function ConnectScreen() {
  const { t } = useTranslation();
  return <PlaceholderScreen title={t("connect.title")} placeholder={t("connect.placeholder")} />;
}
