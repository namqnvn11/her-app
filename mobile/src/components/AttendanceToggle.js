import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../theme";

// Cặp nút điểm danh Đến/Vắng (mục 5) — dùng chung cho RosterSheet và dòng buổi PT.
// Chỉ hiện khi tới giờ (server cũng chặn); trạng thái đang chọn được tô đậm, bấm lại để sửa.
// Số phút mở trước giờ lấy từ config server (C5 — không ghi cứng ở app); 30 chỉ là dự phòng
// khi config chưa kịp về.
export function attendanceOpen(startAt, openBeforeMinutes = 30) {
  return Date.now() >= new Date(startAt).getTime() - openBeforeMinutes * 60 * 1000;
}

export default function AttendanceToggle({ bookingId, status, startAt, onChanged, onError, canClear = false }) {
  const { c } = useTheme();
  const { config } = useAuth();
  const [busy, setBusy] = useState(false);
  const openBefore = config?.attendanceOpenBeforeMinutes ?? 30;
  if (!attendanceOpen(startAt, openBefore) || status === "cancelled") return null;

  const marked = status === "completed" || status === "no_show";
  const mark = async (present) => {
    if (busy) return;
    setBusy(true);
    try {
      await api.patch(`/management/bookings/${bookingId}/attendance`, { present });
      onChanged?.();
    } catch (err) {
      onError?.(err.message);
    } finally {
      setBusy(false);
    }
  };

  const isPresent = status === "completed";
  const isAbsent = status === "no_show";
  return (
    <View style={styles.row}>
      <TouchableOpacity
        disabled={busy}
        onPress={() => mark(true)}
        style={[styles.btn, { borderColor: c.line }, isPresent && { backgroundColor: c.success, borderColor: c.success }]}
      >
        <Text style={[styles.txt, { color: isPresent ? "#fff" : c.ink }]}>Đến</Text>
      </TouchableOpacity>
      <TouchableOpacity
        disabled={busy}
        onPress={() => mark(false)}
        style={[styles.btn, { borderColor: c.line }, isAbsent && { backgroundColor: c.danger, borderColor: c.danger }]}
      >
        <Text style={[styles.txt, { color: isAbsent ? "#fff" : c.ink }]}>Vắng</Text>
      </TouchableOpacity>
      {/* Bỏ điểm danh (present:null) — chỉ quầy; buổi trở về "đã đặt" như chưa tích gì */}
      {canClear && marked && (
        <TouchableOpacity disabled={busy} onPress={() => mark(null)} style={[styles.btn, { borderColor: c.line }]}>
          <Text style={[styles.txt, { color: c.inkSoft }]}>Bỏ</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 8 },
  btn: { paddingVertical: 6, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1.5 },
  txt: { fontSize: 12, fontWeight: "700" },
});
