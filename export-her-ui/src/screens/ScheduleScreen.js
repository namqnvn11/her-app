import { useState, useCallback } from "react";
import { View, Text, ScrollView, StyleSheet, RefreshControl } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import TopBar from "../components/TopBar";
import SectionLabel from "../components/SectionLabel";
import TimeRow from "../components/TimeRow";
import AppButton from "../components/AppButton";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../theme";

function hoursUntil(dateStr) {
  return (new Date(dateStr).getTime() - Date.now()) / 3600000;
}
function fmtTime(d) {
  return new Date(d).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
}
function fmtDay(d) {
  return new Date(d).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" });
}
const STATUS_LABEL = { completed: "Đã tập", cancelled: "Đã hủy", no_show: "Không đến", booked: "Đã đặt" };

export default function ScheduleScreen() {
  // Số giờ tối thiểu để tự hủy lấy từ server (MIN_CANCEL_HOURS) — không ghi cứng ở app
  const { config } = useAuth();
  const { c } = useTheme();
  const minCancelHours = config?.minCancelHours ?? 3;
  const [bookings, setBookings] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [confirmId, setConfirmId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setErrorMsg("");
      const [upcomingRes, historyRes] = await Promise.all([api.get("/me/bookings"), api.get("/me/history")]);
      setBookings(upcomingRes.bookings);
      setHistory(historyRes.bookings);
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const cancel = async (id) => {
    if (busy) return;
    setBusy(true);
    try {
      await api.delete(`/bookings/${id}`);
      setConfirmId(null);
      load();
    } catch (err) {
      setErrorMsg(err.message);
      setConfirmId(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.bg }}
      contentContainerStyle={{ paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={c.primary} />}
    >
      <TopBar title="Lịch của tôi" sub={`Tự hủy khi còn tối thiểu ${minCancelHours} tiếng trước giờ tập`} />

      <View style={{ paddingHorizontal: 22 }}>
        {!!errorMsg && <Text style={[styles.error, { color: c.primary }]}>{errorMsg}</Text>}

        <SectionLabel>{`Sắp tới · ${bookings.length}`}</SectionLabel>
        {bookings.length === 0 && !loading && (
          <Text style={[styles.empty, { color: c.inkSoft }]}>Chưa có lịch tập nào.</Text>
        )}
        {bookings.map((b, i) => {
          const locked = hoursUntil(b.startAt) < minCancelHours;
          return (
            <TimeRow
              key={b.id}
              time={fmtTime(b.startAt)}
              sub={fmtDay(b.startAt)}
              title={b.title}
              meta={`${b.coach} · ${b.type === "pt" ? "PT 1:1" : "Group"}`}
              last={i === bookings.length - 1}
              right={
                !locked && confirmId !== b.id ? (
                  <AppButton variant="outline" style={styles.smallBtn} onPress={() => setConfirmId(b.id)}>
                    Hủy
                  </AppButton>
                ) : null
              }
            >
              {locked ? (
                <View style={[styles.locked, { backgroundColor: c.primarySoft }]}>
                  <Text style={[styles.lockedText, { color: c.inkSoft }]}>
                    Còn dưới {minCancelHours} giờ — liên hệ lễ tân để hủy.
                  </Text>
                </View>
              ) : confirmId === b.id ? (
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <AppButton variant="ghost" onPress={() => setConfirmId(null)}>
                      Giữ lịch
                    </AppButton>
                  </View>
                  <View style={{ flex: 1 }}>
                    <AppButton disabled={busy} onPress={() => cancel(b.id)}>
                      Xác nhận hủy
                    </AppButton>
                  </View>
                </View>
              ) : null}
            </TimeRow>
          );
        })}

        <SectionLabel>Lịch sử</SectionLabel>
        {history.length === 0 && !loading && (
          <Text style={[styles.empty, { color: c.inkSoft }]}>Chưa có lịch sử.</Text>
        )}
        {history.map((h, i) => (
          <TimeRow
            key={h.id}
            time={fmtTime(h.startAt)}
            sub={fmtDay(h.startAt)}
            title={h.title}
            meta={h.coach}
            last={i === history.length - 1}
            right={
              <Text
                style={{
                  fontSize: 11,
                  fontWeight: "700",
                  color: h.status === "cancelled" ? c.primary : c.success,
                }}
              >
                {STATUS_LABEL[h.status] || h.status}
              </Text>
            }
          />
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  error: { fontSize: 12.5, marginTop: 14, fontWeight: "700" },
  empty: { fontSize: 13, marginTop: 12 },
  smallBtn: { paddingVertical: 7, paddingHorizontal: 13 },
  locked: { borderRadius: 10, paddingVertical: 9, paddingHorizontal: 11 },
  lockedText: { fontSize: 11.5, lineHeight: 17 },
});
