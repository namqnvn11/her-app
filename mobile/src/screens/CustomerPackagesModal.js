import { useState, useEffect, useCallback, useRef } from "react";
import { Modal, View, Text, ScrollView, TextInput, TouchableOpacity, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import TopBar from "../components/TopBar";
import AppButton from "../components/AppButton";
import SectionLabel from "../components/SectionLabel";
import FormSheet from "../components/FormSheet";
import ConfirmSheet from "../components/ConfirmSheet";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import MoneyInput from "../components/MoneyInput";
import DateTimeField from "../components/DateTimeField";
import { useTheme } from "../theme";
import { FORMAT_18_SERVICE, SESSION_PACKAGE_FORMATS, packageLabel } from "../utils/formats";

// her-19: danh mục bộ môn lấy từ server (DB) — thêm môn mới không phải sửa app.
// her-35: gói = NHIỀU bộ môn + 1 loại hình. 2 kiểu gói: gói BUỔI (1:1/1:2/1:4) và
// gói THỜI HẠN (chỉ Yoga · 1:8, không giới hạn buổi).
const PACKAGE_KINDS = [
  ["sessions", "Gói buổi"],
  ["duration", "Gói thời hạn"],
];
const PAYMENT_OPTIONS = [
  ["cash", "Tiền mặt"],
  ["transfer", "Chuyển khoản"],
];
const STATUS_LABEL = { active: "Đang dùng", paused: "Bảo lưu", used_up: "Hết buổi", expired: "Hết hạn" };

function fmtDate(d) {
  const date = new Date(d);
  return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}`;
}
const money = (n) => (n || 0).toLocaleString("vi-VN") + "đ";
// Dữ liệu cũ thiếu cả bộ môn lẫn loại hình thì hiện gạch cho khỏi trống trơ
const pkgLabel = (p) => packageLabel(p) || "—";

const EMPTY_FORM = {
  kind: "sessions", name: "", serviceTypes: [], format: "1:1", price: "", totalSessions: "", usedSessions: "",
  expiresOn: "", soldOn: "", paymentMethod: "cash", payState: "full", owe: "",
};

// her-53: form SỬA gói điền sẵn từ gói đang có (cùng hình dạng EMPTY_FORM để dùng chung 1 sheet)
const fmtDateFull = (d) => {
  const x = new Date(d);
  return `${String(x.getDate()).padStart(2, "0")}/${String(x.getMonth() + 1).padStart(2, "0")}/${x.getFullYear()}`;
};
function formFromPackage(p) {
  return {
    kind: p.totalSessions == null ? "duration" : "sessions",
    name: p.name || "",
    serviceTypes: [...(p.serviceTypes || [])],
    format: p.format || "1:1",
    price: String(p.price ?? ""),
    totalSessions: p.totalSessions == null ? "" : String(p.totalSessions),
    usedSessions: p.usedSessions ? String(p.usedSessions) : "",
    expiresOn: p.expiresAt ? fmtDateFull(p.expiresAt) : "",
    soldOn: p.activatedAt ? fmtDateFull(p.activatedAt) : "",
    paymentMethod: p.paymentMethod || "cash",
    payState: p.debt > 0 ? "owe" : "full",
    owe: p.debt > 0 ? String(p.debt) : "",
  };
}
const sameSet = (a, b) => a.length === b.length && [...a].sort().join("|") === [...b].sort().join("|");

// Màn cho lễ tân/admin: xem toàn bộ gói của 1 học viên + bán gói mới (gia hạn = thêm gói),
// ghi nhận thanh toán/nợ (Q10) và bảo lưu/mở bảo lưu (Q11)
export default function CustomerPackagesModal({ customer, onClose }) {
  const { c } = useTheme();
  // her-56: sửa/xoá gói CHỈ admin (server cũng chặn 403 — ẩn nút không phải phân quyền, H5)
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const insets = useSafeAreaInsets();
  const [packages, setPackages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);

  // Sheet bán gói mới
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetError, setSheetError] = useState("");
  const [serviceOptions, setServiceOptions] = useState([]);
  const [serviceError, setServiceError] = useState("");
  useEffect(() => {
    api.get("/disciplines")
      .then((r) => setServiceOptions(r.disciplines.map((d) => [d.key, d.label])))
      // Không tải được danh mục thì KHÔNG bán ngầm — báo rõ để quầy thử lại (C4/C6)
      .catch((err) => setServiceError(err.message));
  }, []);
  const [form, setForm] = useState(EMPTY_FORM);
  // her-53: đang SỬA gói nào (null = đang bán gói mới). baseForm = bản điền sẵn để chỉ gửi field đã đổi
  const [editTarget, setEditTarget] = useState(null);
  const [baseForm, setBaseForm] = useState(EMPTY_FORM);
  // her-55: bộ môn/loại hình/kiểu gói sửa được kể cả khi đã dùng buổi — server tự chặn nếu còn
  // buổi sắp tới không khớp (báo đúng câu). Chỉ còn khoá thanh toán khi đã có lần thu nợ.
  const lockPay = !!editTarget && !!editTarget.paidLocked;
  // her-55: xoá mềm gói bán nhầm — qua hộp xác nhận
  const [deleteTarget, setDeleteTarget] = useState(null);
  // Khi SỬA: chỉ gửi "số đã thu" nếu người dùng thật sự chạm vào khối thanh toán. Form neo theo
  // "còn thiếu" nên đổi mỗi GIÁ mà gửi cả paidAmount sẽ âm thầm đổi số đã thu (review #4).
  const [payTouched, setPayTouched] = useState(false);
  // Nhãn hiển thị của bộ môn Yoga (gói thời hạn) — chưa tải danh mục thì dùng chữ mặc định
  const yogaLabel = serviceOptions.find(([k]) => k === FORMAT_18_SERVICE)?.[1] || "Yoga";

  // Đổi kiểu gói: gói thời hạn tự khoá Yoga · 1:8 và bỏ số buổi (server chặn cùng luật)
  const changeKind = (kind) => {
    setSheetError(""); // lỗi của kiểu gói cũ không còn đúng nữa
    setForm((f) =>
      kind === "duration"
        ? { ...f, kind, serviceTypes: [FORMAT_18_SERVICE], format: "1:8", totalSessions: "" }
        : { ...f, kind, serviceTypes: [], format: "1:1" }
    );
  };

  const toggleService = (key) => {
    setForm((f) => ({
      ...f,
      serviceTypes: f.serviceTypes.includes(key)
        ? f.serviceTypes.filter((k) => k !== key)
        : [...f.serviceTypes, key],
    }));
  };
  // Sheet thu tiền nợ: { id, name, debt }
  const [payTarget, setPayTarget] = useState(null);
  const [payAmount, setPayAmount] = useState("");
  const [payError, setPayError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setErrorMsg("");
      const res = await api.get(`/packages/customer/${customer.id}`);
      setPackages(res.packages);
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  }, [customer.id]);

  useEffect(() => {
    load();
  }, [load]);

  const toastTimer = useRef(null);
  const flash = (msg, isError = false) => {
    clearTimeout(toastTimer.current);
    setToast({ msg, isError });
    toastTimer.current = setTimeout(() => setToast(null), isError ? 3500 : 2200);
  };

  // Kiểm tra form phía app (chỉ để báo sớm — luật thật ở server). Trả { error } hoặc payload.
  // her-53: dùng chung cho bán gói và sửa gói; khi sửa mà khoá thanh toán thì bỏ qua phần thu tiền.
  const validateForm = ({ skipPay = false } = {}) => {
    const isDuration = form.kind === "duration";
    const price = Number(form.price || "");
    const sessions = isDuration || form.totalSessions.trim() === "" ? null : Number(form.totalSessions);
    if (!form.name.trim()) return { error: "Nhập tên gói" };
    if (!form.serviceTypes.length) return { error: "Chọn ít nhất 1 bộ môn" };
    // Bỏ trống giá KHÔNG được hiểu là 0đ — lễ tân quên nhập sẽ thành gói miễn phí không ai biết
    if (!form.price || !Number.isInteger(price) || price < 0) return { error: "Nhập giá gói" };
    // Ngày hết hạn: chọn từ lịch (her-19); gói buổi để trống = không thời hạn
    let expiresAt = null;
    if (form.expiresOn) {
      const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(form.expiresOn);
      if (!m) return { error: "Ngày hết hạn chưa đúng — bấm ô để chọn trên lịch" };
      expiresAt = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), 12, 0, 0).toISOString();
    }
    if (isDuration && !expiresAt) return { error: "Gói thời hạn phải chọn ngày hết hạn" };
    // her-56: ngày bán — trống = hôm nay; nhập lùi cho gói đã bán trước khi dùng app
    let soldAt = null;
    if (form.soldOn) {
      const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(form.soldOn);
      if (!m) return { error: "Ngày bán chưa đúng — bấm ô để chọn trên lịch" };
      soldAt = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), 12, 0, 0).toISOString();
    }
    // Gói buổi BẮT BUỘC có số buổi (gói không giới hạn buổi = gói thời hạn Yoga 1:8)
    if (!isDuration && sessions === null) return { error: "Nhập số buổi" };
    if (sessions !== null && (!Number.isInteger(sessions) || sessions < 1)) {
      return { error: "Số buổi phải là số nguyên dương" };
    }
    // her-55: số buổi đã tập (khách cũ / tập thử) — trống = 0; chỉ có nghĩa với gói buổi
    const usedSessions = isDuration || form.usedSessions.trim() === "" ? 0 : Number(form.usedSessions);
    if (!Number.isInteger(usedSessions) || usedSessions < 0) return { error: "Số buổi đã tập phải là số nguyên không âm" };
    if (sessions !== null && usedSessions > sessions) return { error: "Số buổi đã tập không được lớn hơn số buổi của gói" };
    // Thanh toán: Thu đủ / Còn thiếu — còn thiếu thì nhập SỐ TIỀN CÒN THIẾU (her-19)
    let paid = price;
    if (!skipPay && form.payState === "owe") {
      const owe = Number(form.owe || "");
      if (!form.owe || !Number.isInteger(owe) || owe <= 0 || owe > price) {
        return { error: "Nhập số tiền còn thiếu (lớn hơn 0, không quá giá gói)" };
      }
      paid = price - owe;
    }
    return {
      name: form.name.trim(), serviceTypes: form.serviceTypes, format: form.format, price,
      totalSessions: sessions, usedSessions, expiresAt, soldAt, paymentMethod: form.paymentMethod, paidAmount: paid,
    };
  };

  const create = async () => {
    if (busy) return;
    const v = validateForm();
    if (v.error) return setSheetError(v.error);
    setSheetError("");
    setBusy(true);
    try {
      const { soldAt, ...rest } = v;
      await api.post("/packages", { userId: customer.id, ...rest, ...(soldAt ? { soldAt } : {}) });
      flash(`Đã bán gói cho ${customer.name}`);
      setForm(EMPTY_FORM);
      setSheetOpen(false);
      load();
    } catch (err) {
      setSheetError(err.message); // hiện trong sheet — không để lỗi chìm sau Modal
    } finally {
      setBusy(false);
    }
  };

  // her-53: mở form sửa — điền sẵn từ gói, nhớ bản gốc để chỉ gửi field đã đổi
  const openEdit = (p) => {
    const base = formFromPackage(p);
    setEditTarget(p);
    setBaseForm(base);
    setForm(base);
    setPayTouched(false);
    setSheetError("");
    setSheetOpen(true);
  };
  const openCreate = () => {
    setEditTarget(null);
    setForm(EMPTY_FORM);
    setPayTouched(false);
    setSheetError("");
    setSheetOpen(true);
  };

  // Chỉ gửi những gì THAY ĐỔI so với bản điền sẵn: gói đã hết hạn sửa tên vẫn được (không đụng
  // ngày thì server không áp luật "hạn phải ở tương lai"); server tự gộp và kiểm tra ràng buộc.
  const save = async () => {
    if (busy || !editTarget) return;
    const v = validateForm({ skipPay: lockPay });
    if (v.error) return setSheetError(v.error);
    const body = {};
    if (v.name !== baseForm.name.trim()) body.name = v.name;
    if (!sameSet(v.serviceTypes, baseForm.serviceTypes)) body.serviceTypes = v.serviceTypes;
    if (v.format !== baseForm.format) body.format = v.format;
    if (String(v.price) !== baseForm.price) body.price = v.price;
    if ((v.totalSessions == null ? "" : String(v.totalSessions)) !== baseForm.totalSessions) body.totalSessions = v.totalSessions;
    // Ô "Đã tập" chỉ hiện với gói buổi — gói thời hạn không gửi để không reset số đã tập về 0 (review #3)
    if (form.kind === "sessions" && v.usedSessions !== Number(baseForm.usedSessions || 0)) body.usedSessions = v.usedSessions;
    if (form.expiresOn !== baseForm.expiresOn) body.expiresAt = v.expiresAt;
    if (form.soldOn && form.soldOn !== baseForm.soldOn) body.soldAt = v.soldAt;
    if (v.paymentMethod !== baseForm.paymentMethod) body.paymentMethod = v.paymentMethod;
    if (!lockPay && payTouched) {
      const basePaid = Number(baseForm.price) - (baseForm.payState === "owe" ? Number(baseForm.owe) : 0);
      if (v.paidAmount !== basePaid) body.paidAmount = v.paidAmount;
    }
    if (!Object.keys(body).length) return setSheetError("Chưa thay đổi gì");
    setSheetError("");
    setBusy(true);
    try {
      await api.patch(`/packages/${editTarget.id}`, body);
      flash("Đã sửa gói");
      setSheetOpen(false);
      setEditTarget(null);
      setForm(EMPTY_FORM);
      load();
    } catch (err) {
      setSheetError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const pay = async () => {
    if (busy || !payTarget) return;
    const amount = Number(payAmount || "");
    if (!payAmount || !Number.isInteger(amount) || amount <= 0) {
      return setPayError("Nhập số tiền vừa thu");
    }
    setPayError("");
    setBusy(true);
    try {
      await api.patch(`/packages/${payTarget.id}/pay`, { amount });
      flash("Đã ghi nhận thu tiền");
      setPayTarget(null);
      setPayAmount("");
      load();
    } catch (err) {
      setPayError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const deletePackage = async () => {
    if (busy || !deleteTarget) return;
    setBusy(true);
    try {
      await api.delete(`/packages/${deleteTarget.id}`);
      flash("Đã xoá gói");
      setDeleteTarget(null);
      load();
    } catch (err) {
      flash(err.message, true); // vd "còn N buổi sắp tới đã đặt" — server nói rõ (C6)
      setDeleteTarget(null);
    } finally {
      setBusy(false);
    }
  };

  const pauseOrResume = async (p) => {
    if (busy) return;
    setBusy(true);
    try {
      await api.patch(`/packages/${p.id}/${p.status === "paused" ? "resume" : "pause"}`);
      flash(p.status === "paused" ? "Đã mở bảo lưu — hạn được cộng bù" : "Đã bảo lưu gói");
      load();
    } catch (err) {
      flash(err.message, true);
    } finally {
      setBusy(false);
    }
  };

  const inputStyle = [styles.input, { borderBottomColor: c.line, color: c.ink }];

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      {/* Modal toàn màn nằm ngoài SafeAreaView → tự đệm đáy cho thanh điều hướng Android */}
      <View style={{ flex: 1, backgroundColor: c.bg, paddingBottom: insets.bottom }}>
        <TopBar title={`Gói tập — ${customer.name}`} sub={customer.phone} onBack={onClose} />

        {!!errorMsg && <Text style={[styles.error, { color: c.danger }]}>{errorMsg}</Text>}

        <ScrollView contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: 110 }}>
          <SectionLabel>{`Danh sách gói · ${packages.length}`}</SectionLabel>
          {!loading && packages.length === 0 && (
            <Text style={[styles.empty, { color: c.inkSoft }]}>Học viên chưa có gói nào.</Text>
          )}
          {packages.map((p, i) => (
            <View
              key={p.id}
              style={[styles.row, i !== packages.length - 1 && { borderBottomWidth: 1, borderBottomColor: c.hairline }]}
            >
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Text style={[styles.rowTitle, { color: c.ink, flex: 1 }]}>{p.name}</Text>
                <Text style={[styles.status, { color: p.status === "active" ? c.accent : c.inkSoft }]}>
                  {STATUS_LABEL[p.status] || p.status}
                </Text>
              </View>
              <Text style={[styles.rowMeta, { color: c.inkSoft }]}>
                {pkgLabel(p)} ·{" "}
                {p.totalSessions == null ? "không giới hạn buổi" : `còn ${p.remainingSessions}/${p.totalSessions} buổi`}
                {" · "}
                {p.expiresAt ? `hết hạn ${fmtDate(p.expiresAt)}` : "không thời hạn"} · {money(p.price)}
              </Text>
              {p.debt > 0 && (
                <Text style={[styles.debt, { color: c.danger }]}>
                  Còn nợ {money(p.debt)} ({PAYMENT_OPTIONS.find(([k]) => k === p.paymentMethod)?.[1] || p.paymentMethod})
                </Text>
              )}
              <View style={{ flexDirection: "row", gap: 14, marginTop: 8 }}>
                {/* her-53/55: sửa gói bán nhầm — server chặn khi còn buổi sắp tới không hợp gói mới */}
                {isAdmin && (
                  <TouchableOpacity disabled={busy} onPress={() => openEdit(p)} hitSlop={8}>
                    <Text style={[styles.actionLink, { color: c.accent }]}>Sửa</Text>
                  </TouchableOpacity>
                )}
                {isAdmin && (
                  <TouchableOpacity disabled={busy} onPress={() => setDeleteTarget(p)} hitSlop={8}>
                    <Text style={[styles.actionLink, { color: c.danger }]}>Xoá</Text>
                  </TouchableOpacity>
                )}
                {p.debt > 0 && (
                  <TouchableOpacity disabled={busy} onPress={() => { setPayError(""); setPayAmount(""); setPayTarget(p); }} hitSlop={8}>
                    <Text style={[styles.actionLink, { color: c.accent }]}>Thu tiền</Text>
                  </TouchableOpacity>
                )}
                {/* Bảo lưu chỉ áp dụng gói CÓ thời hạn (Q11) */}
                {p.expiresAt && (p.status === "active" || p.status === "paused") && (
                  <TouchableOpacity disabled={busy} onPress={() => pauseOrResume(p)} hitSlop={8}>
                    <Text style={[styles.actionLink, { color: c.accent }]}>
                      {p.status === "paused" ? "Mở bảo lưu" : "Bảo lưu"}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          ))}
        </ScrollView>

        {/* Nút nổi mở form bán gói — cùng kiểu pill trắng của bản thiết kế */}
        <TouchableOpacity
          activeOpacity={0.85}
          style={[styles.fab, { backgroundColor: c.card, bottom: 34 + insets.bottom }]}
          onPress={openCreate}
        >
          <Feather name="plus" size={24} color={c.accent} />
        </TouchableOpacity>

        <FormSheet
          visible={sheetOpen}
          title={editTarget ? `Sửa gói — ${editTarget.name}` : `Bán gói cho ${customer.name}`}
          onClose={() => setSheetOpen(false)}
        >
          <SectionLabel style={styles.sheetLabel}>Tên gói</SectionLabel>
          <TextInput
            value={form.name}
            onChangeText={(v) => setForm((f) => ({ ...f, name: v }))}
            placeholder="VD: Pilates 24 buổi"
            placeholderTextColor={c.tabInactive}
            style={inputStyle}
          />
          {/* her-35 — khối 1: kiểu gói. Gói thời hạn tự khoá Yoga · 1:8, không có số buổi */}
          <SectionLabel style={styles.sheetLabel}>Kiểu gói</SectionLabel>
          <View style={styles.chipWrap}>
            {PACKAGE_KINDS.map(([key, label]) => (
              <TouchableOpacity
                key={key}
                onPress={() => changeKind(key)}
                style={[
                  styles.chip,
                  { borderColor: c.line },
                  form.kind === key && { backgroundColor: c.primaryTint, borderColor: c.primaryTint },
                ]}
              >
                <Text style={[styles.chipText, { color: form.kind === key ? c.accent : c.ink }]}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {form.kind === "duration" ? (
            <Text style={[styles.lockedNote, { color: c.inkSoft }]}>{`${yogaLabel} · 1:8 · không giới hạn buổi`}</Text>
          ) : (
            <>
              {/* her-35 — khối 2: gói mix NHIỀU bộ môn (bấm để chọn/bỏ) */}
              <SectionLabel style={styles.sheetLabel}>Bộ môn (chọn nhiều)</SectionLabel>
              {!!serviceError && <Text style={[styles.sheetError, { color: c.danger }]}>{serviceError}</Text>}
              <View style={styles.chipWrap}>
                {serviceOptions.map(([key, label]) => (
                  <TouchableOpacity
                    key={key}
                        onPress={() => toggleService(key)}
                    style={[
                      styles.chip,
                      { borderColor: c.line },
                      form.serviceTypes.includes(key) && { backgroundColor: c.primaryTint, borderColor: c.primaryTint },
                        ]}
                  >
                    <Text style={[styles.chipText, { color: form.serviceTypes.includes(key) ? c.accent : c.ink }]}>
                      {label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              {/* her-35 — khối 3: loại hình của gói buổi */}
              <SectionLabel style={styles.sheetLabel}>Loại hình</SectionLabel>
              <View style={styles.chipWrap}>
                {SESSION_PACKAGE_FORMATS.map((f) => (
                  <TouchableOpacity
                    key={f}
                        onPress={() => setForm((s) => ({ ...s, format: f }))}
                    style={[
                      styles.chip,
                      { borderColor: c.line },
                      form.format === f && { backgroundColor: c.primaryTint, borderColor: c.primaryTint },
                        ]}
                  >
                    <Text style={[styles.chipText, { color: form.format === f ? c.accent : c.ink }]}>{f}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}
          <View style={{ flexDirection: "row", gap: 20 }}>
            <View style={{ flex: 1.4 }}>
              <SectionLabel style={styles.sheetLabel}>Giá (đ)</SectionLabel>
              <MoneyInput
                value={form.price}
                onChangeValue={(v) => setForm((f) => ({ ...f, price: v }))}
                style={inputStyle}
              />
            </View>
            {form.kind === "sessions" && (
              <View style={{ flex: 1 }}>
                <SectionLabel style={styles.sheetLabel}>Số buổi</SectionLabel>
                <TextInput
                  value={form.totalSessions}
                  onChangeText={(v) => setForm((f) => ({ ...f, totalSessions: v }))}
                  keyboardType="number-pad"
                  placeholder="VD: 24"
                  placeholderTextColor={c.tabInactive}
                  style={inputStyle}
                />
              </View>
            )}
            {/* her-55: buổi đã tập trước khi vào app (khách cũ) hoặc tập thử trước khi mua */}
            {form.kind === "sessions" && (
              <View style={{ flex: 1 }}>
                <SectionLabel style={styles.sheetLabel}>Đã tập</SectionLabel>
                <TextInput
                  value={form.usedSessions}
                  onChangeText={(v) => setForm((f) => ({ ...f, usedSessions: v }))}
                  keyboardType="number-pad"
                  placeholder="0"
                  placeholderTextColor={c.tabInactive}
                  style={inputStyle}
                />
              </View>
            )}
          </View>
          {/* her-19: hết hạn CHỌN TỪ LỊCH — gói buổi để trống = không thời hạn */}
          <SectionLabel style={styles.sheetLabel}>
            {form.kind === "duration" ? "Ngày hết hạn" : "Ngày hết hạn (trống = không thời hạn)"}
          </SectionLabel>
          <DateTimeField
            mode="date"
            value={form.expiresOn}
            // her-44: gói BUỔI được để trống -> chọn nhầm còn bỏ được bằng ✕.
            // Gói THỜI HẠN bắt buộc có hạn nên không cho xoá.
            clearable={form.kind !== "duration"}
            placeholder={form.kind === "duration" ? "Bấm để chọn ngày" : "Không thời hạn — bấm để chọn ngày"}
            onChange={(v) => setForm((f) => ({ ...f, expiresOn: v }))}
          />
          {/* her-56: NGÀY BÁN — hệ thống mới dùng, quầy nhập lại gói cũ để doanh thu vào đúng tháng */}
          <SectionLabel style={styles.sheetLabel}>{editTarget ? "Ngày bán" : "Ngày bán (trống = hôm nay)"}</SectionLabel>
          <DateTimeField
            mode="date"
            value={form.soldOn}
            allowPast
            clearable={!editTarget}
            placeholder="Hôm nay — bấm để chọn ngày khác"
            onChange={(v) => setForm((f) => ({ ...f, soldOn: v }))}
          />
          <SectionLabel style={styles.sheetLabel}>Thanh toán</SectionLabel>
          <View style={styles.chipWrap}>
            {PAYMENT_OPTIONS.map(([key, label]) => (
              <TouchableOpacity
                key={key}
                onPress={() => setForm((f) => ({ ...f, paymentMethod: key }))}
                style={[
                  styles.chip,
                  { borderColor: c.line },
                  form.paymentMethod === key && { backgroundColor: c.primaryTint, borderColor: c.primaryTint },
                ]}
              >
                <Text style={[styles.chipText, { color: form.paymentMethod === key ? c.accent : c.ink }]}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {/* her-19: 2 lựa chọn rõ ràng — Thu đủ / Còn thiếu (nhập số tiền còn thiếu).
              her-53: gói đã có lần thu nợ thì không sửa tay số đã thu — dùng Thu tiền (server cũng chặn) */}
          {lockPay ? (
            <Text style={[styles.lockedNote, { color: c.inkSoft }]}>Đã có lần thu nợ — số đã thu chỉ đổi qua nút Thu tiền</Text>
          ) : (
            <>
              <View style={styles.chipWrap}>
                {[["full", "Thu đủ"], ["owe", "Còn thiếu"]].map(([key, label]) => (
                  <TouchableOpacity
                    key={key}
                    onPress={() => { setPayTouched(true); setForm((f) => ({ ...f, payState: key })); }}
                    style={[
                      styles.chip,
                      { borderColor: c.line },
                      form.payState === key && { backgroundColor: c.primaryTint, borderColor: c.primaryTint },
                    ]}
                  >
                    <Text style={[styles.chipText, { color: form.payState === key ? c.accent : c.ink }]}>{label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {form.payState === "owe" && (
                <>
                  <SectionLabel style={styles.sheetLabel}>Số tiền còn thiếu (đ)</SectionLabel>
                  <MoneyInput
                    value={form.owe}
                    onChangeValue={(v) => { setPayTouched(true); setForm((f) => ({ ...f, owe: v })); }}
                    placeholder="Quầy nhắc thu sau"
                    placeholderTextColor={c.tabInactive}
                    style={inputStyle}
                  />
                </>
              )}
            </>
          )}
          {!!sheetError && <Text style={[styles.sheetError, { color: c.danger }]}>{sheetError}</Text>}
          <AppButton style={{ marginTop: 22 }} disabled={busy} onPress={editTarget ? save : create}>
            {busy ? "Đang lưu..." : editTarget ? "Lưu thay đổi" : "Bán gói"}
          </AppButton>
        </FormSheet>

        <FormSheet
          visible={!!payTarget}
          title={payTarget ? `Thu tiền nợ — ${payTarget.name}` : ""}
          onClose={() => setPayTarget(null)}
        >
          {!!payTarget && (
            <Text style={{ fontSize: 12.5, color: c.inkSoft }}>
              Còn nợ {money(payTarget.debt)}. Nhập số tiền vừa thu:
            </Text>
          )}
          <MoneyInput
            value={payAmount}
            onChangeValue={setPayAmount}
            placeholder="Số tiền (đ)"
            placeholderTextColor={c.tabInactive}
            style={inputStyle}
          />
          {!!payError && <Text style={[styles.sheetError, { color: c.danger }]}>{payError}</Text>}
          <AppButton style={{ marginTop: 22 }} disabled={busy} onPress={pay}>
            {busy ? "Đang lưu..." : "Ghi nhận thu tiền"}
          </AppButton>
        </FormSheet>

        <ConfirmSheet
          visible={!!deleteTarget}
          busy={busy}
          danger
          title="Xoá gói?"
          message={deleteTarget ? `Xoá gói "${deleteTarget.name}"? Gói sẽ bị ẩn, không dùng để đặt lịch và không tính vào doanh thu. Buổi đã tập vẫn giữ trong lịch sử.` : ""}
          confirmLabel="Xoá"
          onConfirm={deletePackage}
          onClose={() => setDeleteTarget(null)}
        />

        {!!toast && (
          <View style={[styles.toast, { backgroundColor: toast.isError ? c.danger : c.accent, bottom: 80 + insets.bottom }]}>
            <Feather name={toast.isError ? "alert-circle" : "check"} size={14} color="#fff" />
            <Text style={styles.toastText}>{toast.msg}</Text>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  error: { fontSize: 12.5, marginHorizontal: 22, marginTop: 8, fontWeight: "700" },
  empty: { fontSize: 13, marginTop: 12 },
  row: { paddingVertical: 13 },
  rowTitle: { fontSize: 13.5, fontWeight: "700" },
  rowMeta: { fontSize: 11.5, marginTop: 3, lineHeight: 17 },
  debt: { fontSize: 11.5, fontWeight: "700", marginTop: 4 },
  status: { fontSize: 12, fontWeight: "700", marginLeft: 8 },
  actionLink: { fontSize: 11.5, fontWeight: "700" },
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
  sheetLabel: { marginTop: 12 },
  lockedNote: { fontSize: 12.5, fontWeight: "700", marginTop: 10 },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  chip: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1.5 },
  chipText: { fontSize: 12.5, fontWeight: "700" },
  // Ô nhập kiểu gạch chân theo bản thiết kế
  input: { borderBottomWidth: 1.5, paddingVertical: 8, fontSize: 15, marginTop: 2 },
  sheetError: { fontSize: 12.5, fontWeight: "700", marginTop: 14 },
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
