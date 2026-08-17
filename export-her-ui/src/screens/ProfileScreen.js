import { useState, useEffect } from "react";
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Modal } from "react-native";
import { Feather } from "@expo/vector-icons";
import TopBar from "../components/TopBar";
import SectionLabel from "../components/SectionLabel";
import AppButton from "../components/AppButton";
import SettingsScreen from "./SettingsScreen";
import { useAuth } from "../context/AuthContext";
import { api } from "../api/client";
import { useTheme } from "../theme";

const ROLE_LABEL = { admin: "Admin", reception: "Lễ tân", trainer: "Huấn luyện viên", customer: "Khách hàng" };

export default function ProfileScreen() {
  const { user, logout, refreshMe } = useAuth();
  const { c } = useTheme();
  const [name, setName] = useState(user?.name || "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    setName(user?.name || "");
  }, [user]);

  const initials = (user?.name || "??")
    .split(" ")
    .slice(-2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

  const save = async () => {
    setSaving(true);
    setMessage("");
    try {
      await api.patch("/me", { name });
      await refreshMe();
      setMessage("Đã lưu thay đổi");
      setEditing(false);
    } catch (err) {
      setMessage(err.message);
    } finally {
      setSaving(false);
      setTimeout(() => setMessage(""), 2000);
    }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentContainerStyle={{ paddingBottom: 40 }}>
      <TopBar title="Cá nhân" />

      <View style={{ paddingHorizontal: 22 }}>
        <View style={[styles.head, { borderBottomColor: c.line }]}>
          <View style={[styles.avatar, { backgroundColor: c.primaryTint }]}>
            <Text style={[styles.avatarText, { color: c.primary }]}>{initials}</Text>
          </View>
          <View>
            <Text style={[styles.name, { color: c.ink }]}>{user?.name}</Text>
            <Text style={[styles.sub, { color: c.inkSoft }]}>
              {ROLE_LABEL[user?.role] || "Khách hàng"} · {user?.phone}
            </Text>
          </View>
        </View>

        {editing ? (
          <View style={{ marginTop: 18 }}>
            <SectionLabel>Họ và tên</SectionLabel>
            <TextInput
              value={name}
              onChangeText={setName}
              style={[styles.input, { borderColor: c.line, color: c.ink, backgroundColor: c.card }]}
            />
            {!!message && <Text style={{ fontSize: 12, color: c.inkSoft, marginBottom: 10 }}>{message}</Text>}
            <View style={{ flexDirection: "row", gap: 8 }}>
              <View style={{ flex: 1 }}>
                <AppButton variant="ghost" onPress={() => setEditing(false)}>
                  Hủy
                </AppButton>
              </View>
              <View style={{ flex: 1 }}>
                <AppButton disabled={saving} onPress={save}>
                  {saving ? "Đang lưu..." : "Lưu"}
                </AppButton>
              </View>
            </View>
          </View>
        ) : (
          <>
            <SectionLabel>Tài khoản</SectionLabel>
            <TouchableOpacity onPress={() => setEditing(true)} style={[styles.row, { borderBottomColor: c.hairline }]}>
              <Text style={[styles.rowTitle, { color: c.ink }]}>Sửa thông tin</Text>
              <Feather name="chevron-right" size={16} color={c.inkSoft} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setSettingsOpen(true)} style={[styles.row, { borderBottomColor: c.hairline }]}>
              <Text style={[styles.rowTitle, { color: c.ink }]}>Cài đặt</Text>
              <Feather name="chevron-right" size={16} color={c.inkSoft} />
            </TouchableOpacity>
          </>
        )}

        <AppButton
          style={{ marginTop: 22 }}
          onPress={logout}
          icon={<Feather name="log-out" size={14} color="#fff" style={{ marginRight: 2 }} />}
        >
          Đăng xuất
        </AppButton>
      </View>

      <Modal visible={settingsOpen} animationType="slide" onRequestClose={() => setSettingsOpen(false)}>
        <View style={{ flex: 1, backgroundColor: c.bg }}>
          <SettingsScreen onBack={() => setSettingsOpen(false)} />
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: 14, paddingBottom: 18, borderBottomWidth: 1, marginTop: 6 },
  avatar: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 22, fontWeight: "800" },
  name: { fontSize: 16, fontWeight: "800" },
  sub: { fontSize: 12, marginTop: 2 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 14, borderBottomWidth: 1 },
  rowTitle: { fontSize: 13, fontWeight: "700" },
  input: { borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, marginTop: 6, marginBottom: 12 },
});
