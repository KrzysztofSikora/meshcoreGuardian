import { Text } from "react-native";
import { useTranslation } from "react-i18next";

import { privacyBlocks } from "../application/about/privacy";
import { tr } from "../components/translate";
import { Screen } from "../components/ui/screen";
import { useStyles, useTheme } from "../theme/theme-provider";

const blocks = privacyBlocks();

export default function PrivacyScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useStyles((th) => ({
    heading: { ...th.type.bodyStrong, marginTop: th.space.md },
    body: { ...th.type.body },
  }));
  return (
    <Screen scroll>
      <Text accessibilityRole="header" style={[styles.heading, { color: colors.text }]}>
        {t("privacy.title")}
      </Text>
      {blocks.map((block) =>
        block.kind === "heading" ? (
          <Text key={block.text.key} accessibilityRole="header" style={[styles.heading, { color: colors.text }]}>
            {tr(t, block.text)}
          </Text>
        ) : (
          <Text key={block.text.key} style={[styles.body, { color: colors.text }]}>
            {tr(t, block.text)}
          </Text>
        ),
      )}
    </Screen>
  );
}
