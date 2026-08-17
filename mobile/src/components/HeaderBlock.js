import { View, Text, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme, COLORS } from "../theme";

// Khối header terracotta: dòng nhỏ + tiêu đề + hàng số liệu ({ value, label })
// footnote: dòng chữ nhỏ dưới cùng (vd "Pilates 24 buổi · đã dùng 11/24")
export default function HeaderBlock({ eyebrow, title, stats = [], progress, footnote }) {
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
      {!!footnote && <Text style={styles.footnote}>{footnote}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 22, paddingBottom: 18 },
  eyebrow: { color: COLORS.primaryOnSoft, fontSize: 12, fontWeight: "500" },
  title: { color: COLORS.primaryOn, fontSize: 21, fontWeight: "800", marginTop: 2 },
  stats: { flexDirection: "row", gap: 22, marginTop: 16 },
  statValue: { color: COLORS.primaryOn, fontSize: 24, fontWeight: "800" },
  statLabel: { color: COLORS.primaryOnSoft, fontSize: 10.5, fontWeight: "500" },
  track: { height: 5, borderRadius: 99, backgroundColor: "rgba(255,255,255,0.28)", marginTop: 16 },
  fill: { height: 5, borderRadius: 99, backgroundColor: "#fff" },
  footnote: { color: COLORS.primaryOnSoft, fontSize: 11.5, fontWeight: "500", marginTop: 10 },
});
