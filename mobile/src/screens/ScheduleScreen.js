import { useState, useCallback } from "react";
import { View, Text, ScrollView, StyleSheet, RefreshControl } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import TopBar from "../components/TopBar";
import Pill from "../components/Pill";
import AppButton from "../components/AppButton";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { COLORS } from "../theme";

function hoursUntil(dateStr) {
  return (new Date(dateStr).getTime() - Date.now()) / 3_600_000;
}
function fmtDateTime(d) {
  return new Date(d).toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}
const STATUS_LABEL = { completed: "Đã tập", cancelled: "Đã hủy", no_show: "Không đến", booked: "Đã đặt" };

export default function ScheduleScreen() {
  // Số giờ tối thiểu để tự hủy lấy từ server (MIN_CANCEL_HOURS) — không ghi cứng ở app
  const { config } = useAuth();
  const minCancelHours = config?.minCancelHours ?? 3;
  const [bookings, setBookings] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [confirmId, setConfirmId] = useState(null);
  const [busy, setBusy] = useState(false); // chặn bấm đúp nút hủy
  const [errorMsg, setErrorMsg] = useState("");

  const load = useCallback(async () => {
    setLoading(true); // để RefreshControl hiện spinner đúng lúc kéo làm mới
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
      style={{ flex: 1, backgroundColor: COLORS.bg }}
      contentContainerStyle={{ paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={COLORS.ink} />}
    >
      <TopBar title="Lịch của tôi" sub={`Hủy lịch cần trước giờ tập tối thiểu ${minCancelHours} tiếng`} />

      {!!errorMsg && <Text style={styles.errorText}>{errorMsg}</Text>}

      <Text style={styles.sectionTitle}>Sắp tới ({bookings.length})</Text>
      <View style={{ marginHorizontal: 20, gap: 10, marginBottom: 22 }}>
        {bookings.length === 0 && !loading && (
          <Text style={{ color: COLORS.inkSoft, fontSize: 13 }}>Chưa có lịch tập nào.</Text>
        )}
        {bookings.map((b) => {
          const locked = hoursUntil(b.startAt) < minCancelHours;
          return (
            <View key={b.id} style={styles.card}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{b.title}</Text>
                  <Text style={styles.cardMeta}>{b.coach} · {fmtDateTime(b.startAt)}</Text>
                </View>
                <Pill tone={b.type === "pt" ? "brass" : "taupe"}>{b.type === "pt" ? "PT 1:1" : "Group"}</Pill>
              </View>

              <View style={{ marginTop: 10 }}>
                {locked ? (
                  <View style={styles.lockedBox}>
                    <Feather name="lock" size={13} color={COLORS.inkSoft} />
                    <Text style={styles.lockedText}>
                      Còn dưới {minCancelHours} giờ — không thể tự hủy. Vui lòng liên hệ lễ tân.
                    </Text>
                  </View>
                ) : confirmId === b.id ? (
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <View style={{ flex: 1 }}>
                      <AppButton variant="outline" onPress={() => setConfirmId(null)}>
                        Giữ lịch
                      </AppButton>
                    </View>
                    <View style={{ flex: 1 }}>
                      <AppButton
                        disabled={busy}
                        onPress={() => cancel(b.id)}
                        icon={<Feather name="x" size={14} color="#fff" style={{ marginRight: 2 }} />}
                      >
                        Xác nhận hủy
                      </AppButton>
                    </View>
                  </View>
                ) : (
                  <AppButton
                    variant="outline"
                    onPress={() => setConfirmId(b.id)}
                    icon={<Feather name="x" size={14} color={COLORS.ink} style={{ marginRight: 2 }} />}
                  >
                    Hủy lịch
                  </AppButton>
                )}
              </View>
            </View>
          );
        })}
      </View>

      <Text style={styles.sectionTitle}>Lịch sử tập luyện</Text>
      <View style={{ marginHorizontal: 20, gap: 8 }}>
        {history.length === 0 && !loading && (
          <Text style={{ color: COLORS.inkSoft, fontSize: 13 }}>Chưa có lịch sử.</Text>
        )}
        {history.map((h) => (
          <View key={h.id} style={styles.historyRow}>
            <View>
              <Text style={{ fontSize: 13, fontWeight: "700", color: COLORS.ink }}>{h.title}</Text>
              <Text style={{ fontSize: 11.5, color: COLORS.inkSoft }}>{h.coach} · {fmtDateTime(h.startAt)}</Text>
            </View>
            <Pill tone={h.status === "cancelled" ? "danger" : "taupe"}>{STATUS_LABEL[h.status] || h.status}</Pill>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  errorText: { marginHorizontal: 20, marginBottom: 10, color: COLORS.ink, fontSize: 12.5 },
  sectionTitle: { marginHorizontal: 20, marginTop: 4, marginBottom: 8, fontSize: 13, fontWeight: "800", color: COLORS.ink },
  card: { backgroundColor: COLORS.card, borderRadius: 16, padding: 14 },
  cardTitle: { fontWeight: "800", fontSize: 14, color: COLORS.ink },
  cardMeta: { fontSize: 12, color: COLORS.inkSoft, marginTop: 3 },
  lockedBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#F1EEE7",
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  lockedText: { fontSize: 12, color: COLORS.inkSoft, flex: 1 },
  historyRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: COLORS.card,
    borderRadius: 14,
    paddingVertical: 11,
    paddingHorizontal: 14,
  },
});
