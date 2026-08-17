import { useState } from "react";
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import TopBar from "../components/TopBar";
import SectionLabel from "../components/SectionLabel";
import Toggle from "../components/Toggle";
import { useTheme } from "../theme";

export default function SettingsScreen({ onBack, onChangePassword }) {
  const { c, mode, isDark, setMode } = useTheme();
  // Nhắc lịch/nhắc gói: bật/tắt tại máy, sẽ nối với push notification ở đợt 6
  const [remindClass, setRemindClass] = useState(true);
  const [remindPackage, setRemindPackage] = useState(true);

  const followSystem = mode === "system";

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentContainerStyle={{ paddingBottom: 40 }}>
      <View style={styles.head}>
        {!!onBack && (
          <TouchableOpacity onPress={onBack} hitSlop={10}>
            <Feather name="chevron-left" size={22} color={c.primary} />
          </TouchableOpacity>
        )}
        <TopBar title="Cài đặt" />
      </View>

      <View style={{ paddingHorizontal: 22 }}>
        <SectionLabel>Giao diện</SectionLabel>
        <Row c={c} title="Chế độ tối" sub="Dịu mắt khi tập buổi tối">
          <Toggle
            value={isDark}
            disabled={followSystem}
            onChange={(v) => setMode(v ? "dark" : "light")}
          />
        </Row>
        <Row c={c} title="Theo hệ thống" sub="Tự đổi theo cài đặt điện thoại">
          <Toggle value={followSystem} onChange={(v) => setMode(v ? "system" : isDark ? "dark" : "light")} />
        </Row>

        <SectionLabel>Thông báo</SectionLabel>
        <Row c={c} title="Nhắc trước giờ tập 1 tiếng">
          <Toggle value={remindClass} onChange={setRemindClass} />
        </Row>
        <Row c={c} title="Nhắc gói sắp hết hạn">
          <Toggle value={remindPackage} onChange={setRemindPackage} />
        </Row>

        <SectionLabel>Bảo mật</SectionLabel>
        <TouchableOpacity onPress={onChangePassword} style={[styles.row, { borderBottomColor: c.hairline }]}>
          <Text style={[styles.rowTitle, { color: c.ink }]}>Đổi mật khẩu</Text>
          <Feather name="chevron-right" size={16} color={c.inkSoft} />
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

function Row({ c, title, sub, children }) {
  return (
    <View style={[styles.row, { borderBottomColor: c.hairline }]}>
      <View style={{ flex: 1, paddingRight: 12 }}>
        <Text style={[styles.rowTitle, { color: c.ink }]}>{title}</Text>
        {!!sub && <Text style={[styles.rowSub, { color: c.inkSoft }]}>{sub}</Text>}
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "flex-end", paddingLeft: 14 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 15,
    borderBottomWidth: 1,
  },
  rowTitle: { fontSize: 13.5, fontWeight: "700" },
  rowSub: { fontSize: 11.5, marginTop: 2 },
});
