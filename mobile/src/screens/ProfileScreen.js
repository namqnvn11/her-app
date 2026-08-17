import { useState, useEffect, useCallback } from "react";
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Modal } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import TopBar from "../components/TopBar";
import SectionLabel from "../components/SectionLabel";
import AppButton from "../components/AppButton";
import SettingsScreen from "./SettingsScreen";
import AutoScheduleScreen from "./AutoScheduleScreen";
import FormSheet from "../components/FormSheet";
import { useAuth } from "../context/AuthContext";
import { api } from "../api/client";
import { useTheme } from "../theme";

const ROLE_LABEL = { admin: "Admin", reception: "Lễ tân", trainer: "Huấn luyện viên", customer: "Khách hàng" };
const PKG_STATUS = { active: "Đang dùng", paused: "Bảo lưu", used_up: "Hết buổi", expired: "Đã hết" };

function fmtShortDate(d) {
  const date = new Date(d);
  return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export default function ProfileScreen() {
  const { user, logout, refreshMe } = useAuth();
  const { c } = useTheme();
  const [name, setName] = useState(user?.name || "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [autoOpen, setAutoOpen] = useState(false); // her-32: màn Lịch tự động (quầy)
  // Toàn bộ gói của khách (kể cả hết hạn) — mục "GÓI CỦA TÔI" theo bản thiết kế (mẫu 05)
  const [pkgs, setPkgs] = useState([]);
  const [pkgError, setPkgError] = useState("");
  // Admin kiêm HLV (mục 6, chốt 16/08): bật 1 lần → có hồ sơ HLV, khách đặt được
  const [trainerSheet, setTrainerSheet] = useState(false);
  const [trainerForm, setTrainerForm] = useState({ name: "", specialties: [] });
  const [disciplineOpts, setDisciplineOpts] = useState([]);
  useEffect(() => {
    if (user?.role !== "admin") return;
    api.get("/disciplines")
      .then((r) => setDisciplineOpts(r.disciplines.map((d) => [d.key, d.label])))
      .catch(() => {});
  }, [user?.role]);
  const [trainerError, setTrainerError] = useState("");
  const [trainerBusy, setTrainerBusy] = useState(false);

  useEffect(() => {
    setName(user?.name || "");
  }, [user]);

  const isCustomer = user?.role === "customer";
  useFocusEffect(
    useCallback(() => {
      if (!isCustomer) return;
      let alive = true;
      setPkgError("");
      api.get("/me/packages")
        .then((res) => { if (alive) setPkgs(res.packages); })
        .catch((err) => { if (alive) setPkgError(err.message); });
      return () => { alive = false; };
    }, [isCustomer])
  );

  const initials = (user?.name || "??")
    .split(" ")
    .slice(-2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

  const openTrainerProfile = async () => {
    if (trainerBusy) return;
    if (!trainerForm.name.trim()) return setTrainerError("Nhập tên hiển thị của HLV");
    setTrainerError("");
    setTrainerBusy(true);
    try {
      await api.post("/me/trainer-profile", {
        name: trainerForm.name.trim(),
        specialties: trainerForm.specialties,
      });
      await refreshMe(); // user.trainerId có ngay — nút tự đổi sang "đã bật"
      setTrainerSheet(false);
      setMessage("Đã mở hồ sơ HLV — bạn đã xuất hiện trong danh sách HLV");
      setTimeout(() => setMessage(""), 3500);
    } catch (err) {
      setTrainerError(err.message); // hiện trong sheet (L8)
    } finally {
      setTrainerBusy(false);
    }
  };

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

        {isCustomer && (
          <>
            <SectionLabel>Gói của tôi</SectionLabel>
            {!!pkgError && <Text style={{ fontSize: 12, color: c.danger, marginTop: 8 }}>{pkgError}</Text>}
            {!pkgError &&
              pkgs.map((p, i) => (
                <View
                  key={p.id}
                  style={[styles.pkgRow, i !== pkgs.length - 1 && { borderBottomWidth: 1, borderBottomColor: c.hairline }]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.rowTitle, { color: p.status === "active" ? c.ink : c.inkSoft }]}>{p.name}</Text>
                    <Text style={[styles.pkgSub, { color: c.inkSoft }]}>
                      {p.totalSessions == null ? "không giới hạn buổi" : `còn ${p.remainingSessions} buổi`}
                      {" · "}
                      {p.expiresAt ? `hết hạn ${fmtShortDate(p.expiresAt)}` : "không thời hạn"}
                    </Text>
                  </View>
                  <Text style={[styles.pkgStatus, { color: p.status === "active" ? c.primary : c.inkSoft }]}>
                    {PKG_STATUS[p.status] || p.status}
                  </Text>
                </View>
              ))}
            {!pkgError && pkgs.length === 0 && (
              <Text style={{ fontSize: 12.5, color: c.inkSoft, marginTop: 8 }}>
                Chưa có gói nào — liên hệ quầy lễ tân để mua gói.
              </Text>
            )}
          </>
        )}

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
            {/* her-32: quầy đặt luật lịch tự động — lớp tự sinh sẵn 7 ngày cho khách đăng ký */}
            {(user?.role === "admin" || user?.role === "reception") && (
              <TouchableOpacity onPress={() => setAutoOpen(true)} style={[styles.row, { borderBottomColor: c.hairline }]}>
                <Text style={[styles.rowTitle, { color: c.ink }]}>Lịch tự động</Text>
                <Feather name="chevron-right" size={16} color={c.inkSoft} />
              </TouchableOpacity>
            )}
            {/* Admin kiêm HLV: bật 1 lần; đã bật thì hiện trạng thái (không có đường gỡ — hỏi quầy/dev) */}
            {user?.role === "admin" &&
              (user?.trainerId ? (
                <View style={[styles.row, { borderBottomColor: c.hairline }]}>
                  <Text style={[styles.rowTitle, { color: c.ink }]}>Hồ sơ HLV</Text>
                  <Text style={{ fontSize: 12, fontWeight: "800", color: c.success }}>Đã bật</Text>
                </View>
              ) : (
                <TouchableOpacity
                  onPress={() => {
                    setTrainerForm({ name: user?.name || "", specialties: [] });
                    setTrainerError("");
                    setTrainerSheet(true);
                  }}
                  style={[styles.row, { borderBottomColor: c.hairline }]}
                >
                  <View>
                    <Text style={[styles.rowTitle, { color: c.ink }]}>Mở hồ sơ HLV</Text>
                    <Text style={{ fontSize: 11.5, marginTop: 2, color: c.inkSoft }}>
                      Chủ phòng tập kiêm HLV — khách sẽ thấy và đặt lịch với bạn
                    </Text>
                  </View>
                  <Feather name="chevron-right" size={16} color={c.inkSoft} />
                </TouchableOpacity>
              ))}
            {/* Thông báo "Đã lưu thay đổi" hiện sau khi form đóng — không thì lưu xong im lặng */}
            {!!message && <Text style={{ fontSize: 12, color: c.success, marginTop: 10 }}>{message}</Text>}
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

      <FormSheet visible={trainerSheet} title="Mở hồ sơ HLV" onClose={() => { if (!trainerBusy) setTrainerSheet(false); }}>
        <SectionLabel style={{ marginTop: 12 }}>Tên hiển thị</SectionLabel>
        <TextInput
          value={trainerForm.name}
          onChangeText={(v) => setTrainerForm((f) => ({ ...f, name: v }))}
          placeholder="VD: HLV Hạnh"
          placeholderTextColor={c.inkSoft}
          style={[styles.underInput, { borderBottomColor: c.line, color: c.ink }]}
        />
        <SectionLabel style={{ marginTop: 12 }}>Chuyên môn (chọn từ danh mục)</SectionLabel>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
          {disciplineOpts.map(([key, label]) => {
            const on = trainerForm.specialties.includes(key);
            return (
              <TouchableOpacity
                key={key}
                onPress={() => setTrainerForm((f) => ({
                  ...f,
                  specialties: on ? f.specialties.filter((k) => k !== key) : [...f.specialties, key],
                }))}
                style={{
                  paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1.5,
                  borderColor: on ? c.primaryTint : c.line,
                  backgroundColor: on ? c.primaryTint : "transparent",
                }}
              >
                <Text style={{ fontSize: 12.5, fontWeight: "700", color: on ? c.primary : c.ink }}>{label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        {!!trainerError && <Text style={{ fontSize: 12.5, fontWeight: "700", marginTop: 14, color: c.danger }}>{trainerError}</Text>}
        <AppButton style={{ marginTop: 22 }} disabled={trainerBusy} onPress={openTrainerProfile}>
          {trainerBusy ? "Đang mở..." : "Mở hồ sơ HLV"}
        </AppButton>
      </FormSheet>

      <Modal visible={settingsOpen} animationType="slide" onRequestClose={() => setSettingsOpen(false)}>
        <View style={{ flex: 1, backgroundColor: c.bg }}>
          <SettingsScreen onBack={() => setSettingsOpen(false)} />
        </View>
      </Modal>

      <Modal visible={autoOpen} animationType="slide" onRequestClose={() => setAutoOpen(false)}>
        <View style={{ flex: 1, backgroundColor: c.bg }}>
          <AutoScheduleScreen onBack={() => setAutoOpen(false)} />
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
  pkgRow: { flexDirection: "row", alignItems: "center", paddingVertical: 13, borderBottomWidth: 1 },
  pkgSub: { fontSize: 11.5, marginTop: 2 },
  pkgStatus: { fontSize: 12, fontWeight: "800" },
  input: { borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, marginTop: 6, marginBottom: 12 },
  underInput: { borderBottomWidth: 1.5, paddingVertical: 8, fontSize: 15, marginTop: 2 },
});
