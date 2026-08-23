import { View, Text, StyleSheet } from "react-native";
import { useTheme } from "../theme";

// tone: "tint" (nền terracotta nhạt, mặc định) | "solid" (nền terracotta) | "outline" (viền cảnh báo)
// Nhận cả tên tone cũ để màn chưa đổi hết không vỡ: taupe -> tint, brass -> solid, danger -> outline
const LEGACY_TONES = { taupe: "tint", brass: "solid", danger: "outline" };

export default function Pill({ children, tone = "tint" }) {
  const { c } = useTheme();
  const resolved = LEGACY_TONES[tone] || tone;
  let bg = c.primaryTint;
  let fg = c.accent;
  let borderColor = "transparent";

  if (resolved === "solid") {
    bg = c.accent;
    fg = c.primaryOn;
  } else if (resolved === "outline") {
    bg = "transparent";
    fg = c.accent;
    borderColor = c.accent;
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
