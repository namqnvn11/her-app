import { useState, useCallback, useEffect, useRef } from "react";
import { View, Text, ScrollView, StyleSheet, RefreshControl, ActivityIndicator } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import TopBar from "../components/TopBar";
import SectionLabel from "../components/SectionLabel";
import TimeRow from "../components/TimeRow";
import AppButton from "../components/AppButton";
import { api } from "../api/client";
import { syncReminders } from "../utils/reminders";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../theme";

function hoursUntil(dateStr) {
  return (new Date(dateStr).getTime() - Date.now()) / 3600000;
}
function fmtTime(d) {
  return new Date(d).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
}
function fmtDay(d) {
  const date = new Date(d);
  if (date.toDateString() === new Date().toDateString()) return "hôm nay";
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}`;
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
  // her-28: lịch sử tải DẦN 20 dòng/lần — cuộn cuối tự nạp (server hết cắt cứng 50 dòng)
  const [histPage, setHistPage] = useState(1);
  const [histHasMore, setHistHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadSeq = useRef(0);
  const endReached = useRef(false);
  const scrollRef = useRef(null);
  const viewH = useRef(0);
  const contentH = useRef(0);
  // Tự-lấp lỗi 2 lần liên tiếp thì dừng — chờ thao tác tay (review her-28 #1)
  const autoFillFails = useRef(0);
  const [confirmId, setConfirmId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    setLoading(true);
    try {
      setErrorMsg("");
      const [upcomingRes, historyRes] = await Promise.all([
        api.get("/me/bookings"),
        api.get("/me/history", { limit: 20, page: 1 }),
      ]);
      if (seq !== loadSeq.current) return;
      // Mục 9: đặt lại nhắc-1-tiếng theo lịch mới nhất (no-op trên web)
      syncReminders((upcomingRes.bookings || []).filter((b) => b.status === "booked"));
      setBookings(upcomingRes.bookings);
      setHistory(historyRes.bookings);
      setHistHasMore(!!historyRes.hasMore);
      setHistPage(1);
      endReached.current = false;
      autoFillFails.current = 0;
    } catch (err) {
      if (seq === loadSeq.current) { setErrorMsg(err.message); autoFillFails.current += 1; }
    } finally {
      if (seq === loadSeq.current) { setLoading(false); setLoadingMore(false); }
    }
  }, []);

  // Trang lịch sử kế tiếp — append có dedupe theo id (chống lặp khi dữ liệu đổi giữa 2 trang)
  const loadMoreHistory = useCallback(async () => {
    const seq = ++loadSeq.current;
    setLoadingMore(true);
    try {
      const res = await api.get("/me/history", { limit: 20, page: histPage + 1 });
      if (seq !== loadSeq.current) return;
      setHistory((prev) => {
        const seen = new Set(prev.map((b) => String(b.id)));
        return [...prev, ...res.bookings.filter((b) => !seen.has(String(b.id)))];
      });
      setHistHasMore(!!res.hasMore);
      setHistPage((p) => p + 1);
      endReached.current = false;
      autoFillFails.current = 0;
    } catch (err) {
      if (seq === loadSeq.current) { setErrorMsg(err.message); autoFillFails.current += 1; }
    } finally {
      if (seq === loadSeq.current) setLoadingMore(false);
    }
  }, [histPage]);

  // Màn chưa đầy mà còn lịch sử → tự nạp tiếp đến khi cuộn được (RN-web không bắn
  // onLayout/onContentSizeChange của ScrollView — đọc thẳng DOM trên web)
  useEffect(() => {
    if (loading || loadingMore || !histHasMore) return;
    if (autoFillFails.current >= 2) return;
    let ch = contentH.current;
    let vh = viewH.current;
    const node = scrollRef.current?.getScrollableNode?.();
    if (node && typeof node.scrollHeight === "number") {
      ch = node.scrollHeight;
      vh = node.clientHeight;
    }
    if (ch > vh + 40) return;
    loadMoreHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, loadingMore, histHasMore, histPage]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const cancel = async (id) => {
    if (busy) return; // chặn bấm đúp hủy
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
      ref={scrollRef}
      style={{ flex: 1, backgroundColor: c.bg }}
      contentContainerStyle={{ paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={c.primary} />}
      scrollEventThrottle={100}
      onScroll={({ nativeEvent: { layoutMeasurement, contentOffset, contentSize } }) => {
        if (contentSize.height <= layoutMeasurement.height || contentOffset.y <= 0) return;
        const nearBottom = layoutMeasurement.height + contentOffset.y >= contentSize.height - 400;
        if (!nearBottom) { endReached.current = false; return; }
        if (endReached.current || loading || loadingMore || !histHasMore) return;
        endReached.current = true;
        loadMoreHistory();
      }}
      onLayout={(e) => { viewH.current = e.nativeEvent.layout.height; }}
      onContentSizeChange={(w, h) => { contentH.current = h; }}
    >
      <TopBar title="Lịch của tôi" sub={`Tự hủy khi còn tối thiểu ${minCancelHours} tiếng trước giờ tập`} />

      <View style={{ paddingHorizontal: 22 }}>
        {!!errorMsg && <Text style={[styles.error, { color: c.danger }]}>{errorMsg}</Text>}

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
                b.status !== "booked" ? (
                  // Buổi đã được điểm danh sớm (trước giờ) — hết hủy được, hiện trạng thái
                  <Text style={{ fontSize: 11, fontWeight: "700", color: b.status === "no_show" ? c.danger : c.success }}>
                    {STATUS_LABEL[b.status] || b.status}
                  </Text>
                ) : !locked && confirmId !== b.id ? (
                  <AppButton variant="outline" style={styles.smallBtn} onPress={() => setConfirmId(b.id)}>
                    Hủy
                  </AppButton>
                ) : null
              }
            >
              {b.status !== "booked" ? null : locked ? (
                <Text style={[styles.lockedText, { color: c.inkSoft }]}>
                  Còn dưới {minCancelHours} giờ — liên hệ lễ tân để hủy.
                </Text>
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
                  color: c.primary,
                }}
              >
                {STATUS_LABEL[h.status] || h.status}
              </Text>
            }
          />
        ))}
        {loadingMore && <ActivityIndicator style={{ marginTop: 16 }} color={c.primary} />}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  error: { fontSize: 12.5, marginTop: 14, fontWeight: "700" },
  empty: { fontSize: 13, marginTop: 12 },
  smallBtn: { paddingVertical: 7, paddingHorizontal: 13 },
  lockedText: { fontSize: 11.5, lineHeight: 17 },
});
