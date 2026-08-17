import { TouchableOpacity, View, StyleSheet } from "react-native";
import { useTheme } from "../theme";

export default function Toggle({ value, onChange, disabled }) {
  const { c, isDark } = useTheme();
  return (
    <TouchableOpacity
      activeOpacity={0.85}
      disabled={disabled}
      onPress={() => onChange(!value)}
      style={[
        styles.track,
        {
          backgroundColor: value ? c.primary : isDark ? "#3A332C" : "#DDD3C1",
          justifyContent: value ? "flex-end" : "flex-start",
          opacity: disabled ? 0.5 : 1,
        },
      ]}
    >
      <View style={[styles.knob, { backgroundColor: value || !isDark ? "#fff" : c.inkSoft }]} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  track: { width: 48, height: 28, borderRadius: 999, padding: 3, flexDirection: "row" },
  knob: { width: 22, height: 22, borderRadius: 11 },
});
