import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../theme";
import HeaderBell from "./HeaderBell";

// onBack (tuỳ chọn): nút quay lại nằm NGAY TRONG TopBar, thẳng hàng với title —
// mọi màn dùng chung 1 kiểu, không màn nào tự chế mũi tên riêng nữa (góp ý 17/08)
// right (tuỳ chọn, her-46): điều khiển nằm cuối hàng tiêu đề, vd nút chọn tháng của báo cáo
// bell (04/09): chuông thông báo là MỘT PHẦN header ở mọi màn chính (admin/lễ tân/HLV — khách tự ẩn).
// Mặc định bật ở màn KHÔNG có nút quay lại (tab chính); màn con/modal (có onBack) mặc định tắt.
export default function TopBar({ title, sub, onBack, right, bell = !onBack }) {
  // Cộng inset trên để tiêu đề không bị status bar / tai thỏ đè lên (headerShown: false)
  const insets = useSafeAreaInsets();
  const { c } = useTheme();
  return (
    <View style={[styles.wrap, { paddingTop: 14 + insets.top }]}>
      <View style={styles.titleRow}>
        {!!onBack && (
          <TouchableOpacity onPress={onBack} hitSlop={10}>
            <Feather name="chevron-left" size={22} color={c.accent} />
          </TouchableOpacity>
        )}
        <Text style={[styles.title, { color: c.ink }]} numberOfLines={1}>{title}</Text>
        {(bell || !!right) && (
          <View style={styles.right}>
            {!!right && right}
            {bell && <HeaderBell />}
          </View>
        )}
      </View>
      {!!sub && <Text style={[styles.sub, { color: c.inkSoft }, !!onBack && styles.subIndent]}>{sub}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 22, paddingBottom: 10 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontSize: 20, fontWeight: "800", flexShrink: 1 },
  right: { marginLeft: "auto", paddingLeft: 10, flexDirection: "row", alignItems: "center", gap: 10 },
  sub: { fontSize: 11.5, marginTop: 3 },
  subIndent: { marginLeft: 30 }, // thụt cùng title khi có nút quay lại (22 icon + 8 gap)
});
