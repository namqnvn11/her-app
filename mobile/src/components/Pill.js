import { View, Text, StyleSheet } from "react-native";
import { COLORS } from "../theme";

// tone: "taupe" (be nhạt, mặc định) | "brass" (đen nổi bật) | "danger" (viền đen, cảnh báo)
export default function Pill({ children, tone = "taupe" }) {
  let bg = COLORS.beige;
  let fg = COLORS.ink;
  let borderColor = "transparent";

  if (tone === "brass") {
    bg = COLORS.ink;
    fg = "#FFFFFF";
  } else if (tone === "danger") {
    bg = COLORS.card;
    fg = COLORS.ink;
    borderColor = COLORS.ink;
  }

  return (
    <View style={[styles.pill, { backgroundColor: bg, borderColor, borderWidth: borderColor === "transparent" ? 0 : 1.2 }]}>
      <Text style={[styles.text, { color: fg }]}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999, alignSelf: "flex-start" },
  text: { fontSize: 11, fontWeight: "700", letterSpacing: 0.3 },
});
