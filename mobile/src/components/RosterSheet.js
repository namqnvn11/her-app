import { useState, useEffect, useRef } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from "react-native";
import FormSheet from "./FormSheet";
import AttendanceToggle from "./AttendanceToggle";
import AppButton from "./AppButton";
import { api } from "../api/client";
import { useTheme } from "../theme";

// Danh sách khách đã đặt của 1 buổi (her-35: MỌI buổi đều là lớp, kể cả 1:1 — chỉ còn classId).
// her-20: quầy điểm danh + hủy lịch NGAY TRONG danh sách này (xác nhận hủy inline,
// không mở chồng sheet — góp ý 16/08). Server tự phân quyền: HLV chỉ xem buổi mình
// + KHÔNG nhận SĐT khách (B15/B16).
// her-39 (20/08): canAdd = quầy ĐẶT LỊCH HỘ — thêm học viên vào buổi ngay tại đây
// (POST /bookings kèm userId). HLV truyền false; server vẫn chặn thật (H5/C1).
const MAX_SUGGEST = 8; // gợi ý ngắn — quầy gõ thêm vài ký tự là ra đúng người

// Bỏ dấu + hạ chữ thường để tìm "duc" ra "Đức" (cùng cách her-22)
const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d");

export default function RosterSheet({ classId, onClose, canClear = false, canCancel = false, canAdd = false, onChanged }) {
  const { c } = useTheme();
  const [data, setData] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [confirmCancelId, setConfirmCancelId] = useState(null); // bookingId đang chờ xác nhận hủy
  const [busy, setBusy] = useState(false);
  // her-39: khối "thêm học viên" — mở/đóng, ô tìm, danh sách khách (tải 1 lần khi mở)
  const [adding, setAdding] = useState(false);
  const [customers, setCustomers] = useState(null);
  const [query, setQuery] = useState("");

  const targetId = classId;
  const rosterPath = `/management/classes/${classId}/roster`;
  // Buổi ĐANG mở — so trong callback để response buổi cũ về muộn không đè buổi mới
  // (review her-20 V1: so const trong cùng closure là luôn-đúng, phải so qua ref)
  const shownId = useRef(null);

  const load = () => {
    if (!targetId) return;
    const id = targetId;
    api
      .get(rosterPath)
      .then((res) => { if (id === shownId.current) setData(res); })
      .catch((err) => { if (id === shownId.current) setErrorMsg(err.message); });
  };

  useEffect(() => {
    shownId.current = targetId || null;
    if (!targetId) return;
    setData(null);
    setErrorMsg("");
    setConfirmCancelId(null);
    setAdding(false);
    setQuery("");
    setCustomers(null); // danh sách hợp lệ khác nhau theo TỪNG buổi — không dùng lại của buổi trước
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetId]);

  const info = data ? data.class : null;
  const title = info ? `${info.name} · ${data.customers.length} khách` : "Danh sách khách";
  const hasSpot = !!info && info.spotsLeft > 0;

  // her-39: danh sách học viên để chọn — server đã lọc sẵn CHỈ khách CÓ GÓI DÙNG ĐƯỢC cho
  // đúng buổi này (và bỏ khách đã có trong buổi, khách bị khoá). Không đổ cả danh sách rồi
  // để quầy chọn xong mới báo "chưa có gói".
  const openAdd = async () => {
    setAdding(true);
    setErrorMsg("");
    if (customers) return;
    try {
      const res = await api.get(`/management/classes/${targetId}/eligible-customers`);
      setCustomers(res.customers || []);
    } catch (err) {
      setErrorMsg(err.message);
      setAdding(false);
    }
  };

  const words = norm(query.trim()).split(/\s+/).filter(Boolean);
  const suggestions = !customers
    ? []
    : customers
        .filter((u) => {
          if (!words.length) return true;
          const hay = `${norm(u.name)} ${norm(u.phone)}`;
          return words.every((w) => hay.includes(w));
        })
        .slice(0, MAX_SUGGEST);

  const addCustomer = async (u) => {
    if (busy) return;
    setBusy(true);
    try {
      setErrorMsg("");
      // Server giữ nguyên mọi luật cho KHÁCH được đặt (gói, trùng lịch, sức chứa)
      await api.post("/bookings", { classId: targetId, userId: u.id });
      setQuery("");
      // Đặt xong thì khách đó hết "đủ điều kiện" cho buổi này — bỏ khỏi gợi ý ngay
      setCustomers((prev) => (prev || []).filter((x) => String(x.id) !== String(u.id)));
      load();
      onChanged?.();
    } catch (err) {
      setErrorMsg(err.message); // nguyên văn lý do từ server (C6): hết gói, trùng giờ...
    } finally {
      setBusy(false);
    }
  };

  const cancelBooking = async (bookingId) => {
    if (busy) return;
    setBusy(true);
    try {
      setErrorMsg("");
      await api.delete(`/bookings/${bookingId}`);
      setConfirmCancelId(null);
      load();
      onChanged?.(); // danh sách ngoài màn cập nhật theo (chỗ trống, số khách)
    } catch (err) {
      setErrorMsg(err.message);
      setConfirmCancelId(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormSheet visible={!!targetId} title={title} onClose={onClose}>
      {!!errorMsg && <Text style={[styles.error, { color: c.danger }]}>{errorMsg}</Text>}
      {!errorMsg && !data && <Text style={[styles.empty, { color: c.inkSoft }]}>Đang tải...</Text>}
      {data && data.customers.length === 0 && (
        <Text style={[styles.empty, { color: c.inkSoft }]}>Chưa có khách đặt buổi này.</Text>
      )}
      {data &&
        data.customers.map((k, i) => (
          <View
            key={k.bookingId}
            style={[styles.row, i !== data.customers.length - 1 && { borderBottomWidth: 1, borderBottomColor: c.hairline }]}
          >
            <View style={styles.head}>
              <View style={[styles.avatar, { backgroundColor: c.primaryTint }]}>
                <Text style={[styles.avatarText, { color: c.primary }]}>
                  {(k.name || "?").slice(0, 1).toUpperCase()}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.name, { color: c.ink }]}>{k.name}</Text>
                {/* HLV không nhận field phone từ server — dòng này tự ẩn */}
                {!!k.phone && <Text style={[styles.phone, { color: c.inkSoft }]}>{k.phone}</Text>}
                {/* her-40 (20/08): "Đã đến" CHỈ khi có điểm danh THẬT (attendanceAt). Buổi qua giờ
                    được hệ thống tự chuyển "đã tập" (sweep) mang status completed nhưng
                    attendanceAt = null — chưa ai điểm danh, không tính hoa hồng (her-10) —
                    nên chỉ ghi trung tính, quầy/HLV còn bấm Đến/Vắng để điểm danh bù.
                    "Không đến" luôn do người bấm nên luôn có attendanceAt. */}
                {k.status === "no_show" && <Text style={[styles.stateTxt, { color: c.danger }]}>Không đến</Text>}
                {k.status === "completed" && (
                  k.attendanceAt ? (
                    <Text style={[styles.stateTxt, { color: c.success }]}>Đã đến</Text>
                  ) : (
                    <Text style={[styles.stateTxt, { color: c.inkSoft }]}>Chưa điểm danh</Text>
                  )
                )}
              </View>
              {/* Điểm danh (mục 5): server phân quyền & chặn giờ */}
              <AttendanceToggle
                bookingId={k.bookingId}
                status={k.status}
                attendanceAt={k.attendanceAt}
                startAt={info?.startAt}
                canClear={canClear}
                onChanged={() => { load(); onChanged?.(); }}
                onError={(msg) => setErrorMsg(msg)}
              />
            </View>
            {/* Hủy lịch (quầy) — xác nhận NGAY TRONG dòng, không mở chồng sheet */}
            {canCancel && k.status === "booked" && (
              confirmCancelId === k.bookingId ? (
                <View style={styles.confirmRow}>
                  <View style={{ flex: 1 }}>
                    <AppButton variant="ghost" disabled={busy} onPress={() => setConfirmCancelId(null)}>Giữ lịch</AppButton>
                  </View>
                  <View style={{ flex: 1 }}>
                    <AppButton disabled={busy} onPress={() => cancelBooking(k.bookingId)}>
                      {busy ? "Đang hủy..." : "Xác nhận hủy"}
                    </AppButton>
                  </View>
                </View>
              ) : (
                <TouchableOpacity hitSlop={8} style={styles.cancelLink} onPress={() => setConfirmCancelId(k.bookingId)}>
                  <Text style={[styles.cancelText, { color: c.inkSoft }]}>Hủy lịch của khách này</Text>
                </TouchableOpacity>
              )
            )}
          </View>
        ))}

      {/* her-39: quầy thêm học viên vào buổi ngay tại đây (đặt hộ) */}
      {canAdd && !!data && (
        hasSpot ? (
          !adding ? (
            <TouchableOpacity hitSlop={8} style={styles.addLink} onPress={openAdd}>
              <Text style={[styles.addText, { color: c.primary }]}>＋ Thêm học viên</Text>
            </TouchableOpacity>
          ) : (
            <View style={[styles.addBox, { borderTopColor: c.hairline }]}>
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Tìm theo tên hoặc số điện thoại"
                placeholderTextColor={c.inkSoft}
                autoFocus
                style={[styles.addInput, { borderBottomColor: c.line, color: c.ink }]}
              />
              {!customers && <Text style={[styles.empty, { color: c.inkSoft }]}>Đang tải danh sách học viên...</Text>}
              {!!customers && customers.length === 0 && (
                <Text style={[styles.empty, { color: c.inkSoft }]}>
                  Không có học viên nào có gói phù hợp buổi này.
                </Text>
              )}
              {!!customers && customers.length > 0 && suggestions.length === 0 && (
                <Text style={[styles.empty, { color: c.inkSoft }]}>Không tìm thấy học viên phù hợp.</Text>
              )}
              {suggestions.map((u) => (
                <TouchableOpacity
                  key={u.id}
                  disabled={busy}
                  style={[styles.pickRow, { borderBottomColor: c.hairline }]}
                  onPress={() => addCustomer(u)}
                >
                  <Text style={[styles.name, { color: c.ink }]}>{u.name}</Text>
                  <Text style={[styles.phone, { color: c.inkSoft }]}>{u.phone}</Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity hitSlop={8} style={styles.addLink} onPress={() => { setAdding(false); setQuery(""); }}>
                <Text style={[styles.addText, { color: c.inkSoft }]}>Đóng</Text>
              </TouchableOpacity>
            </View>
          )
        ) : (
          <Text style={[styles.empty, { color: c.inkSoft }]}>Buổi đã đầy chỗ.</Text>
        )
      )}
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  error: { fontSize: 12.5, fontWeight: "700", marginTop: 4 },
  empty: { fontSize: 13, marginTop: 6 },
  row: { paddingVertical: 11 },
  head: { flexDirection: "row", alignItems: "center", gap: 12 },
  avatar: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 13, fontWeight: "800" },
  name: { fontSize: 13.5, fontWeight: "700" },
  phone: { fontSize: 11.5, marginTop: 1 },
  stateTxt: { fontSize: 11, fontWeight: "700", marginTop: 2 },
  confirmRow: { flexDirection: "row", gap: 8, marginTop: 10, marginLeft: 46 },
  cancelLink: { marginTop: 8, marginLeft: 46, alignSelf: "flex-start" },
  cancelText: { fontSize: 11.5, fontWeight: "700", textDecorationLine: "underline" },
  // her-39: khối thêm học viên
  addLink: { marginTop: 12, alignSelf: "flex-start" },
  addText: { fontSize: 12.5, fontWeight: "800" },
  addBox: { borderTopWidth: 1, marginTop: 12, paddingTop: 10 },
  addInput: { borderBottomWidth: 1.5, paddingVertical: 8, fontSize: 14.5 },
  pickRow: { paddingVertical: 10, borderBottomWidth: 1 },
});
