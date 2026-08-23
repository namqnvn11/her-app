import { useState, useCallback, useEffect, useRef } from "react";
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl, ActivityIndicator } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import TopBar from "../components/TopBar";
import SectionLabel from "../components/SectionLabel";
import TimeRow from "../components/TimeRow";
import AppButton from "../components/AppButton";
import { api } from "../api/client";
import { syncReminders } from "../utils/reminders";
import { classTitle } from "../utils/displayName";
import { dayLabelOrToday } from "../utils/dayLabel";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../theme";

function hoursUntil(dateStr) {
  return (new Date(dateStr).getTime() - Date.now()) / 3600000;
}
function fmtTime(d) {
  return new Date(d).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
}
const STATUS_LABEL = { completed: "Đã tập", cancelled: "Đã hủy", no_show: "Không đến", booked: "Đã đặt" };

export default function ScheduleScreen() {
  // Số giờ tối thiểu để tự hủy lấy từ server (admin cài trong Cài đặt — her-47) — không ghi cứng ở app.
  // Chưa nhận được config thì KHÔNG đoán số: không khoá nút, không hiện câu nhắc (server vẫn chặn đúng luật).
  const { config, refreshMe } = useAuth();
  const { c } = useTheme();
  const minCancelHours = typeof config?.minCancelHours === "number" ? config.minCancelHours : null;
  const cancelSub =
    minCancelHours == null ? undefined
      : minCancelHours === 0 ? "Tự hủy được tới trước giờ tập"
      : `Tự hủy khi còn tối thiểu ${minCancelHours} tiếng trước giờ tập`;
  const lockedMeta = minCancelHours === 0
    ? "Đã qua giờ tập — liên hệ lễ tân để hủy."
    : `Còn dưới ${minCancelHours} giờ — liên hệ lễ tân để hủy.`;
  const [bookings, setBookings] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  // her-28: lịch sử tải DẦN 20 dòng/lần — cuộn cuối tự nạp (server hết cắt cứng 50 dòng)
  const [histPage, setHistPage] = useState(1);
  const [histHasMore, setHistHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  // her-37: mục Lịch sử gập/mở — mặc định ĐÓNG mỗi lần vào màn, đóng thì không gọi /me/history
  const [histOpen, setHistOpen] = useState(false);
  const [histLoading, setHistLoading] = useState(false);
  const histOpenRef = useRef(false);
  const histLoaded = useRef(false);
  const loadSeq = useRef(0);
  const histSeq = useRef(0);
  const endReached = useRef(false);
  const scrollRef = useRef(null);
  const viewH = useRef(0);
  const contentH = useRef(0);
  // Tự-lấp lỗi 2 lần liên tiếp thì dừng — chờ thao tác tay (review her-28 #1)
  const autoFillFails = useRef(0);
  const [confirmId, setConfirmId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  // Tải lại lịch sử từ trang 1 — chỉ gọi khi mục Lịch sử đang MỞ (her-37)
  const loadHistory = useCallback(async () => {
    const seq = ++histSeq.current;
    setHistLoading(true);
    try {
      const res = await api.get("/me/history", { limit: 20, page: 1 });
      if (seq !== histSeq.current) return;
      setHistory(res.bookings);
      setHistHasMore(!!res.hasMore);
      setHistPage(1);
      histLoaded.current = true;
      endReached.current = false;
      autoFillFails.current = 0;
    } catch (err) {
      if (seq === histSeq.current) { setErrorMsg(err.message); autoFillFails.current += 1; }
    } finally {
      if (seq === histSeq.current) { setHistLoading(false); setLoadingMore(false); }
    }
  }, []);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    setLoading(true);
    try {
      setErrorMsg("");
      // her-47: admin có thể vừa đổi số giờ hủy — mỗi lần tải lịch làm mới luôn config (song song,
      // lỗi của /me không chặn danh sách; câu nhắc giữ số cũ tới lần tải sau)
      const [upcomingRes] = await Promise.all([
        api.get("/me/bookings"),
        refreshMe().catch((err) => console.warn("[schedule] không làm mới được config:", err?.message)),
      ]);
      if (seq !== loadSeq.current) return;
      // Mục 9: đặt lại nhắc-1-tiếng theo lịch mới nhất (no-op trên web)
      syncReminders((upcomingRes.bookings || []).filter((b) => b.status === "booked"));
      setBookings(upcomingRes.bookings);
    } catch (err) {
      if (seq === loadSeq.current) setErrorMsg(err.message);
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
    if (histOpenRef.current) loadHistory();
  }, [loadHistory, refreshMe]);

  const toggleHistory = useCallback(() => {
    const next = !histOpenRef.current;
    histOpenRef.current = next;
    setHistOpen(next);
    // Lần đầu mở mới tải trang 1; đóng rồi mở lại giữ nguyên dữ liệu đã tải
    if (next && !histLoaded.current && !histLoading) loadHistory();
  }, [loadHistory, histLoading]);

  // Trang lịch sử kế tiếp — append có dedupe theo id (chống lặp khi dữ liệu đổi giữa 2 trang)
  const loadMoreHistory = useCallback(async () => {
    const seq = ++histSeq.current;
    setLoadingMore(true);
    try {
      const res = await api.get("/me/history", { limit: 20, page: histPage + 1 });
      if (seq !== histSeq.current) return;
      setHistory((prev) => {
        const seen = new Set(prev.map((b) => String(b.id)));
        return [...prev, ...res.bookings.filter((b) => !seen.has(String(b.id)))];
      });
      setHistHasMore(!!res.hasMore);
      setHistPage((p) => p + 1);
      endReached.current = false;
      autoFillFails.current = 0;
    } catch (err) {
      if (seq === histSeq.current) { setErrorMsg(err.message); autoFillFails.current += 1; }
    } finally {
      if (seq === histSeq.current) setLoadingMore(false);
    }
  }, [histPage]);

  // Màn chưa đầy mà còn lịch sử → tự nạp tiếp đến khi cuộn được (RN-web không bắn
  // onLayout/onContentSizeChange của ScrollView — đọc thẳng DOM trên web)
  useEffect(() => {
    // her-37: mục Lịch sử đang ĐÓNG thì không tự nạp gì cả
    if (!histOpen || !histLoaded.current) return;
    if (loading || histLoading || loadingMore || !histHasMore) return;
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
  }, [loading, histLoading, loadingMore, histHasMore, histPage, histOpen]);

  useFocusEffect(
    useCallback(() => {
      // Mỗi lần vào màn: mục Lịch sử về mặc định ĐÓNG, dữ liệu cũ bỏ đi (her-37)
      histOpenRef.current = false;
      histLoaded.current = false;
      histSeq.current += 1; // huỷ mọi lượt tải lịch sử còn dở
      setHistOpen(false);
      setHistory([]);
      setHistPage(1);
      setHistHasMore(false);
      setHistLoading(false);
      setLoadingMore(false);
      endReached.current = false;
      autoFillFails.current = 0;
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
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={c.accent} />}
      scrollEventThrottle={100}
      onScroll={({ nativeEvent: { layoutMeasurement, contentOffset, contentSize } }) => {
        if (!histOpen) return; // đóng thì không tự nạp thêm lịch sử
        if (contentSize.height <= layoutMeasurement.height || contentOffset.y <= 0) return;
        const nearBottom = layoutMeasurement.height + contentOffset.y >= contentSize.height - 400;
        if (!nearBottom) { endReached.current = false; return; }
        if (endReached.current || loading || histLoading || loadingMore || !histHasMore) return;
        endReached.current = true;
        loadMoreHistory();
      }}
      onLayout={(e) => { viewH.current = e.nativeEvent.layout.height; }}
      onContentSizeChange={(w, h) => { contentH.current = h; }}
    >
      <TopBar title="Lịch của tôi" sub={cancelSub} />

      <View style={{ paddingHorizontal: 22 }}>
        {!!errorMsg && <Text style={[styles.error, { color: c.danger }]}>{errorMsg}</Text>}

        <SectionLabel>{`Sắp tới · ${bookings.length}`}</SectionLabel>
        {bookings.length === 0 && !loading && (
          <Text style={[styles.empty, { color: c.inkSoft }]}>Chưa có lịch tập nào.</Text>
        )}
        {bookings.map((b, i) => {
          const locked = minCancelHours != null && hoursUntil(b.startAt) < minCancelHours;
          return (
            <TimeRow
              key={b.id}
              time={fmtTime(b.startAt)}
              sub={dayLabelOrToday(b.startAt)}
              // her-38: dòng đậm thống nhất — loại hình đã lên dòng đậm nên bỏ khỏi meta.
              // Câu nhắc sát giờ đi vào meta để nằm ngay dưới dòng đậm (children đệm xa hơn).
              title={classTitle(b)}
              meta={
                b.status === "booked" && locked
                  ? lockedMeta
                  : null
              }
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
              {b.status !== "booked" || locked ? null : confirmId === b.id ? (
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

        <TouchableOpacity activeOpacity={0.7} onPress={toggleHistory} style={styles.histHeader}>
          <SectionLabel style={{ marginTop: 0, marginBottom: 0 }}>Lịch sử</SectionLabel>
          <Feather name={histOpen ? "chevron-up" : "chevron-down"} size={16} color={c.inkSoft} />
        </TouchableOpacity>

        {histOpen && (
          <>
            {histLoading && history.length === 0 && (
              <ActivityIndicator style={{ marginTop: 14 }} color={c.accent} />
            )}
            {history.length === 0 && !histLoading && (
              <Text style={[styles.empty, { color: c.inkSoft }]}>Chưa có lịch sử.</Text>
            )}
            {history.map((h, i) => (
              <TimeRow
                key={h.id}
                time={fmtTime(h.startAt)}
                sub={dayLabelOrToday(h.startAt)}
                title={classTitle(h)}
                last={i === history.length - 1}
                right={
                  <Text
                    style={{
                      fontSize: 11,
                      fontWeight: "700",
                      color: c.accent,
                    }}
                  >
                    {STATUS_LABEL[h.status] || h.status}
                  </Text>
                }
              />
            ))}
            {loadingMore && <ActivityIndicator style={{ marginTop: 16 }} color={c.accent} />}
          </>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  error: { fontSize: 12.5, marginTop: 14, fontWeight: "700" },
  empty: { fontSize: 13, marginTop: 12 },
  smallBtn: { paddingVertical: 7, paddingHorizontal: 13 },
  histHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 20, marginBottom: 2, paddingVertical: 6 },
});
