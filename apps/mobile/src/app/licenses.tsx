import { useState } from "react";
import { FlatList, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { licenseRows, type LicenseRow, type Notice } from "../application/about/licenses-presenter";
import { tr } from "../components/translate";
import { AppButton } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Screen } from "../components/ui/screen";
import notices from "../licenses/notices.json";
import { useStyles, useTheme } from "../theme/theme-provider";

const rows = licenseRows(notices as Notice[]);

export default function LicensesScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useStyles((th) => ({
    list: { flex: 1 },
    content: { gap: th.space.md, paddingBottom: 24 },
    intro: { ...th.type.body },
  }));
  return (
    <Screen>
      <FlatList
        style={styles.list}
        contentContainerStyle={styles.content}
        data={rows}
        keyExtractor={(row) => row.id}
        renderItem={({ item }) => <LicenseItem row={item} />}
        ListHeaderComponent={
          <Text style={[styles.intro, { color: colors.textMuted }]}>{t("licenses.intro")}</Text>
        }
      />
    </Screen>
  );
}

function LicenseItem({ row }: { row: LicenseRow }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const styles = useStyles((th) => ({
    body: { gap: th.space.sm },
    name: { ...th.type.bodyStrong },
    small: { ...th.type.small },
    notice: { ...th.type.monoSmall },
  }));
  return (
    <Card>
      <View style={styles.body}>
        <Text style={[styles.name, { color: colors.text }]}>{row.name}</Text>
        <Text style={[styles.small, { color: colors.textMuted }]}>
          {t("licenses.summary", { version: row.version, id: row.license })}
        </Text>
        {row.text === null ? (
          row.missing !== null && (
            <Text style={[styles.small, { color: colors.textMuted }]}>{tr(t, row.missing)}</Text>
          )
        ) : (
          <>
            <AppButton
              testID={`licenses-toggle-${row.id}`}
              title={t(open ? "licenses.hide" : "licenses.show", { name: row.name })}
              variant="secondary"
              onPress={() => setOpen(!open)}
              accessibilityState={{ expanded: open }}
            />
            {open && (
              <Text selectable style={[styles.notice, { color: colors.text }]}>
                {row.text}
              </Text>
            )}
          </>
        )}
      </View>
    </Card>
  );
}
