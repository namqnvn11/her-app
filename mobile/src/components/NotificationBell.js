import { TouchableOpacity, View, Text, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useTheme } from "../theme";

// her-57: chuông thông báo + chấm số chưa đọc. Dùng trên header Tổng quan của admin (nền sáng)
// và lễ tân/HLV (nền màu) — màu icon tự theo nền qua prop `light`.
export default function NotificationBell({ unread = 0, onPress, light = false }) {
  const { c } = useTheme();
  const color = light ? c.primaryOn : c.accent;
  return (
    <TouchableOpacity onPress={onPress} hitSlop={10} activeOpacity={0.7} style={styles.wrap}>
      <Feather name="bell" size={20} color={color} />
      {unread > 0 && (
        <View style={[styles.badge, { backgroundColor: c.danger }]}>
          <Text style={styles.badgeText}>{unread > 99 ? "99+" : unread}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 4 },
  badge: {
    position: "absolute",
    top: -2,
    right: -6,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { color: "#fff", fontSize: 10.5, fontWeight: "800" },
});
