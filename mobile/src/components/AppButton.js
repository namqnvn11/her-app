import { TouchableOpacity, Text, StyleSheet, View } from "react-native";
import { COLORS } from "../theme";

export default function AppButton({ children, onPress, variant = "primary", disabled, icon, style }) {
  const isPrimary = variant === "primary";
  const isOutline = variant === "outline";

  const backgroundColor = disabled
    ? COLORS.line
    : isPrimary
    ? COLORS.ink
    : isOutline
    ? "transparent"
    : COLORS.beige;

  const color = isPrimary ? "#fff" : COLORS.ink;

  return (
    <TouchableOpacity
      activeOpacity={0.8}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.base,
        { backgroundColor, opacity: disabled ? 0.7 : 1 },
        isOutline && { borderWidth: 1.5, borderColor: COLORS.ink },
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
  base: { paddingVertical: 12, paddingHorizontal: 16, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: 6 },
  text: { fontWeight: "700", fontSize: 13.5 },
});
