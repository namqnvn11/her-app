import { useState, useCallback, useRef } from "react";
import { View, Text, ScrollView, TextInput, TouchableOpacity, StyleSheet, RefreshControl } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import TopBar from "../components/TopBar";
import Pill from "../components/Pill";
import AppButton from "../components/AppButton";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { COLORS } from "../theme";

// Vai trò mà mỗi tầng được phép tạo — khớp với backend (ALLOWED_TO_MANAGE)
// Admin quản lý được mọi loại tài khoản, gồm cả học viên (quyết định 07/08/2026, L4)
const MANAGEABLE_ROLES = {
  admin: [
    { key: "reception", label: "Lễ tân" },
    { key: "trainer", label: "Nhân viên" },
    { key: "customer", label: "Học viên" },
  ],
  reception: [
    { key: "customer", label: "Học viên" },
  ],
};

const ROLE_LABEL = { admin: "Admin", reception: "Lễ tân", trainer: "Nhân viên", customer: "Học viên" };

export default function AccountsScreen() {
  const { user } = useAuth();
  const options = MANAGEABLE_ROLES[user?.role] || [];
  const [role, setRole] = useState(options[0]?.key || "customer");
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  // toast: { msg, isError } — lỗi hiện icon/màu riêng, không giống thông báo thành công
  const [toast, setToast] = useState(null);

  // Không điền sẵn mật khẩu mặc định — người tạo phải tự đặt (tối thiểu 6 ký tự)
  const [form, setForm] = useState({ name: "", phone: "", password: "", specialty: "" });
  const [busy, setBusy] = useState(false); // chặn bấm đúp tạo/khoá tài khoản

  const load = useCallback(async (r = role) => {
    setLoading(true); // để RefreshControl hiện spinner đúng lúc kéo làm mới
    try {
      setErrorMsg("");
      const res = await api.get("/accounts", { role: r });
      setAccounts(res.accounts);
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  }, [role]);

  useFocusEffect(
    useCallback(() => {
      load(role);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [role])
  );

  // Clear timer cũ để toast lỗi không bị toast trước đó "giết non" giữa chừng
  const toastTimer = useRef(null);
  const flash = (msg, isError = false) => {
    clearTimeout(toastTimer.current);
    setToast({ msg, isError });
    toastTimer.current = setTimeout(() => setToast(null), isError ? 3500 : 2200);
  };

  const changeRole = (r) => {
    setRole(r);
    setLoading(true);
  };

  const create = async () => {
    if (busy) return;
    if (!form.name.trim() || !form.phone.trim()) {
      flash("Vui lòng nhập tên và số điện thoại", true);
      return;
    }
    if (!/^0\d{9}$/.test(form.phone.trim())) {
      flash("Số điện thoại không hợp lệ (10 chữ số, bắt đầu bằng 0)", true);
      return;
    }
    if ((form.password || "").length < 6) {
      flash("Mật khẩu tối thiểu 6 ký tự", true);
      return;
    }
    setBusy(true);
    try {
      await api.post("/accounts", {
        name: form.name.trim(),
        phone: form.phone.trim(),
        password: form.password,
        role,
        specialty: role === "trainer" ? form.specialty : undefined,
      });
      flash(`Đã tạo tài khoản ${ROLE_LABEL[role]}`);
      setForm({ name: "", phone: "", password: "", specialty: "" });
      load(role);
    } catch (err) {
      flash(err.message, true);
    } finally {
      setBusy(false);
    }
  };

  // Không còn chức năng xoá tài khoản (quyết định 07/08/2026, L5) — chỉ khoá/mở khoá,
  // dữ liệu lịch sử giữ nguyên. Khoá tài khoản HLV sẽ ẩn HLV đó khỏi danh sách đặt lịch.
  const toggleActive = async (acc) => {
    if (busy) return;
    setBusy(true);
    try {
      await api.patch(`/accounts/${acc.id}`, { isActive: !acc.isActive });
      load(role);
    } catch (err) {
      flash(err.message, true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <TopBar
        title="Quản trị tài khoản"
        sub={user?.role === "admin" ? "Tạo & quản lý tài khoản lễ tân, nhân viên, học viên" : "Tạo & quản lý tài khoản học viên"}
      />

      <View style={styles.tabs}>
        {options.map((o) => (
          <TouchableOpacity
            key={o.key}
            onPress={() => changeRole(o.key)}
            style={[styles.tabBtn, role === o.key && styles.tabBtnActive]}
          >
            <Text style={[styles.tabLabel, role === o.key && { color: COLORS.ink }]}>{o.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {!!errorMsg && <Text style={styles.errorText}>{errorMsg}</Text>}

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 100, gap: 10 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => load(role)} tintColor={COLORS.ink} />}
      >
        <View style={styles.formCard}>
          <Text style={styles.formTitle}>Tạo tài khoản {ROLE_LABEL[role]} mới</Text>
          <Text style={styles.label}>Họ và tên</Text>
          <TextInput value={form.name} onChangeText={(v) => setForm((f) => ({ ...f, name: v }))} style={styles.input} />
          <Text style={styles.label}>Số điện thoại</Text>
          <TextInput
            value={form.phone}
            onChangeText={(v) => setForm((f) => ({ ...f, phone: v }))}
            keyboardType="phone-pad"
            style={styles.input}
          />
          {role === "trainer" && (
            <>
              <Text style={styles.label}>Chuyên môn (VD: Pilates & Mobility)</Text>
              <TextInput
                value={form.specialty}
                onChangeText={(v) => setForm((f) => ({ ...f, specialty: v }))}
                style={styles.input}
              />
            </>
          )}
          <Text style={styles.label}>Mật khẩu ban đầu (tối thiểu 6 ký tự)</Text>
          <TextInput
            value={form.password}
            onChangeText={(v) => setForm((f) => ({ ...f, password: v }))}
            placeholder="Người dùng nên đổi sau lần đăng nhập đầu"
            placeholderTextColor={COLORS.inkSoft}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
          />
          <AppButton disabled={busy} onPress={create}>Tạo tài khoản</AppButton>
        </View>

        {accounts.map((a) => (
          <View key={a.id} style={styles.card}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <View>
                <Text style={styles.cardTitle}>{a.name}</Text>
                <Text style={styles.cardMeta}>{a.phone}</Text>
              </View>
              <Pill tone={a.isActive ? "taupe" : "danger"}>{a.isActive ? "Đang hoạt động" : "Đã khoá"}</Pill>
            </View>
            <View style={{ marginTop: 10 }}>
              <AppButton
                variant="outline"
                onPress={() => toggleActive(a)}
                icon={
                  <Feather
                    name={a.isActive ? "lock" : "unlock"}
                    size={14}
                    color={COLORS.ink}
                    style={{ marginRight: 2 }}
                  />
                }
              >
                {a.isActive ? "Khoá tài khoản" : "Mở lại tài khoản"}
              </AppButton>
            </View>
          </View>
        ))}
      </ScrollView>

      {!!toast && (
        <View style={[styles.toast, toast.isError && styles.toastError]}>
          <Feather name={toast.isError ? "alert-circle" : "check"} size={14} color="#fff" />
          <Text style={styles.toastText}>{toast.msg}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  tabs: { flexDirection: "row", marginHorizontal: 20, marginBottom: 14, backgroundColor: "#EFEAE1", borderRadius: 12, padding: 4 },
  tabBtn: { flex: 1, paddingVertical: 9, borderRadius: 9, alignItems: "center" },
  tabBtnActive: { backgroundColor: COLORS.card },
  tabLabel: { fontWeight: "700", fontSize: 12.5, color: COLORS.inkSoft },
  errorText: { marginHorizontal: 20, marginBottom: 10, color: COLORS.ink, fontSize: 12.5 },
  formCard: { backgroundColor: COLORS.card, borderRadius: 16, padding: 14, gap: 4 },
  formTitle: { fontWeight: "800", fontSize: 14, color: COLORS.ink, marginBottom: 6 },
  label: { fontSize: 11.5, color: COLORS.inkSoft, fontWeight: "700", marginTop: 8, marginBottom: 5 },
  input: {
    borderWidth: 1.5,
    borderColor: COLORS.line,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 13.5,
    color: COLORS.ink,
    marginBottom: 10,
  },
  card: { backgroundColor: COLORS.card, borderRadius: 16, padding: 14 },
  cardTitle: { fontWeight: "800", fontSize: 14, color: COLORS.ink },
  cardMeta: { fontSize: 12, color: COLORS.inkSoft, marginTop: 3 },
  toast: {
    position: "absolute",
    bottom: 90,
    left: 20,
    right: 20,
    backgroundColor: COLORS.ink,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  toastText: { color: "#fff", fontSize: 12.5, flex: 1 },
  toastError: { backgroundColor: "#8C3A3A" },
});
