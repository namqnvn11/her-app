import { useState, useEffect } from "react";
import { View, Text, TextInput, StyleSheet, ScrollView } from "react-native";
import { Feather } from "@expo/vector-icons";
import TopBar from "../components/TopBar";
import AppButton from "../components/AppButton";
import { useAuth } from "../context/AuthContext";
import { api } from "../api/client";
import { COLORS } from "../theme";

export default function ProfileScreen() {
  const { user, logout, refreshMe } = useAuth();
  const [name, setName] = useState(user?.name || "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

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
    } catch (err) {
      setMessage(err.message);
    } finally {
      setSaving(false);
      setTimeout(() => setMessage(""), 2000);
    }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.bg }} contentContainerStyle={{ paddingBottom: 40 }}>
      <TopBar
        title="Tài khoản"
        sub={
          { admin: "Admin", reception: "Lễ tân", trainer: "Huấn luyện viên", customer: "Khách hàng" }[user?.role] ||
          "Khách hàng"
        }
      />

      <View style={{ alignItems: "center", marginBottom: 20 }}>
        <View>
          <View style={styles.avatar}>
            <Text style={{ fontSize: 28, fontWeight: "800", color: COLORS.ink }}>{initials}</Text>
          </View>
          <View style={styles.cameraBadge}>
            <Feather name="camera" size={13} color="#fff" />
          </View>
        </View>
      </View>

      <View style={styles.card}>
        <View>
          <Text style={styles.label}>Họ và tên</Text>
          <TextInput value={name} onChangeText={setName} style={styles.input} />
        </View>
        <View>
          <Text style={styles.label}>Số điện thoại</Text>
          <TextInput value={user?.phone || ""} editable={false} style={[styles.input, { color: COLORS.inkSoft }]} />
        </View>
        {!!message && <Text style={{ fontSize: 12, color: COLORS.inkSoft }}>{message}</Text>}
        <AppButton onPress={save} disabled={saving}>{saving ? "Đang lưu..." : "Lưu thay đổi"}</AppButton>
      </View>

      <View style={{ marginHorizontal: 20, marginTop: 18 }}>
        <AppButton
          variant="outline"
          onPress={logout}
          icon={<Feather name="log-out" size={14} color={COLORS.ink} style={{ marginRight: 2 }} />}
        >
          Đăng xuất
        </AppButton>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  avatar: { width: 84, height: 84, borderRadius: 42, backgroundColor: COLORS.beige, alignItems: "center", justifyContent: "center" },
  cameraBadge: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.ink,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: COLORS.bg,
  },
  card: { marginHorizontal: 20, backgroundColor: COLORS.card, borderRadius: 16, padding: 16, gap: 14 },
  label: { fontSize: 11.5, color: COLORS.inkSoft, fontWeight: "700", marginBottom: 5 },
  input: {
    borderWidth: 1.5,
    borderColor: COLORS.line,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13.5,
    color: COLORS.ink,
  },
});
