import { TouchableOpacity, Text, StyleSheet, View } from "react-native";
import { useTheme } from "../theme";

// variant: "primary" (nền terracotta) | "outline" (viền terracotta) | "ghost" (viền xám)
// danger: cùng hình dạng nhưng đổi màu sang c.danger (nút Xoá — her-53) để nhìn là biết hành động nặng
export default function AppButton({ children, onPress, variant = "primary", disabled, icon, style, danger = false }) {
  const { c } = useTheme();
  const isPrimary = variant === "primary";
  const isOutline = variant === "outline";
  const accent = danger ? c.danger : c.accent;

  const backgroundColor = disabled ? c.line : isPrimary ? (danger ? c.danger : c.primary) : "transparent";
  const borderColor = isOutline ? accent : c.line;
  const color = disabled ? c.inkSoft : isPrimary ? (danger ? "#fff" : c.primaryOn) : isOutline ? accent : danger ? c.danger : c.ink;

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.base,
        { backgroundColor, opacity: disabled ? 0.8 : 1 },
        !isPrimary && { borderWidth: 1.5, borderColor },
        style,
      ]}
    >
      <View style={styles.row}>
        {icon}
        <Text style={[styles.text, { color }]}>{children}</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: { paddingVertical: 13, paddingHorizontal: 18, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: 6 },
  text: { fontWeight: "700", fontSize: 13.5 },
});
