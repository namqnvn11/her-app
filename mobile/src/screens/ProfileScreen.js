import { useState, useEffect, useCallback } from "react";
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, KeyboardAvoidingView, Modal, Platform, ActivityIndicator } from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import Avatar from "../components/Avatar";
import { avatarUri } from "../utils/avatar";
import { Image } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import TopBar from "../components/TopBar";
import SectionLabel from "../components/SectionLabel";
import AppButton from "../components/AppButton";
import SettingsScreen from "./SettingsScreen";
import AutoScheduleScreen from "./AutoScheduleScreen";
import FormSheet from "../components/FormSheet";
import ProfileFields, { GENDER_LABEL, profileFromUser, profileToBody } from "../components/ProfileFields";
import { useAuth } from "../context/AuthContext";
import { api } from "../api/client";
import { packageLabel } from "../utils/formats";
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
  const insets = useSafeAreaInsets();
  const [name, setName] = useState(user?.name || "");
  const [profile, setProfile] = useState(profileFromUser(user)); // her-59
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  // Review her-34 #4: message dùng cho cả lỗi — lỗi phải ra màu đỏ, không phải xanh thành công
  const [messageErr, setMessageErr] = useState(false);
  const [editing, setEditing] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [autoOpen, setAutoOpen] = useState(false); // her-32: màn Lịch tự động (quầy)
  // Toàn bộ gói của khách (kể cả hết hạn) — mục "GÓI CỦA TÔI" theo bản thiết kế (mẫu 05)
  const [pkgs, setPkgs] = useState([]);
  const [pkgError, setPkgError] = useState("");
  // Admin kiêm HLV (mục 6, chốt 16/08): bật 1 lần → có hồ sơ HLV, khách đặt được
  // her-34: đã bật thì bấm vào dòng "Hồ sơ HLV" để SỬA lại tên hiển thị + chuyên môn
  const [trainerMode, setTrainerMode] = useState("create"); // "create" | "edit"
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
    setProfile(profileFromUser(user));
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

  // her-61 (04/09/2026): ảnh đại diện — chọn từ thư viện, cắt vuông, THU NHỎ NGAY TRÊN MÁY về 512px
  // (ảnh gốc 3–8 MB -> ~50–100 KB) rồi mới gửi; server ghi file, trả avatarUrl mới -> refreshMe.
  const [avatarBusy, setAvatarBusy] = useState(false);
  const notice = (text, isErr = false) => {
    setMessageErr(isErr);
    setMessage(text);
    setTimeout(() => setMessage(""), isErr ? 3500 : 2000);
  };
  const pickAvatar = async () => {
    if (avatarBusy) return;
    try {
      if (Platform.OS !== "web") {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) return notice("Chưa cho phép truy cập ảnh — bật quyền Ảnh cho HER trong Cài đặt điện thoại", true);
      }
      const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: true, aspect: [1, 1], quality: 1 });
      if (picked.canceled || !picked.assets?.[0]) return;
      setAvatarBusy(true);
      const out = await ImageManipulator.manipulateAsync(
        picked.assets[0].uri,
        [{ resize: { width: 512 } }],
        { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG }
      );
      let file;
      if (Platform.OS === "web") {
        const blob = await (await fetch(out.uri)).blob();
        file = new File([blob], "avatar.jpg", { type: "image/jpeg" });
      } else {
        file = { uri: out.uri, name: "avatar.jpg", type: "image/jpeg" };
      }
      await api.upload("/me/avatar", "avatar", file);
      await refreshMe();
      notice("Đã cập nhật ảnh đại diện");
    } catch (err) {
      notice(err.message, true);
    } finally {
      setAvatarBusy(false);
    }
  };
  // Góp ý 04/09: bấm ảnh -> chọn "Xem ảnh" / "Chọn ảnh mới" (không có Gỡ ảnh — muốn đổi thì chọn ảnh khác)
  const [avatarMenu, setAvatarMenu] = useState(false);
  const [viewingAvatar, setViewingAvatar] = useState(false);
  const onAvatarPress = () => {
    if (avatarBusy) return;
    if (user?.avatarUrl) setAvatarMenu(true);
    else pickAvatar();
  };

  const saveTrainerProfile = async () => {
    if (trainerBusy) return;
    if (!trainerForm.name.trim()) return setTrainerError("Nhập tên hiển thị của HLV");
    setTrainerError("");
    setTrainerBusy(true);
    try {
      const body = { name: trainerForm.name.trim(), specialties: trainerForm.specialties };
      if (trainerMode === "edit") await api.patch("/me/trainer-profile", body);
      else await api.post("/me/trainer-profile", body);
      await refreshMe(); // user.trainerId có ngay — nút tự đổi sang "đã bật"
      setTrainerSheet(false);
      setMessageErr(false);
      setMessage(trainerMode === "edit" ? "Đã cập nhật hồ sơ HLV" : "Đã mở hồ sơ HLV — bạn đã xuất hiện trong danh sách HLV");
      setTimeout(() => setMessage(""), 3500);
    } catch (err) {
      setTrainerError(err.message); // hiện trong sheet (L8)
    } finally {
      setTrainerBusy(false);
    }
  };

  // her-34: điền sẵn hồ sơ đang có rồi mở sheet ở chế độ sửa
  const openTrainerEdit = async () => {
    if (trainerBusy) return;
    setTrainerError("");
    setTrainerBusy(true);
    try {
      const r = await api.get("/me/trainer-profile");
      setTrainerForm({ name: r.trainer.name, specialties: r.trainer.specialties || [] });
      setTrainerMode("edit");
      setTrainerSheet(true);
    } catch (err) {
      setMessageErr(true);
      setMessage(err.message);
      setTimeout(() => setMessage(""), 3500);
    } finally {
      setTrainerBusy(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setMessage("");
    try {
      // her-59: mọi role tự sửa email/giới tính; khách thêm khẩn cấp/sức khỏe/mục tiêu
      await api.patch("/me", { name, ...profileToBody(profile, { full: isCustomer }) });
      await refreshMe();
      setMessageErr(false);
      setMessage("Đã lưu thay đổi");
      setEditing(false);
    } catch (err) {
      setMessageErr(true);
      setMessage(err.message);
    } finally {
      setSaving(false);
      setTimeout(() => setMessage(""), 2000);
    }
  };

  return (
    // Ô nhập nằm giữa trang → KAV đẩy nội dung lên khi bàn phím bật, cả 2 hệ (26/08)
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.bg }} behavior="padding">
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <TopBar title="Cá nhân" />

      <View style={{ paddingHorizontal: 22 }}>
        <View style={[styles.head, { borderBottomColor: c.line }]}>
          {/* her-61: bấm vòng tròn để chọn ảnh; đang gửi thì hiện vòng xoay */}
          <TouchableOpacity onPress={onAvatarPress} activeOpacity={0.7} disabled={avatarBusy} accessibilityLabel="Ảnh đại diện">
            <Avatar url={user?.avatarUrl} name={user?.name} size={64} initials="two" />
            <View style={[styles.camBadge, { backgroundColor: c.card, borderColor: c.line }]}>
              {avatarBusy ? <ActivityIndicator size="small" color={c.accent} /> : <Feather name="camera" size={12} color={c.accent} />}
            </View>
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
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
                    {/* her-35: bộ môn + loại hình — 2 gói mix khác nhau nhìn là biết */}
                    {!!packageLabel(p) && (
                      <Text style={[styles.pkgSub, { color: c.inkSoft }]}>{packageLabel(p)}</Text>
                    )}
                    <Text style={[styles.pkgSub, { color: c.inkSoft }]}>
                      {p.totalSessions == null ? "không giới hạn buổi" : `còn ${p.remainingSessions} buổi`}
                      {" · "}
                      {p.expiresAt ? `hết hạn ${fmtShortDate(p.expiresAt)}` : "không thời hạn"}
                    </Text>
                  </View>
                  <Text style={[styles.pkgStatus, { color: p.status === "active" ? c.accent : c.inkSoft }]}>
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
              style={[styles.underInput, { borderBottomColor: c.line, color: c.ink }]}
            />
            <ProfileFields value={profile} onChange={setProfile} full={isCustomer} inputStyle={[styles.underInput, { borderBottomColor: c.line, color: c.ink }]} labelStyle={{ marginTop: 14 }} />
            {!!message && <Text style={{ fontSize: 12, color: messageErr ? c.danger : c.inkSoft, marginTop: 10, marginBottom: 4 }}>{message}</Text>}
            <View style={{ height: 14 }} />
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
        {/* Góp ý 04/09: hiện ĐỦ thông tin cá nhân ngay ngoài màn (kể cả ô chưa khai — ghi "Chưa có") để tự xem,
            nhất là khách; nằm dưới Gói của tôi, ngay trên "Sửa thông tin". Ẩn khi đang ở form sửa (khỏi trùng). */}
        {!editing && (() => {
          const ec = user?.emergencyContact;
          const rows = [
            ["Email", user?.email],
            ["Giới tính", user?.gender ? GENDER_LABEL[user.gender] : null],
            ...(isCustomer
              ? [
                  ["Liên hệ khẩn cấp", ec?.phone ? `${ec.name ? ec.name + " · " : ""}${ec.phone}` : null],
                  ["Sức khỏe", user?.healthNotes],
                  ["Mục tiêu", user?.goals],
                ]
              : []),
          ];
          return (
            <>
              <SectionLabel>Thông tin cá nhân</SectionLabel>
              {rows.map(([label, value], i) => (
                <View key={label} style={[styles.infoRow, i !== rows.length - 1 && { borderBottomWidth: 1, borderBottomColor: c.hairline }]}>
                  <Text style={[styles.infoLabel, { color: c.inkSoft }]}>{label}</Text>
                  <Text style={[styles.infoValue, { color: value ? c.ink : c.inkSoft }]}>{value || "Chưa có"}</Text>
                </View>
              ))}
            </>
          );
        })()}

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
            {/* Admin kiêm HLV: bật 1 lần (không có đường gỡ — hỏi quầy/dev);
                đã bật thì bấm vào để sửa tên hiển thị + chuyên môn (her-34) */}
            {user?.role === "admin" &&
              (user?.trainerId ? (
                <TouchableOpacity onPress={openTrainerEdit} style={[styles.row, { borderBottomColor: c.hairline }]}>
                  <Text style={[styles.rowTitle, { color: c.ink }]}>Hồ sơ HLV</Text>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Text style={{ fontSize: 12, fontWeight: "800", color: c.success }}>Đã bật</Text>
                    <Feather name="chevron-right" size={16} color={c.inkSoft} />
                  </View>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  onPress={() => {
                    setTrainerForm({ name: user?.name || "", specialties: [] });
                    setTrainerError("");
                    setTrainerMode("create");
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
            {!!message && <Text style={{ fontSize: 12, color: messageErr ? c.danger : c.success, marginTop: 10 }}>{message}</Text>}
          </>
        )}

        {/* Đang sửa thông tin thì ẩn Đăng xuất — nằm sát nút Lưu, dễ bấm nhầm (góp ý 04/09) */}
        {!editing && (
          <AppButton
            style={{ marginTop: 22 }}
            onPress={logout}
            icon={<Feather name="log-out" size={14} color={c.primaryOn} style={{ marginRight: 2 }} />}
          >
            Đăng xuất
          </AppButton>
        )}
      </View>

      <FormSheet
        visible={trainerSheet}
        title={trainerMode === "edit" ? "Hồ sơ HLV" : "Mở hồ sơ HLV"}
        onClose={() => { if (!trainerBusy) setTrainerSheet(false); }}
      >
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
          {/* Review her-34 #3: key đã chọn nhưng không còn trong danh mục vẫn phải hiện chip
              (bỏ chọn được) — không thì form kẹt 400 mãi mà không thấy môn nào sai */}
          {[
            ...disciplineOpts,
            ...trainerForm.specialties
              .filter((k) => !disciplineOpts.some(([key]) => key === k))
              .map((k) => [k, k]),
          ].map(([key, label]) => {
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
                <Text style={{ fontSize: 12.5, fontWeight: "700", color: on ? c.accent : c.ink }}>{label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        {!!trainerError && <Text style={{ fontSize: 12.5, fontWeight: "700", marginTop: 14, color: c.danger }}>{trainerError}</Text>}
        <AppButton style={{ marginTop: 22 }} disabled={trainerBusy} onPress={saveTrainerProfile}>
          {trainerBusy ? "Đang lưu..." : trainerMode === "edit" ? "Lưu thay đổi" : "Mở hồ sơ HLV"}
        </AppButton>
      </FormSheet>

      {/* Ảnh đại diện: chọn xem / đổi */}
      <FormSheet visible={avatarMenu} title="Ảnh đại diện" onClose={() => setAvatarMenu(false)}>
        <AppButton variant="outline" style={{ marginTop: 14 }} onPress={() => { setAvatarMenu(false); setViewingAvatar(true); }}
          icon={<Feather name="eye" size={14} color={c.accent} style={{ marginRight: 2 }} />}>
          Xem ảnh
        </AppButton>
        <AppButton style={{ marginTop: 10 }} onPress={() => { setAvatarMenu(false); pickAvatar(); }}
          icon={<Feather name="camera" size={14} color={c.primaryOn} style={{ marginRight: 2 }} />}>
          Chọn ảnh mới
        </AppButton>
      </FormSheet>
      <Modal visible={viewingAvatar} transparent animationType="fade" onRequestClose={() => setViewingAvatar(false)}>
        <TouchableOpacity activeOpacity={1} onPress={() => setViewingAvatar(false)} style={styles.viewer}>
          <Image source={{ uri: avatarUri(user?.avatarUrl) }} style={styles.viewerImg} resizeMode="contain" />
          <Text style={styles.viewerHint}>Chạm để đóng</Text>
        </TouchableOpacity>
      </Modal>

      {/* Modal toàn màn nằm ngoài SafeAreaView → tự đệm đáy cho thanh điều hướng Android */}
      <Modal visible={settingsOpen} animationType="slide" onRequestClose={() => setSettingsOpen(false)}>
        <View style={{ flex: 1, backgroundColor: c.bg, paddingBottom: insets.bottom }}>
          <SettingsScreen onBack={() => setSettingsOpen(false)} />
        </View>
      </Modal>

      <Modal visible={autoOpen} animationType="slide" onRequestClose={() => setAutoOpen(false)}>
        <View style={{ flex: 1, backgroundColor: c.bg, paddingBottom: insets.bottom }}>
          <AutoScheduleScreen onBack={() => setAutoOpen(false)} />
        </View>
      </Modal>
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: 14, paddingBottom: 18, borderBottomWidth: 1, marginTop: 6 },
  viewer: { flex: 1, backgroundColor: "rgba(0,0,0,0.92)", alignItems: "center", justifyContent: "center" },
  viewerImg: { width: "100%", aspectRatio: 1, maxHeight: "80%" },
  viewerHint: { color: "#fff", opacity: 0.7, fontSize: 12.5, marginTop: 16 },
  camBadge: { position: "absolute", right: -2, bottom: -2, width: 24, height: 24, borderRadius: 12, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  name: { fontSize: 16, fontWeight: "800" },
  sub: { fontSize: 12, marginTop: 2 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 14, borderBottomWidth: 1 },
  rowTitle: { fontSize: 13, fontWeight: "700" },
  pkgRow: { flexDirection: "row", alignItems: "center", paddingVertical: 13, borderBottomWidth: 1 },
  infoRow: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingVertical: 10 },
  infoLabel: { fontSize: 12, fontWeight: "700", width: 118 },
  infoValue: { fontSize: 13, flex: 1, lineHeight: 18 },
  pkgSub: { fontSize: 11.5, marginTop: 2 },
  pkgStatus: { fontSize: 12, fontWeight: "800" },
  input: { borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, marginTop: 6, marginBottom: 12 },
  underInput: { borderBottomWidth: 1.5, paddingVertical: 8, fontSize: 15, marginTop: 2 },
});
