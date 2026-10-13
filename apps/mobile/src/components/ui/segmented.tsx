import { Pressable, Text, View } from "react-native";

import { useStyles, useTheme } from "../../theme/theme-provider";

export interface SegmentOption<Id extends string> {
  id: Id;
  label: string;
  testID?: string;
}

/** Two or three exclusive options; the selected one is marked by state, not by colour alone. */
export function Segmented<Id extends string>({
  options,
  value,
  onChange,
}: {
  options: SegmentOption<Id>[];
  value: Id;
  onChange: (id: Id) => void;
}) {
  const { colors } = useTheme();
  const styles = useStyles((th) => ({
    track: { flexDirection: "row", padding: 4, gap: 4, borderRadius: th.radius.segment },
    option: {
      flex: 1,
      minHeight: 40,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: th.radius.segment - 4,
      paddingHorizontal: th.space.sm,
    },
    label: { ...th.type.label, textAlign: "center" },
  }));
  return (
    <View style={[styles.track, { backgroundColor: colors.segmentTrack }]}>
      {options.map((option) => {
        const selected = option.id === value;
        return (
          <Pressable
            key={option.id}
            testID={option.testID}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => onChange(option.id)}
            style={[styles.option, selected && { backgroundColor: colors.segmentSelected }]}
          >
            <Text style={[styles.label, { color: selected ? colors.text : colors.textSubtle }]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
