import { useState, useEffect, useRef } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import FormSheet from "./FormSheet";
import AttendanceToggle from "./AttendanceToggle";
import AppButton from "./AppButton";
import { api } from "../api/client";
import { useTheme } from "../theme";

// Danh sách khách đã đặt của 1 buổi — lớp Group (classId) HOẶC khung PT (slotId).
// her-20: quầy điểm danh + hủy lịch NGAY TRONG danh sách này (xác nhận hủy inline,
// không mở chồng sheet — góp ý 16/08). Server tự phân quyền: HLV chỉ xem buổi mình
// + KHÔNG nhận SĐT khách (B15/B16).
export default function RosterSheet({ classId, slotId, onClose, canClear = false, canCancel = false, onChanged }) {
  const { c } = useTheme();
  const [data, setData] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [confirmCancelId, setConfirmCancelId] = useState(null); // bookingId đang chờ xác nhận hủy
  const [busy, setBusy] = useState(false);

  const targetId = classId || slotId;
  const rosterPath = classId
    ? `/management/classes/${classId}/roster`
    : `/management/pt-slots/${slotId}/roster`;
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
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetId]);

  // Lớp trả data.class (name), khung PT trả data.slot (title) — gom về 1 mối
  const info = data ? (data.class || data.slot) : null;
  const title = info ? `${info.name || info.title} · ${data.customers.length} khách` : "Danh sách khách";

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
                {k.status === "no_show" && <Text style={[styles.stateTxt, { color: c.danger }]}>Không đến</Text>}
                {k.status === "completed" && <Text style={[styles.stateTxt, { color: c.success }]}>Đã đến</Text>}
              </View>
              {/* Điểm danh (mục 5): server phân quyền & chặn giờ */}
              <AttendanceToggle
                bookingId={k.bookingId}
                status={k.status}
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
});
