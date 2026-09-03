import { useState, useEffect, useCallback, useRef } from "react";
import { View, Text, ScrollView, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import PullRefresh from "../components/PullRefresh";
import { useFocusEffect, useNavigation, useRoute } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import TopBar from "../components/TopBar";
import AppButton from "../components/AppButton";
import SectionLabel from "../components/SectionLabel";
import FormSheet from "../components/FormSheet";
import CustomerPackagesModal from "./CustomerPackagesModal";
import ConfirmSheet from "../components/ConfirmSheet";
import * as Clipboard from "expo-clipboard";
import MoneyInput from "../components/MoneyInput";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../theme";
import { FORMATS, FORMAT_RATE_FIELD } from "../utils/formats";

// her-35: hoa hồng tính theo LOẠI HÌNH buổi (1:1/1:2/1:4/1:8) — mỗi mức 1 số tiền +
// cách tính (theo buổi / theo khách). Tên field khớp TrainerRate của server.
const EMPTY_PAY_FORM = {
  baseSalary: "0",
  ...Object.fromEntries(FORMATS.flatMap((f) => [[`${FORMAT_RATE_FIELD[f]}Amount`, "0"], [`${FORMAT_RATE_FIELD[f]}Per`, "session"]])),
};

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

// her-43: bộ lọc nhận từ khối "Cần xử lý" của màn Tổng quan — key khớp `flag` của server
const FLAG_LABEL = { debt: "còn nợ tiền gói", expiring: "gói sắp hết hạn" };
const money = (n) => (n || 0).toLocaleString("vi-VN") + "đ";
const fmtDate = (d) => {
  const x = new Date(d);
  return `${String(x.getDate()).padStart(2, "0")}/${String(x.getMonth() + 1).padStart(2, "0")}`;
};

// Mật khẩu ngẫu nhiên dễ đọc cho khách (bỏ ký tự dễ nhầm 0/O, 1/l...)
function randomPassword() {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  let pw = "";
  for (let i = 0; i < 8; i++) pw += chars[Math.floor(Math.random() * chars.length)];
  return pw;
}

export default function AccountsScreen() {
  const { user } = useAuth();
  const { c } = useTheme();
  const navigation = useNavigation();
  const route = useRoute();
  const options = MANAGEABLE_ROLES[user?.role] || [];
  const [role, setRole] = useState(options[0]?.key || "customer");
  // her-43: "debt" | "expiring" | null — lọc sẵn theo dòng vừa bấm ở màn Tổng quan
  const [flag, setFlag] = useState(null);
  const [accounts, setAccounts] = useState([]);
  // her-23: ô tìm theo tên / SĐT — lọc NGAY khi gõ, không phân biệt hoa thường/dấu,
  // áp cho tab đang xem (học viên, HLV, lễ tân đều tìm được)
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  // toast: { msg, isError } — lỗi hiện icon/màu riêng, không giống thông báo thành công
  const [toast, setToast] = useState(null);

  // Bấm vào 1 tài khoản -> mở thẻ thao tác (mẫu 10); resetInfo giữ mật khẩu mới vừa cấp
  const [selectedId, setSelectedId] = useState(null);
  const [resetInfo, setResetInfo] = useState(null); // { id, password }
  // her-17: hành động nhạy cảm phải qua hộp xác nhận — { kind: "reset"|"lock", acc } | null
  const [confirmAction, setConfirmAction] = useState(null);
  const [copied, setCopied] = useState(false);
  const [pkgCustomer, setPkgCustomer] = useState(null); // mở màn Gói tập của 1 học viên
  // Mục 7: admin thiết lập thù lao HLV — sheet riêng, lưu = tạo BẢN GHI MỨC MỚI (áp từ hôm nay)
  const [paySheet, setPaySheet] = useState(null); // account đang chỉnh
  const [payForm, setPayForm] = useState(EMPTY_PAY_FORM);
  const [payEffective, setPayEffective] = useState(null);
  const [payError, setPayError] = useState("");

  // Form tạo mới nằm trong bottom sheet — bấm nút nổi "+ Tài khoản mới" để mở
  const [sheetOpen, setSheetOpen] = useState(false);
  // Lỗi lúc tạo hiện NGAY TRONG sheet — toast ngoài màn bị Modal che mất (L8)
  const [sheetError, setSheetError] = useState("");
  // Không điền sẵn mật khẩu mặc định — người tạo phải tự đặt (tối thiểu 6 ký tự)
  const [form, setForm] = useState({ name: "", phone: "", password: "", specialties: [] });
  // her-19: chuyên môn HLV = CHỌN từ danh mục bộ môn (không nhập tay)
  const [disciplines, setDisciplines] = useState([]);
  useEffect(() => {
    api.get("/disciplines")
      .then((r) => setDisciplines(r.disciplines.map((d) => [d.key, d.label])))
      .catch(() => {});
  }, []);
  const [busy, setBusy] = useState(false); // chặn bấm đúp tạo/khoá/cấp lại mật khẩu

  // Có bộ lọc thì luôn hỏi server theo học viên + flag (server là nơi quyết định ai vào danh sách)
  const load = useCallback(async (r, f) => {
    setLoading(true); // ẩn empty-state + hiện vòng xoay lúc tải lần đầu (kéo-làm-mới do PullRefresh tự lo)
    try {
      setErrorMsg("");
      const res = await api.get("/accounts", f ? { role: "customer", flag: f } : { role: r });
      setAccounts(res.accounts);
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // her-43: màn Tổng quan điều hướng sang kèm { flag } -> bật bộ lọc rồi XOÁ param ngay,
  // không thì mỗi lần quay lại tab là param cũ tự áp lại (kể cả sau khi đã bấm ✕ bỏ lọc).
  // Bộ lọc vẫn GIỮ khi rời tab rồi quay lại — chip luôn hiện nên người dùng thấy và bấm ✕ được.
  const paramFlag = route.params?.flag;
  useEffect(() => {
    if (!paramFlag) return;
    setRole("customer");
    setSearch("");
    setSelectedId(null);
    setResetInfo(null);
    setFlag(paramFlag);
    navigation.setParams({ flag: undefined });
  }, [paramFlag, navigation]);

  useFocusEffect(
    useCallback(() => {
      load(role, flag);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [role, flag])
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
    setFlag(null); // đổi tab là xem lại toàn bộ vai trò đó, không giữ bộ lọc của màn Tổng quan
    setSelectedId(null);
    setResetInfo(null);
    // Chuỗi tìm của tab cũ mà giữ sang tab mới thì hiện "không khớp" khó hiểu (review V1)
    setSearch("");
    setLoading(true);
  };

  const closeAllSheets = () => {
    setSheetOpen(false);
    setPaySheet(null);
    setConfirmAction(null);
    setPkgCustomer(null);
  };

  const openPaySheet = async (a) => {
    closeAllSheets();
    setPayError("");
    setPayEffective(null);
    setPayForm(EMPTY_PAY_FORM);
    setPaySheet(a);
    try {
      const res = await api.get("/payroll/settings");
      const row = res.trainers.find((t) => String(t.id) === String(a.trainerId));
      if (row?.rate) {
        const next = { baseSalary: String(row.rate.baseSalary ?? 0) };
        for (const f of FORMATS) {
          next[`${FORMAT_RATE_FIELD[f]}Amount`] = String(row.rate[`${FORMAT_RATE_FIELD[f]}Amount`] ?? 0);
          next[`${FORMAT_RATE_FIELD[f]}Per`] = row.rate[`${FORMAT_RATE_FIELD[f]}Per`] || "session";
        }
        setPayForm(next);
        setPayEffective(row.rate.effectiveFrom);
      }
    } catch (err) {
      setPayError(err.message);
    }
  };

  const savePayRates = async () => {
    if (busy || !paySheet) return;
    const nums = {};
    for (const [key, label] of [
      ["baseSalary", "Lương cứng"],
      ...FORMATS.map((f) => [`${FORMAT_RATE_FIELD[f]}Amount`, `Hoa hồng buổi ${f}`]),
    ]) {
      const raw = String(payForm[key] ?? "").trim();
      const n = Number(raw);
      if (raw === "" || !Number.isInteger(n) || n < 0 || n > 1e9) {
        return setPayError(`${label} phải là số nguyên VND từ 0 đến 1 tỷ (nhập 0 nếu không trả)`);
      }
      nums[key] = n;
    }
    setPayError("");
    setBusy(true);
    try {
      await api.post(`/payroll/settings/${paySheet.trainerId}`, {
        ...nums,
        ...Object.fromEntries(FORMATS.map((f) => [`${FORMAT_RATE_FIELD[f]}Per`, payForm[`${FORMAT_RATE_FIELD[f]}Per`]])),
      });
      flash("Đã lưu mức thù lao mới — áp dụng từ bây giờ");
      setPaySheet(null);
    } catch (err) {
      setPayError(err.message); // hiện trong sheet (L8)
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    if (busy) return;
    if (!form.name.trim() || !form.phone.trim()) {
      setSheetError("Vui lòng nhập tên và số điện thoại");
      return;
    }
    if (!/^0\d{9}$/.test(form.phone.trim())) {
      setSheetError("Số điện thoại không hợp lệ (10 chữ số, bắt đầu bằng 0)");
      return;
    }
    if ((form.password || "").length < 6) {
      setSheetError("Mật khẩu tối thiểu 6 ký tự");
      return;
    }
    if (role === "trainer" && form.specialties.length === 0) {
      setSheetError("Chọn ít nhất 1 chuyên môn cho HLV");
      return;
    }
    setSheetError("");
    setBusy(true);
    try {
      await api.post("/accounts", {
        name: form.name.trim(),
        phone: form.phone.trim(),
        password: form.password,
        role,
        specialties: role === "trainer" ? form.specialties : undefined,
      });
      flash(`Đã tạo tài khoản ${ROLE_LABEL[role]}`);
      setForm({ name: "", phone: "", password: "", specialties: [] });
      setSheetOpen(false);
      load(role, flag);
    } catch (err) {
      setSheetError(err.message); // hiện trong sheet — không để lỗi chìm sau Modal
    } finally {
      setBusy(false);
    }
  };

  // Khoá/mở khoá = tạm ngưng, dữ liệu lịch sử giữ nguyên. Khoá tài khoản HLV sẽ ẩn HLV đó
  // khỏi danh sách đặt lịch.
  const toggleActive = async (acc) => {
    if (busy) return;
    setBusy(true);
    try {
      await api.patch(`/accounts/${acc.id}`, { isActive: !acc.isActive });
      load(role, flag);
    } catch (err) {
      flash(err.message, true);
    } finally {
      setBusy(false);
    }
  };

  // Cấp lại mật khẩu ngẫu nhiên (quyết định 14/08/2026) — dùng PATCH password sẵn có,
  // server tự kiểm tra tầng quyền (lễ tân chỉ với học viên, admin với mọi tài khoản — H5)
  const resetPassword = async (acc) => {
    if (busy) return;
    setBusy(true);
    const password = randomPassword();
    try {
      await api.patch(`/accounts/${acc.id}`, { password });
      setResetInfo({ id: acc.id, password });
      flash("Đã cấp lại mật khẩu");
    } catch (err) {
      flash(err.message, true);
    } finally {
      setBusy(false);
    }
  };

  // her-53 (03/09/2026): XOÁ MỀM tài khoản tạo nhầm — server chỉ đánh dấu đã xoá (lịch sử/gói
  // giữ nguyên), tài khoản biến mất khỏi danh sách và không đăng nhập được. Còn lịch sắp tới thì
  // server từ chối và nói rõ — hiện nguyên câu đó (C6).
  const deleteAccount = async (acc) => {
    if (busy) return;
    setBusy(true);
    try {
      await api.delete(`/accounts/${acc.id}`);
      setSelectedId(null);
      setResetInfo(null);
      flash("Đã xoá tài khoản");
      load(role, flag);
    } catch (err) {
      flash(err.message, true);
    } finally {
      setBusy(false);
    }
  };

  const runConfirmed = async () => {
    if (!confirmAction) return;
    const { kind, acc } = confirmAction;
    if (kind === "reset") await resetPassword(acc);
    else if (kind === "delete") await deleteAccount(acc);
    else await toggleActive(acc);
    setConfirmAction(null);
  };

  const copyPassword = async (password) => {
    try {
      await Clipboard.setStringAsync(password);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      flash("Không copy được — hãy chép tay mật khẩu", true);
    }
  };

  const inputStyle = [styles.input, { borderBottomColor: c.line, color: c.ink }];

  // her-23: lọc danh sách theo chuỗi tìm — bỏ dấu + lowercase để "duc" khớp "Đức"
  const norm = (s) =>
    String(s || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/đ/g, "d");
  const q = norm(search.trim());
  // SĐT gõ có khoảng trắng ("0912 345") vẫn khớp — so phần số với phần số (review N3)
  const qDigits = q.replace(/\D/g, "");
  const visible = q
    ? accounts.filter(
        (a) =>
          norm(a.name).includes(q) ||
          (qDigits && String(a.phone || "").includes(qDigits))
      )
    : accounts;

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <TopBar title="Tài khoản" />

      <View style={{ paddingHorizontal: 22 }}>
        <View style={[styles.searchBox, { backgroundColor: c.card, borderColor: c.line }]}>
          <Feather name="search" size={14} color={c.inkSoft} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Tìm tên hoặc số điện thoại"
            placeholderTextColor={c.inkSoft}
            style={[styles.searchInput, { color: c.ink }]}
            returnKeyType="search"
          />
        </View>
        <View style={[styles.tabs, { borderBottomColor: c.line }]}>
          {options.map((o) => (
            <TouchableOpacity
              key={o.key}
              onPress={() => changeRole(o.key)}
              style={[styles.tabBtn, role === o.key && { borderBottomWidth: 2.5, borderBottomColor: c.accent }]}
            >
              <Text style={[styles.tabLabel, { color: role === o.key ? c.accent : c.inkSoft }]}>{o.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        {/* her-43: đang lọc theo dòng vừa bấm ở màn Tổng quan — bấm ✕ để xem lại đủ danh sách */}
        {!!flag && (
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => setFlag(null)}
            style={[styles.filterChip, { backgroundColor: c.primaryTint }]}
          >
            <Text style={[styles.filterChipText, { color: c.accent }]}>{`Đang lọc: ${FLAG_LABEL[flag]}`}</Text>
            <Feather name="x" size={13} color={c.accent} />
          </TouchableOpacity>
        )}
      </View>

      {!!errorMsg && <Text style={[styles.error, { color: c.danger }]}>{errorMsg}</Text>}

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: 110 }}
        refreshControl={<PullRefresh onRefresh={() => load(role, flag)} />}
      >
        {visible.length === 0 && loading && <ActivityIndicator color={c.accent} style={{ marginTop: 24 }} />}
        {visible.length === 0 && !loading && (
          <Text style={[styles.empty, { color: c.inkSoft }]}>
            {q
              ? "Không có tài khoản nào khớp tìm kiếm."
              : flag
                ? `Không còn khách ${FLAG_LABEL[flag]}.`
                : "Chưa có tài khoản nào."}
          </Text>
        )}
        {visible.map((a, i) => (
          <View key={a.id}>
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => {
                setSelectedId(selectedId === a.id ? null : a.id);
                setResetInfo(null);
              }}
              style={[
                styles.row,
                i !== visible.length - 1 && selectedId !== a.id && { borderBottomWidth: 1, borderBottomColor: c.hairline },
                !a.isActive && { opacity: 0.55 },
              ]}
            >
              <View style={[styles.avatar, { backgroundColor: c.primaryTint }]}>
                <Text style={[styles.avatarText, { color: c.accent }]}>
                  {(a.name || "?").slice(0, 1).toUpperCase()}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.rowTitle, { color: c.ink }]}>{a.name}</Text>
                <Text style={[styles.rowMeta, { color: c.inkSoft }]}>
                  {[
                    a.phone,
                    a.debt ? `nợ ${money(a.debt)}` : null,
                    a.expiringAt ? `hết hạn ${fmtDate(a.expiringAt)}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </Text>
              </View>
              <Text style={[styles.status, { color: a.isActive ? c.inkSoft : c.accent }]}>
                {a.isActive ? "Hoạt động" : "Đã khoá"}
              </Text>
            </TouchableOpacity>

            {selectedId === a.id && (
              <View style={[styles.actionCard, { backgroundColor: c.card }]}>
                <Text style={[styles.actionName, { color: c.ink }]}>{a.name}</Text>
                <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
                  <View style={{ flex: 1 }}>
                    <AppButton variant="ghost" disabled={busy} onPress={() => { closeAllSheets(); setConfirmAction({ kind: "reset", acc: a }); }}>
                      Cấp lại mật khẩu
                    </AppButton>
                  </View>
                  <View style={{ flex: 1 }}>
                    <AppButton disabled={busy} onPress={() => { closeAllSheets(); setConfirmAction({ kind: "lock", acc: a }); }}>
                      {a.isActive ? "Khoá tài khoản" : "Mở khoá"}
                    </AppButton>
                  </View>
                </View>
                {role === "customer" && (
                  <AppButton
                    variant="outline"
                    style={{ marginTop: 8 }}
                    onPress={() => { closeAllSheets(); setPkgCustomer(a); }}
                    icon={<Feather name="credit-card" size={13} color={c.accent} style={{ marginRight: 2 }} />}
                  >
                    Gói tập &amp; thanh toán
                  </AppButton>
                )}
                {/* Mục 7: chỉ admin thiết lập thù lao (server cũng chặn — H5) */}
                {role === "trainer" && user?.role === "admin" && !!a.trainerId && (
                  <AppButton variant="outline" style={{ marginTop: 8 }} onPress={() => openPaySheet(a)}>
                    Lương &amp; hoa hồng
                  </AppButton>
                )}
                {resetInfo?.id === a.id && (
                  <TouchableOpacity onPress={() => copyPassword(resetInfo.password)} hitSlop={6}>
                    <Text selectable style={[styles.resetText, { color: c.accent }]}>
                      Mật khẩu mới: <Text style={styles.resetPw}>{resetInfo.password}</Text>
                      {"  "}
                      <Text style={{ color: copied ? c.success : c.inkSoft, fontWeight: "700" }}>
                        {copied ? "✓ đã copy" : "(bấm để copy)"}
                      </Text>
                    </Text>
                  </TouchableOpacity>
                )}
                {/* her-53: xoá mềm tài khoản tạo nhầm — nút viền đỏ, luôn qua hộp xác nhận. her-56: CHỈ admin (server cũng chặn — H5) */}
                {user?.role === "admin" && (
                <AppButton
                  variant="outline"
                  danger
                  style={{ marginTop: 8 }}
                  disabled={busy}
                  onPress={() => { closeAllSheets(); setConfirmAction({ kind: "delete", acc: a }); }}
                  icon={<Feather name="trash-2" size={13} color={c.danger} style={{ marginRight: 2 }} />}
                >
                  Xoá tài khoản
                </AppButton>
                )}
              </View>
            )}
          </View>
        ))}
      </ScrollView>

      {/* Nút nổi mở form — mẫu 10: pill trắng chữ terracotta, góc phải dưới */}
      <TouchableOpacity
        activeOpacity={0.85}
        style={[styles.fab, { backgroundColor: c.card }]}
        onPress={() => {
          closeAllSheets();
          setSheetError("");
          setSheetOpen(true);
        }}
      >
        <Feather name="plus" size={24} color={c.accent} />
      </TouchableOpacity>

      <FormSheet visible={sheetOpen} title={`Tài khoản ${ROLE_LABEL[role]} mới`} onClose={() => setSheetOpen(false)}>
        <SectionLabel style={styles.sheetLabel}>Họ và tên</SectionLabel>
        <TextInput value={form.name} onChangeText={(v) => setForm((f) => ({ ...f, name: v }))} style={inputStyle} />
        <SectionLabel style={styles.sheetLabel}>Số điện thoại</SectionLabel>
        <TextInput
          value={form.phone}
          onChangeText={(v) => setForm((f) => ({ ...f, phone: v }))}
          keyboardType="phone-pad"
          style={inputStyle}
        />
        {role === "trainer" && (
          <>
            {/* her-19: chuyên môn CHỌN từ danh mục bộ môn — HLV chỉ được giao lớp đúng chuyên môn */}
            <SectionLabel style={styles.sheetLabel}>Chuyên môn (chọn 1 hoặc nhiều)</SectionLabel>
            <View style={styles.chipWrap}>
              {disciplines.map(([key, label]) => {
                const on = form.specialties.includes(key);
                return (
                  <TouchableOpacity
                    key={key}
                    onPress={() => setForm((f) => ({
                      ...f,
                      specialties: on ? f.specialties.filter((k) => k !== key) : [...f.specialties, key],
                    }))}
                    style={[styles.chip, { borderColor: c.line }, on && { backgroundColor: c.primaryTint, borderColor: c.primaryTint }]}
                  >
                    <Text style={[styles.chipText, { color: on ? c.accent : c.ink }]}>{label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        )}
        <SectionLabel style={styles.sheetLabel}>Mật khẩu ban đầu (tối thiểu 6 ký tự)</SectionLabel>
        <TextInput
          value={form.password}
          onChangeText={(v) => setForm((f) => ({ ...f, password: v }))}
          placeholder="Nên đổi sau khi đăng nhập"
          placeholderTextColor={c.tabInactive}
          autoCapitalize="none"
          autoCorrect={false}
          style={inputStyle}
        />
        {!!sheetError && <Text style={[styles.sheetError, { color: c.danger }]}>{sheetError}</Text>}
        <AppButton style={{ marginTop: 22 }} disabled={busy} onPress={create}>
          {busy ? "Đang tạo..." : "Tạo tài khoản"}
        </AppButton>
      </FormSheet>

      <ConfirmSheet
        visible={!!confirmAction}
        busy={busy}
        title={
          confirmAction?.kind === "reset"
            ? "Cấp lại mật khẩu?"
            : confirmAction?.kind === "delete"
              ? "Xoá tài khoản?"
              : confirmAction?.acc?.isActive
                ? "Khoá tài khoản?"
                : "Mở khoá tài khoản?"
        }
        message={
          confirmAction?.kind === "reset"
            ? `Cấp mật khẩu mới cho "${confirmAction?.acc?.name}"? Mật khẩu cũ sẽ hết hiệu lực.`
            : confirmAction?.kind === "delete"
              ? `Xoá "${confirmAction?.acc?.name}"? Tài khoản sẽ bị ẩn và không đăng nhập được nữa. Lịch sử tập, gói và thu tiền vẫn được giữ. Chỉ tạm ngưng thì dùng Khoá.`
              : confirmAction?.acc?.isActive
                ? `Bạn chắc chắn muốn khoá tài khoản "${confirmAction?.acc?.name}"?`
                : `Mở khoá tài khoản "${confirmAction?.acc?.name}"?`
        }
        confirmLabel={
          confirmAction?.kind === "reset" ? "Cấp mật khẩu mới"
            : confirmAction?.kind === "delete" ? "Xoá"
              : confirmAction?.acc?.isActive ? "Khoá" : "Mở khoá"
        }
        danger={confirmAction?.kind === "delete"}
        onConfirm={runConfirmed}
        onClose={() => setConfirmAction(null)}
      />

      {!!pkgCustomer && (
        <CustomerPackagesModal customer={pkgCustomer} onClose={() => setPkgCustomer(null)} />
      )}

      <FormSheet
        visible={!!paySheet}
        title={`Lương & hoa hồng — ${paySheet?.name || ""}`}
        onClose={() => { if (!busy) setPaySheet(null); }}
      >
        {!!payEffective && (
          <Text style={{ fontSize: 11.5, marginTop: 6, color: c.inkSoft }}>
            Mức hiện hành áp dụng từ {new Date(payEffective).toLocaleDateString("vi-VN")}. Lưu sẽ tạo mức MỚI áp dụng từ thời điểm lưu — các buổi đã dạy trước đó giữ mức cũ.
          </Text>
        )}
        <SectionLabel style={styles.sheetLabel}>Lương cứng (VND/tháng)</SectionLabel>
        <MoneyInput
          value={payForm.baseSalary}
          onChangeValue={(v) => setPayForm((f) => ({ ...f, baseSalary: v }))}
          style={inputStyle}
        />
        {/* her-35: 4 mức theo loại hình buổi — mỗi mức chọn tính theo buổi hay theo khách */}
        {FORMATS.map((f) => {
          const amountKey = `${FORMAT_RATE_FIELD[f]}Amount`;
          const perKey = `${FORMAT_RATE_FIELD[f]}Per`;
          return (
            <View key={f}>
              <SectionLabel style={styles.sheetLabel}>{`Hoa hồng buổi ${f} (VND)`}</SectionLabel>
              <View style={{ flexDirection: "row", gap: 14, alignItems: "flex-end" }}>
                <MoneyInput
                  value={payForm[amountKey]}
                  onChangeValue={(v) => setPayForm((s) => ({ ...s, [amountKey]: v }))}
                  style={[inputStyle, { flex: 1 }]}
                />
                <View style={{ flexDirection: "row", gap: 6 }}>
                  {[["session", "Theo buổi"], ["attendee", "Theo khách"]].map(([k, l]) => (
                    <TouchableOpacity
                      key={k}
                      onPress={() => setPayForm((s) => ({ ...s, [perKey]: k }))}
                      style={[styles.perChip, { borderColor: c.line }, payForm[perKey] === k && { backgroundColor: c.primaryTint, borderColor: c.primaryTint }]}
                    >
                      <Text style={[styles.perChipText, { color: payForm[perKey] === k ? c.accent : c.ink }]}>{l}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </View>
          );
        })}
        {!!payError && <Text style={[styles.sheetError, { color: c.danger }]}>{payError}</Text>}
        <AppButton style={{ marginTop: 22 }} disabled={busy} onPress={savePayRates}>
          {busy ? "Đang lưu..." : "Lưu mức thù lao"}
        </AppButton>
      </FormSheet>

      {!!toast && (
        <View style={[styles.toast, { backgroundColor: toast.isError ? c.danger : c.accent }]}>
          <Feather name={toast.isError ? "alert-circle" : "check"} size={14} color="#fff" />
          <Text style={styles.toastText}>{toast.msg}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  tabs: { flexDirection: "row", gap: 20, borderBottomWidth: 1, marginTop: 14 },
  filterChip: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    borderRadius: 99,
    paddingVertical: 5,
    paddingHorizontal: 11,
    marginTop: 12,
  },
  filterChipText: { fontSize: 11.5, fontWeight: "700" },
  // her-23: ô tìm theo tên/SĐT — cùng kiểu với màn Lịch tập
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 999,
    borderWidth: 1.5,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginTop: 4,
  },
  searchInput: { flex: 1, fontSize: 13.5 },
  tabBtn: { paddingBottom: 9 },
  tabLabel: { fontSize: 13, fontWeight: "700" },
  error: { fontSize: 12.5, marginHorizontal: 22, marginTop: 10, fontWeight: "700" },
  empty: { fontSize: 13, marginTop: 18 },
  row: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 13 },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 15, fontWeight: "800" },
  rowTitle: { fontSize: 13.5, fontWeight: "700" },
  rowMeta: { fontSize: 11.5, marginTop: 2 },
  status: { fontSize: 12, fontWeight: "700" },
  actionCard: {
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  actionName: { fontSize: 13.5, fontWeight: "800" },
  resetPw: { fontSize: 15, fontWeight: "900", letterSpacing: 1 },
  resetText: { fontSize: 12.5, fontWeight: "700", marginTop: 12, lineHeight: 18 },
  // FAB chỉ icon "+" — tròn, nhích lên khỏi mép dưới (góp ý 18/08)
  fab: {
    position: "absolute",
    right: 22,
    bottom: 34,
    width: 54,
    height: 54,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.14,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
  perChip: { paddingVertical: 7, paddingHorizontal: 11, borderRadius: 999, borderWidth: 1.5, marginBottom: 6 },
  perChipText: { fontSize: 11.5, fontWeight: "700" },
  sheetLabel: { marginTop: 12 },
  // Ô chọn chuyên môn — cùng kiểu chip với sheet "Mở hồ sơ HLV" (ProfileScreen)
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  chip: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1.5 },
  chipText: { fontSize: 12.5, fontWeight: "700" },
  sheetError: { fontSize: 12.5, fontWeight: "700", marginTop: 14 },
  // Ô nhập kiểu gạch chân theo bản thiết kế
  input: { borderBottomWidth: 1.5, paddingVertical: 8, fontSize: 15, marginTop: 2 },
  toast: {
    position: "absolute",
    bottom: 80,
    left: 22,
    right: 22,
    borderRadius: 999,
    paddingVertical: 11,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  toastText: { color: "#fff", fontSize: 12.5, flex: 1 },
});
