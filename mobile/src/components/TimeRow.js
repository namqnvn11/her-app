import { View, Text, StyleSheet } from "react-native";
import { useTheme } from "../theme";

// Dòng danh sách kiểu mới: cột giờ bên trái + nội dung + phần thao tác bên phải.
// children hiện dưới nội dung (nút, chip tên khách, dòng nhắc...).
export default function TimeRow({ time, sub, title, meta, right, children, last }) {
  const { c } = useTheme();
  return (
    <View style={[styles.wrap, !last && { borderBottomWidth: 1, borderBottomColor: c.hairline }]}>
      <View style={styles.row}>
        <View style={styles.timeCol}>
          <Text style={[styles.time, { color: c.accent }]}>{time}</Text>
          {!!sub && <Text numberOfLines={1} style={[styles.sub, { color: c.inkSoft }]}>{sub}</Text>}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: c.ink }]}>{title}</Text>
          {!!meta && <Text style={[styles.meta, { color: c.inkSoft }]}>{meta}</Text>}
        </View>
        {right}
      </View>
      {!!children && <View style={styles.children}>{children}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingVertical: 14 },
  row: { flexDirection: "row", gap: 14, alignItems: "center" },
  timeCol: { width: 58 },
  time: { fontSize: 13, fontWeight: "800" },
  sub: { fontSize: 10.5, fontWeight: "500", marginTop: 1 },
  title: { fontSize: 13.5, fontWeight: "700" },
  meta: { fontSize: 11.5, marginTop: 2 },
  children: { marginTop: 10, marginLeft: 72 },
});
