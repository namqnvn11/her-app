import { useState, useEffect, useCallback } from "react";
import { Modal, View, Text, ScrollView, StyleSheet, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import TopBar from "../components/TopBar";
import AppButton from "../components/AppButton";
import PullRefresh from "../components/PullRefresh";
import { api } from "../api/client";
import { useTheme } from "../theme";

// her-57: danh sách thông báo của admin / lễ tân / HLV ("*tên khách* đã đặt/hủy lịch ...").
// Mở màn = đã xem hết (server đánh dấu read-all); dòng nào lúc mở còn chưa đọc thì in đậm để
// người xem biết cái nào mới. Tải dần theo trang như các danh sách khác (her-28).
const PAGE = 30;
const pad = (n) => String(n).padStart(2, "0");
const fmt = (d) => {
  const x = new Date(d);
  return `${pad(x.getDate())}/${pad(x.getMonth() + 1)} ${pad(x.getHours())}:${pad(x.getMinutes())}`;
};

export default function NotificationsModal({ onClose }) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [freshIds, setFreshIds] = useState(new Set()); // chưa đọc tại thời điểm mở

  const load = useCallback(async (p = 1) => {
    if (p === 1) setLoading(true);
    try {
      setErrorMsg("");
      const r = await api.get("/notifications", { page: p, limit: PAGE });
      // Trang sau có thể lặp dòng đã có (thông báo mới chèn vào giữa lúc lật trang) — khử theo id
      setItems((prev) => {
        if (p === 1) return r.notifications;
        const have = new Set(prev.map((n) => n.id));
        return [...prev, ...r.notifications.filter((n) => !have.has(n.id))];
      });
      setHasMore(r.hasMore);
      setPage(p);
      if (p === 1) {
        setFreshIds(new Set(r.notifications.filter((n) => !n.readAt).map((n) => n.id)));
        // Chỉ đánh dấu tới cái mới nhất ĐÃ hiển thị — cái tới xen giữa vẫn còn "mới" cho lần mở sau
        if (r.unread > 0) await api.patch("/notifications/read-all", { before: r.notifications[0]?.createdAt });
      }
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(1);
  }, [load]);

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: c.bg, paddingBottom: insets.bottom }}>
        <TopBar title="Thông báo" sub="Khách đặt / hủy lịch" onBack={onClose} />
        {!!errorMsg && <Text style={[styles.error, { color: c.danger }]}>{errorMsg}</Text>}
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: 40 }}
          refreshControl={<PullRefresh onRefresh={() => load(1)} />}
        >
          {loading && items.length === 0 && <ActivityIndicator color={c.accent} style={{ marginTop: 24 }} />}
          {!loading && items.length === 0 && !errorMsg && (
            <Text style={[styles.empty, { color: c.inkSoft }]}>Chưa có thông báo nào.</Text>
          )}
          {items.map((n, i) => {
            const fresh = freshIds.has(n.id);
            return (
              <View
                key={n.id}
                style={[styles.row, i !== items.length - 1 && { borderBottomWidth: 1, borderBottomColor: c.hairline }]}
              >
                <View style={[styles.dot, { backgroundColor: fresh ? c.danger : "transparent" }]} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.body, { color: c.ink }, fresh && { fontWeight: "800" }]}>{n.body}</Text>
                  <Text style={[styles.meta, { color: c.inkSoft }]}>{`${n.title} · ${fmt(n.createdAt)}`}</Text>
                </View>
              </View>
            );
          })}
          {hasMore && (
            <AppButton variant="ghost" style={{ marginTop: 16 }} onPress={() => load(page + 1)}>
              Tải thêm
            </AppButton>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  error: { fontSize: 12.5, marginHorizontal: 22, marginTop: 8, fontWeight: "700" },
  empty: { fontSize: 13, marginTop: 16 },
  row: { flexDirection: "row", alignItems: "flex-start", paddingVertical: 12, gap: 10 },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
  body: { fontSize: 13.5, lineHeight: 19 },
  meta: { fontSize: 11.5, marginTop: 3 },
});
