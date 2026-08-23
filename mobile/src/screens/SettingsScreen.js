import { useState, useEffect, useRef } from "react";
import { View, Text, ScrollView, TextInput, TouchableOpacity, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import TopBar from "../components/TopBar";
import SectionLabel from "../components/SectionLabel";
import Toggle from "../components/Toggle";
import AppButton from "../components/AppButton";
import FormSheet from "../components/FormSheet";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { remindersEnabled, setRemindersEnabled, syncReminders, notificationsPermitted } from "../utils/reminders";
import { useTheme } from "../theme";

// Không có mục "Chế độ tối" — quyết định 16/08/2026: app chỉ dùng giao diện sáng.
export default function SettingsScreen({ onBack }) {
  const { c } = useTheme();
  const { user, config, login, updateConfig } = useAuth();
  const minPw = config?.minPasswordLength ?? 6; // 1 nguồn từ server (C5)
  // Mục 9: công tắc nhắc-1-tiếng nối thật với bộ đặt thông báo trên máy.
  // Tắt = huỷ ngay mọi nhắc đã đặt; bật lại thì lần tải lịch kế tiếp sẽ tự đặt lại.
  const [remindClass, setRemindClass] = useState(true);
  useEffect(() => {
    remindersEnabled().then(setRemindClass);
  }, []);
  const [permWarn, setPermWarn] = useState(false);
  const toggleRemind = async (on) => {
    setRemindClass(on);
    await setRemindersEnabled(on);
    if (on) {
      // BẬT là đặt lại NGAY theo lịch hiện tại — không chờ lần tải lịch kế (review her-16 B4)
      try {
        if (user?.role === "customer") {
          const res = await api.get("/me/bookings");
          syncReminders(res.bookings.filter((b) => b.status === "booked"));
        } else if (user?.role === "trainer") {
          const res = await api.get("/management/bookings", { range: "upcoming", page: 1 });
          syncReminders(res.bookings.filter((b) => b.status === "booked"));
        } else if (user?.role === "admin" && user?.trainerId) {
          // her-31: admin kiêm HLV — nhắc đúng buổi CỦA MÌNH (mine=1)
          const res = await api.get("/management/bookings", { range: "upcoming", page: 1, mine: 1 });
          syncReminders(res.bookings.filter((b) => b.status === "booked"));
        }
      } catch (err) {
        console.warn("[reminders] không tải được lịch để đặt nhắc:", err?.message);
      }
      setPermWarn(!(await notificationsPermitted())); // máy chặn quyền -> nói thẳng (B8)
    } else {
      setPermWarn(false);
    }
  };
  // Nhắc gói sắp hết hạn: server-push, làm ở bước deploy — công tắc giữ chỗ
  const [remindPackage, setRemindPackage] = useState(true);

  // her-47: admin tự chỉnh số giờ tối thiểu để khách tự hủy — 1 nguồn ở server (C5), app chỉ hiện.
  // Giá trị hiện hành lấy từ config (login//me); lưu xong cập nhật config để tab Lịch dùng số mới ngay.
  const isAdmin = user?.role === "admin";
  const [cancelHours, setCancelHours] = useState(config?.minCancelHours != null ? String(config.minCancelHours) : "");
  const [cancelError, setCancelError] = useState("");
  const [cancelDone, setCancelDone] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  useEffect(() => {
    if (config?.minCancelHours != null) setCancelHours(String(config.minCancelHours));
  }, [config?.minCancelHours]);
  const cancelDirty = isAdmin && cancelHours !== "" && Number(cancelHours) !== config?.minCancelHours;

  const saveCancelHours = async () => {
    if (cancelBusy) return;
    setCancelError("");
    setCancelDone(false);
    setCancelBusy(true);
    try {
      // Gửi số (server kiểm tra nguyên 0..72 và trả lý do nếu sai — hiện nguyên câu đó, L8)
      const res = await api.patch("/settings", { minCancelHours: Number(cancelHours) });
      updateConfig({ minCancelHours: res.minCancelHours });
      setCancelDone(true);
      clearTimeout(cancelTimer.current);
      cancelTimer.current = setTimeout(() => setCancelDone(false), 3000);
    } catch (err) {
      setCancelError(err.message);
    } finally {
      setCancelBusy(false);
    }
  };
  const cancelTimer = useRef(null);
  useEffect(() => () => clearTimeout(cancelTimer.current), []);

  // Mục 10 (her-14): tự đổi mật khẩu — sheet 3 ô, lỗi hiện TRONG sheet (L8)
  const [pwOpen, setPwOpen] = useState(false);
  const [pwForm, setPwForm] = useState({ current: "", next: "", confirm: "" });
  const [pwError, setPwError] = useState("");
  const [pwDone, setPwDone] = useState("");
  const [pwBusy, setPwBusy] = useState(false);

  const openPw = () => {
    setPwForm({ current: "", next: "", confirm: "" });
    setPwError("");
    setPwOpen(true);
  };

  const changePassword = async () => {
    if (pwBusy) return;
    if (!pwForm.current) return setPwError("Nhập mật khẩu hiện tại");
    if ((pwForm.next || "").length < minPw) return setPwError(`Mật khẩu mới tối thiểu ${minPw} ký tự`);
    if (pwForm.next !== pwForm.confirm) return setPwError("Nhập lại mật khẩu mới chưa khớp");
    setPwError("");
    setPwBusy(true);
    try {
      await api.post("/me/change-password", { currentPassword: pwForm.current, newPassword: pwForm.next });
      // Server đá mọi phiên cũ sau khi đổi (chống kịch bản mất máy) — đăng nhập lại ÊM ngay
      // bằng mật khẩu mới để phiên này không bị gián đoạn
      if (user?.phone) await login(user.phone, pwForm.next);
      setPwOpen(false);
      setPwDone("Đã đổi mật khẩu — các thiết bị khác sẽ phải đăng nhập lại");
      clearTimeout(doneTimer.current);
      doneTimer.current = setTimeout(() => setPwDone(""), 4000);
    } catch (err) {
      setPwError(err.message); // server nói rõ lý do (sai mật khẩu hiện tại...) — hiện trong sheet
    } finally {
      setPwBusy(false);
    }
  };

  // Không setState sau khi unmount (review A5)
  const doneTimer = useRef(null);
  useEffect(() => () => clearTimeout(doneTimer.current), []);

  const pwInput = [styles.input, { borderBottomColor: c.line, color: c.ink }];

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentContainerStyle={{ paddingBottom: 40 }}>
      <TopBar title="Cài đặt" onBack={onBack} />

      <View style={{ paddingHorizontal: 22 }}>
        <SectionLabel>Thông báo</SectionLabel>
        <Row c={c} title="Nhắc trước giờ tập 1 tiếng" sub="Nhắc trên máy này theo lịch đã tải trong app">
          <Toggle value={remindClass} onChange={toggleRemind} />
        </Row>
        {permWarn && (
          <Text style={{ fontSize: 11.5, lineHeight: 17, marginTop: 6, color: c.danger }}>
            Điện thoại đang CHẶN thông báo của app — vào Cài đặt của máy → Thông báo để cấp quyền, không thì sẽ không nhắc được.
          </Text>
        )}
        <Row c={c} title="Nhắc gói sắp hết hạn">
          <Toggle value={remindPackage} onChange={setRemindPackage} />
        </Row>

        {isAdmin && (
          <>
            <SectionLabel>Hủy lịch</SectionLabel>
            <View style={[styles.row, { borderBottomColor: c.hairline }]}>
              <Text style={[styles.rowTitle, { color: c.ink, flex: 1, paddingRight: 12 }]}>
                Khách tự hủy trước giờ tập tối thiểu
              </Text>
              <TextInput
                value={cancelHours}
                onChangeText={(v) => { setCancelHours(v.replace(/[^0-9]/g, "")); setCancelError(""); }}
                keyboardType="number-pad"
                maxLength={2}
                onBlur={() => { if (cancelHours === "" && config?.minCancelHours != null) setCancelHours(String(config.minCancelHours)); }}
                style={[styles.hoursInput, { borderColor: c.line, color: c.ink }]}
              />
              <Text style={[styles.rowTitle, { color: c.ink, marginLeft: 6 }]}>tiếng</Text>
            </View>
            {!!cancelError && <Text style={{ fontSize: 12, fontWeight: "700", marginTop: 8, color: c.danger }}>{cancelError}</Text>}
            {cancelDone && <Text style={{ fontSize: 12, marginTop: 8, color: c.success }}>Đã lưu</Text>}
            {cancelDirty && (
              <AppButton style={{ marginTop: 12 }} disabled={cancelBusy} onPress={saveCancelHours}>
                {cancelBusy ? "Đang lưu..." : "Lưu"}
              </AppButton>
            )}
          </>
        )}

        <SectionLabel>Bảo mật</SectionLabel>
        <TouchableOpacity onPress={openPw} style={[styles.row, { borderBottomColor: c.hairline }]}>
          <Text style={[styles.rowTitle, { color: c.ink }]}>Đổi mật khẩu</Text>
          <Feather name="chevron-right" size={16} color={c.inkSoft} />
        </TouchableOpacity>
        {!!pwDone && <Text style={{ fontSize: 12, marginTop: 10, color: c.success }}>{pwDone}</Text>}
      </View>

      <FormSheet visible={pwOpen} title="Đổi mật khẩu" onClose={() => { if (!pwBusy) setPwOpen(false); }}>
        <SectionLabel style={{ marginTop: 12 }}>Mật khẩu hiện tại</SectionLabel>
        <TextInput
          value={pwForm.current}
          onChangeText={(v) => setPwForm((f) => ({ ...f, current: v }))}
          secureTextEntry
          autoCapitalize="none"
          style={pwInput}
        />
        <SectionLabel style={{ marginTop: 12 }}>{`Mật khẩu mới (tối thiểu ${minPw} ký tự)`}</SectionLabel>
        <TextInput
          value={pwForm.next}
          onChangeText={(v) => setPwForm((f) => ({ ...f, next: v }))}
          secureTextEntry
          autoCapitalize="none"
          style={pwInput}
        />
        <SectionLabel style={{ marginTop: 12 }}>Nhập lại mật khẩu mới</SectionLabel>
        <TextInput
          value={pwForm.confirm}
          onChangeText={(v) => setPwForm((f) => ({ ...f, confirm: v }))}
          secureTextEntry
          autoCapitalize="none"
          style={pwInput}
        />
        {!!pwError && <Text style={{ fontSize: 12.5, fontWeight: "700", marginTop: 14, color: c.danger }}>{pwError}</Text>}
        <AppButton style={{ marginTop: 22 }} disabled={pwBusy} onPress={changePassword}>
          {pwBusy ? "Đang đổi..." : "Đổi mật khẩu"}
        </AppButton>
      </FormSheet>
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
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 15,
    borderBottomWidth: 1,
  },
  rowTitle: { fontSize: 13.5, fontWeight: "700" },
  rowSub: { fontSize: 11.5, marginTop: 2 },
  input: { borderBottomWidth: 1.5, paddingVertical: 8, fontSize: 15, marginTop: 2 },
  hoursInput: { borderWidth: 1, borderRadius: 8, width: 52, paddingVertical: 6, fontSize: 15, fontWeight: "700", textAlign: "center" },
});
