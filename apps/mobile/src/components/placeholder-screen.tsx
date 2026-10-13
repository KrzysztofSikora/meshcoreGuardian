import type { ReactNode } from "react";
import { Text } from "react-native";

import { useStyles, useTheme } from "../theme/theme-provider";
import type { NavTab } from "./ui/bottom-nav";
import { Screen } from "./ui/screen";

type Props = {
  title: string;
  placeholder: string;
  nav: NavTab;
  children?: ReactNode;
};

/** Heading plus one line of text; real screens replace it slice by slice. */
export function PlaceholderScreen({ title, placeholder, nav, children }: Props) {
  const { colors } = useTheme();
  const styles = useStyles((th) => ({ body: { ...th.type.body } }));
  return (
    <Screen title={title} nav={nav}>
      <Text style={[styles.body, { color: colors.text }]}>{placeholder}</Text>
      {children}
    </Screen>
  );
}
