import { View, Text, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../theme";

// Khối header terracotta: dòng nhỏ + tiêu đề + hàng số liệu ({ value, label })
export default function HeaderBlock({ eyebrow, title, stats = [], progress }) {
  const insets = useSafeAreaInsets();
  const { c } = useTheme();
  return (
    <View style={[styles.wrap, { backgroundColor: c.primary, paddingTop: 14 + insets.top }]}>
      {!!eyebrow && <Text style={styles.eyebrow}>{eyebrow}</Text>}
      <Text style={styles.title}>{title}</Text>
      {stats.length > 0 && (
        <View style={styles.stats}>
          {stats.map((s) => (
            <View key={s.label}>
              <Text style={styles.statValue}>{s.value}</Text>
              <Text style={styles.statLabel}>{s.label}</Text>
            </View>
          ))}
        </View>
      )}
      {typeof progress === "number" && (
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${Math.min(Math.max(progress, 0), 1) * 100}%` }]} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 22, paddingBottom: 18 },
  eyebrow: { color: "#F0D8CE", fontSize: 12, fontWeight: "500" },
  title: { color: "#fff", fontSize: 21, fontWeight: "800", marginTop: 2 },
  stats: { flexDirection: "row", gap: 22, marginTop: 16 },
  statValue: { color: "#fff", fontSize: 24, fontWeight: "800" },
  statLabel: { color: "#F0D8CE", fontSize: 10.5, fontWeight: "500" },
  track: { height: 5, borderRadius: 99, backgroundColor: "rgba(255,255,255,0.28)", marginTop: 16 },
  fill: { height: 5, borderRadius: 99, backgroundColor: "#fff" },
});
