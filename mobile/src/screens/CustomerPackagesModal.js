import { useState, useEffect, useCallback, useRef } from "react";
import { Modal, View, Text, ScrollView, TextInput, TouchableOpacity, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import TopBar from "../components/TopBar";
import AppButton from "../components/AppButton";
import SectionLabel from "../components/SectionLabel";
import FormSheet from "../components/FormSheet";
import { api } from "../api/client";
import MoneyInput from "../components/MoneyInput";
import DateTimeField from "../components/DateTimeField";
import { useTheme } from "../theme";

// her-19: danh mục bộ môn lấy từ server (DB) — thêm môn mới không phải sửa app;
// "PT" là loại gói cố định luôn có.
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

// Màn cho lễ tân/admin: xem toàn bộ gói của 1 học viên + bán gói mới (gia hạn = thêm gói),
// ghi nhận thanh toán/nợ (Q10) và bảo lưu/mở bảo lưu (Q11)
export default function CustomerPackagesModal({ customer, onClose }) {
  const { c } = useTheme();
  const [packages, setPackages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);

  // Sheet bán gói mới
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetError, setSheetError] = useState("");
  const [serviceOptions, setServiceOptions] = useState([["pt", "PT"]]);
  useEffect(() => {
    api.get("/disciplines")
      .then((r) => {
        const opts = [...r.disciplines.map((d) => [d.key, d.label]), ["pt", "PT"]];
        setServiceOptions(opts);
        // review her-19 V5: lựa chọn mặc định phải là chip ĐANG HIỂN THỊ — không chọn ngầm
        setForm((f) => (opts.some(([k]) => k === f.serviceType) ? f : { ...f, serviceType: opts[0][0] }));
      })
      .catch(() => {
        // fetch fail: chỉ còn PT — ép chọn PT để không "bán ngầm" loại đang ẩn (V5)
        setForm((f) => ({ ...f, serviceType: "pt" }));
      });
  }, []);
  const [form, setForm] = useState({
    name: "", serviceType: "pilates", price: "", totalSessions: "", expiresOn: "",
    paymentMethod: "cash", payState: "full", owe: "",
  });
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

  const create = async () => {
    if (busy) return;
    const price = Number(form.price || "");
    const sessions = form.totalSessions.trim() === "" ? null : Number(form.totalSessions);
    if (!form.name.trim()) return setSheetError("Nhập tên gói");
    // Bỏ trống giá KHÔNG được hiểu là 0đ — lễ tân quên nhập sẽ thành gói miễn phí không ai biết
    if (!form.price || !Number.isInteger(price) || price < 0) {
      return setSheetError("Nhập giá gói");
    }
    // Ngày hết hạn: chọn từ lịch (her-19); trống = không thời hạn
    let expiresAt = null;
    if (form.expiresOn) {
      const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(form.expiresOn);
      if (!m) return setSheetError("Ngày hết hạn chưa đúng — bấm ô để chọn trên lịch");
      expiresAt = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), 12, 0, 0).toISOString();
    }
    if (sessions === null && !expiresAt) {
      return setSheetError("Gói phải có số buổi hoặc ngày hết hạn (hoặc cả hai)");
    }
    if (sessions !== null && (!Number.isInteger(sessions) || sessions < 1)) {
      return setSheetError("Số buổi phải là số nguyên dương");
    }
    // Thanh toán: Thu đủ / Còn thiếu — còn thiếu thì nhập SỐ TIỀN CÒN THIẾU (her-19)
    let paid = price;
    if (form.payState === "owe") {
      const owe = Number(form.owe || "");
      if (!form.owe || !Number.isInteger(owe) || owe <= 0 || owe > price) {
        return setSheetError("Nhập số tiền còn thiếu (lớn hơn 0, không quá giá gói)");
      }
      paid = price - owe;
    }
    setSheetError("");
    setBusy(true);
    try {
      await api.post("/packages", {
        userId: customer.id,
        name: form.name.trim(),
        serviceType: form.serviceType,
        price,
        totalSessions: sessions,
        expiresAt,
        paymentMethod: form.paymentMethod,
        paidAmount: paid,
      });
      flash(`Đã bán gói cho ${customer.name}`);
      setForm({ name: "", serviceType: "pilates", price: "", totalSessions: "", expiresOn: "", paymentMethod: "cash", payState: "full", owe: "" });
      setSheetOpen(false);
      load();
    } catch (err) {
      setSheetError(err.message); // hiện trong sheet — không để lỗi chìm sau Modal
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
      <View style={{ flex: 1, backgroundColor: c.bg }}>
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
                <Text style={[styles.status, { color: p.status === "active" ? c.primary : c.inkSoft }]}>
                  {STATUS_LABEL[p.status] || p.status}
                </Text>
              </View>
              <Text style={[styles.rowMeta, { color: c.inkSoft }]}>
                {p.serviceLabel} ·{" "}
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
                {p.debt > 0 && (
                  <TouchableOpacity disabled={busy} onPress={() => { setPayError(""); setPayAmount(""); setPayTarget(p); }} hitSlop={8}>
                    <Text style={[styles.actionLink, { color: c.primary }]}>Thu tiền</Text>
                  </TouchableOpacity>
                )}
                {/* Bảo lưu chỉ áp dụng gói CÓ thời hạn (Q11) */}
                {p.expiresAt && (p.status === "active" || p.status === "paused") && (
                  <TouchableOpacity disabled={busy} onPress={() => pauseOrResume(p)} hitSlop={8}>
                    <Text style={[styles.actionLink, { color: c.primary }]}>
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
          style={[styles.fab, { backgroundColor: c.card }]}
          onPress={() => {
            setSheetError("");
            setSheetOpen(true);
          }}
        >
          <Text style={[styles.fabText, { color: c.primary }]}>+ Bán gói mới</Text>
        </TouchableOpacity>

        <FormSheet visible={sheetOpen} title={`Bán gói cho ${customer.name}`} onClose={() => setSheetOpen(false)}>
          <SectionLabel style={styles.sheetLabel}>Tên gói</SectionLabel>
          <TextInput
            value={form.name}
            onChangeText={(v) => setForm((f) => ({ ...f, name: v }))}
            placeholder="VD: Pilates 24 buổi — 3 tháng"
            placeholderTextColor={c.tabInactive}
            style={inputStyle}
          />
          <SectionLabel style={styles.sheetLabel}>Loại hình</SectionLabel>
          <View style={styles.chipWrap}>
            {serviceOptions.map(([key, label]) => (
              <TouchableOpacity
                key={key}
                onPress={() => setForm((f) => ({ ...f, serviceType: key }))}
                style={[
                  styles.chip,
                  { borderColor: c.line },
                  form.serviceType === key && { backgroundColor: c.primaryTint, borderColor: c.primaryTint },
                ]}
              >
                <Text style={[styles.chipText, { color: form.serviceType === key ? c.primary : c.ink }]}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={{ flexDirection: "row", gap: 20 }}>
            <View style={{ flex: 1.4 }}>
              <SectionLabel style={styles.sheetLabel}>Giá (đ)</SectionLabel>
              <MoneyInput
                value={form.price}
                onChangeValue={(v) => setForm((f) => ({ ...f, price: v }))}
                style={inputStyle}
              />
            </View>
            <View style={{ flex: 1 }}>
              <SectionLabel style={styles.sheetLabel}>Số buổi</SectionLabel>
              <TextInput
                value={form.totalSessions}
                onChangeText={(v) => setForm((f) => ({ ...f, totalSessions: v }))}
                keyboardType="number-pad"
                placeholder="Trống = ∞"
                placeholderTextColor={c.tabInactive}
                style={inputStyle}
              />
            </View>
          </View>
          {/* her-19: hết hạn CHỌN TỪ LỊCH — trống = không thời hạn */}
          <SectionLabel style={styles.sheetLabel}>Ngày hết hạn (trống = không thời hạn)</SectionLabel>
          <DateTimeField
            mode="date"
            value={form.expiresOn}
            placeholder="Không thời hạn — bấm để chọn ngày"
            onChange={(v) => setForm((f) => ({ ...f, expiresOn: v }))}
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
                <Text style={[styles.chipText, { color: form.paymentMethod === key ? c.primary : c.ink }]}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {/* her-19: 2 lựa chọn rõ ràng — Thu đủ / Còn thiếu (nhập số tiền còn thiếu) */}
          <View style={styles.chipWrap}>
            {[["full", "Thu đủ"], ["owe", "Còn thiếu"]].map(([key, label]) => (
              <TouchableOpacity
                key={key}
                onPress={() => setForm((f) => ({ ...f, payState: key }))}
                style={[
                  styles.chip,
                  { borderColor: c.line },
                  form.payState === key && { backgroundColor: c.primaryTint, borderColor: c.primaryTint },
                ]}
              >
                <Text style={[styles.chipText, { color: form.payState === key ? c.primary : c.ink }]}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {form.payState === "owe" && (
            <>
              <SectionLabel style={styles.sheetLabel}>Số tiền còn thiếu (đ)</SectionLabel>
              <MoneyInput
                value={form.owe}
                onChangeValue={(v) => setForm((f) => ({ ...f, owe: v }))}
                placeholder="Khách vẫn tập bình thường, quầy nhắc thu sau"
                placeholderTextColor={c.tabInactive}
                style={inputStyle}
              />
            </>
          )}
          {!!sheetError && <Text style={[styles.sheetError, { color: c.danger }]}>{sheetError}</Text>}
          <AppButton style={{ marginTop: 22 }} disabled={busy} onPress={create}>
            {busy ? "Đang lưu..." : "Bán gói"}
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

        {!!toast && (
          <View style={[styles.toast, { backgroundColor: toast.isError ? c.danger : c.primary }]}>
            <Feather name={toast.isError ? "alert-circle" : "check"} size={14} color="#fff" />
            <Text style={styles.toastText}>{toast.msg}</Text>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 18, fontWeight: "800" },
  sub: { fontSize: 11.5, marginTop: 2 },
  error: { fontSize: 12.5, marginHorizontal: 22, marginTop: 8, fontWeight: "700" },
  empty: { fontSize: 13, marginTop: 12 },
  row: { paddingVertical: 13 },
  rowTitle: { fontSize: 13.5, fontWeight: "700" },
  rowMeta: { fontSize: 11.5, marginTop: 3, lineHeight: 17 },
  debt: { fontSize: 11.5, fontWeight: "700", marginTop: 4 },
  status: { fontSize: 12, fontWeight: "700", marginLeft: 8 },
  actionLink: { fontSize: 11.5, fontWeight: "700" },
  fab: {
    position: "absolute",
    right: 22,
    bottom: 20,
    borderRadius: 999,
    paddingVertical: 13,
    paddingHorizontal: 18,
    shadowColor: "#000",
    shadowOpacity: 0.14,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
  fabText: { fontSize: 13, fontWeight: "800" },
  sheetLabel: { marginTop: 12 },
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
