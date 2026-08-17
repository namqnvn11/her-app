import { View, Text, StyleSheet } from "react-native";
import { useTheme } from "../theme";

// tone: "tint" (nền terracotta nhạt, mặc định) | "solid" (nền terracotta) | "outline" (viền cảnh báo)
export default function Pill({ children, tone = "tint" }) {
  const { c } = useTheme();
  let bg = c.primaryTint;
  let fg = c.primary;
  let borderColor = "transparent";

  if (tone === "solid") {
    bg = c.primary;
    fg = c.primaryOn;
  } else if (tone === "outline") {
    bg = "transparent";
    fg = c.primary;
    borderColor = c.primary;
  }

  return (
    <View
      style={[
        styles.pill,
        { backgroundColor: bg, borderColor, borderWidth: borderColor === "transparent" ? 0 : 1.2 },
      ]}
    >
      <Text style={[styles.text, { color: fg }]}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, alignSelf: "flex-start" },
  text: { fontSize: 11, fontWeight: "700", letterSpacing: 0.3 },
});
