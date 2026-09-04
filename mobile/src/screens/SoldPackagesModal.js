import { useState, useEffect, useCallback, useRef } from "react";
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator, Modal } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import TopBar from "../components/TopBar";
import MonthPickerSheet from "../components/MonthPickerSheet";
import PullRefresh from "../components/PullRefresh";
import CustomerPackagesModal from "./CustomerPackagesModal";
import Avatar from "../components/Avatar";
import { api } from "../api/client";
import { useTheme } from "../theme";
import { packageLabel } from "../utils/formats";

// her-60 (04/09/2026): LỊCH SỬ GÓI BÁN — admin & lễ tân xem mọi gói bán trong 1 tháng mà không phải
// mở từng khách. Bấm 1 dòng -> mở màn gói của khách đó (sửa/xoá/thu nợ/bảo lưu sẵn có ở đó).
// Server lọc theo tháng + tìm tên/SĐT; app chỉ hiển thị và tải dần (mẫu her-28).
const PAGE = 30;
const PAYMENT_LABEL = { cash: "Tiền mặt", transfer: "Chuyển khoản", card: "Cà thẻ" };
const money = (n) => (n || 0).toLocaleString("vi-VN") + "đ";
const fmtDate = (d) => {
  const x = new Date(d);
  return `${String(x.getDate()).padStart(2, "0")}/${String(x.getMonth() + 1).padStart(2, "0")}`;
};
const monthKey = ({ y, m }) => `${y}-${String(m).padStart(2, "0")}`;

export default function SoldPackagesModal({ onClose }) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const [month, setMonth] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() + 1 }; });
  const [monthSheet, setMonthSheet] = useState(false);
  const [minMonth, setMinMonth] = useState(null);
  const [search, setSearch] = useState("");
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [customer, setCustomer] = useState(null); // mở CustomerPackagesModal của khách này
  const seq = useRef(0);
  const endReached = useRef(false);

  // Tải trang 1 (đổi tháng / gõ tìm / kéo làm mới) — seq chống response cũ về muộn đè cái mới
  const load = useCallback(async (m, q) => {
    const my = ++seq.current;
    setLoading(true);
    setErrorMsg("");
    try {
      const res = await api.get("/packages", { month: monthKey(m), q: q.trim(), page: 1, limit: PAGE });
      if (my !== seq.current) return;
      setItems(res.packages);
      setSummary(res.summary);
      setMinMonth(res.minMonth);
      setHasMore(!!res.hasMore);
      setPage(1);
      endReached.current = false;
    } catch (err) {
      if (my === seq.current) setErrorMsg(err.message);
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, []);

  // Gõ tìm: chờ 300ms rồi mới hỏi server (tự quét khi gõ — her-23)
  useEffect(() => {
    const t = setTimeout(() => load(month, search), search ? 300 : 0);
    return () => clearTimeout(t);
  }, [month, search, load]);

  const loadMore = async () => {
    if (loading || loadingMore || !hasMore) return;
    const my = seq.current;
    setLoadingMore(true);
    try {
      const res = await api.get("/packages", { month: monthKey(month), q: search.trim(), page: page + 1, limit: PAGE });
      if (my !== seq.current) return;
      setItems((prev) => {
        const seen = new Set(prev.map((p) => String(p.id)));
        return [...prev, ...res.packages.filter((p) => !seen.has(String(p.id)))];
      });
      setHasMore(!!res.hasMore);
      setPage((p) => p + 1);
      endReached.current = false;
    } catch (err) {
      if (my === seq.current) setErrorMsg(err.message);
    } finally {
      if (my === seq.current) setLoadingMore(false);
    }
  };

  const openCustomer = (p) => {
    if (p.customer.deleted || !p.customer.id) {
      setErrorMsg("Học viên này đã bị xoá — gói chỉ còn để xem trong lịch sử");
      return;
    }
    setErrorMsg("");
    setCustomer({ id: p.customer.id, name: p.customer.name, phone: p.customer.phone });
  };

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: c.bg, paddingBottom: insets.bottom }}>
        <TopBar
          title="Gói đã bán"
          onBack={onClose}
          right={
            <TouchableOpacity activeOpacity={0.7} onPress={() => setMonthSheet(true)} style={[styles.pill, { borderColor: c.accent }]}>
              <Text style={[styles.pillText, { color: c.ink }]}>{`T${month.m}/${month.y}`}</Text>
              <Feather name="chevron-down" size={13} color={c.accent} />
            </TouchableOpacity>
          }
        />
        <View style={{ paddingHorizontal: 22 }}>
          <View style={[styles.searchBox, { borderColor: c.line, backgroundColor: c.card }]}>
            <Feather name="search" size={15} color={c.inkSoft} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Tìm tên hoặc số điện thoại"
              placeholderTextColor={c.inkSoft}
              style={[styles.searchInput, { color: c.ink }]}
              returnKeyType="search"
            />
            {!!search && (
              <TouchableOpacity onPress={() => setSearch("")} hitSlop={8}>
                <Feather name="x" size={15} color={c.inkSoft} />
              </TouchableOpacity>
            )}
          </View>
          {!!summary && (
            <Text style={[styles.summary, { color: c.inkSoft }]}>
              {summary.count} gói · thu {money(summary.revenue)}
              {summary.debt ? ` · còn nợ ${money(summary.debt)}` : ""}
            </Text>
          )}
          {!!errorMsg && <Text style={[styles.error, { color: c.danger }]}>{errorMsg}</Text>}
        </View>

        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: 40 }}
          refreshControl={<PullRefresh onRefresh={() => load(month, search)} />}
          scrollEventThrottle={100}
          onScroll={({ nativeEvent: { layoutMeasurement, contentOffset, contentSize } }) => {
            if (contentSize.height <= layoutMeasurement.height || contentOffset.y <= 0) return;
            const nearBottom = layoutMeasurement.height + contentOffset.y >= contentSize.height - 400;
            if (!nearBottom) { endReached.current = false; return; }
            if (endReached.current) return;
            endReached.current = true;
            loadMore();
          }}
        >
          {items.length === 0 && loading && <ActivityIndicator color={c.accent} style={{ marginTop: 24 }} />}
          {items.length === 0 && !loading && !errorMsg && (
            <Text style={[styles.empty, { color: c.inkSoft }]}>
              {search ? "Không có gói nào khớp tìm kiếm trong tháng này." : "Tháng này chưa bán gói nào."}
            </Text>
          )}
          {items.map((p, i) => (
            <TouchableOpacity
              key={p.id}
              activeOpacity={0.7}
              onPress={() => openCustomer(p)}
              style={[styles.row, i !== items.length - 1 && { borderBottomWidth: 1, borderBottomColor: c.hairline }, p.customer.deleted && { opacity: 0.55 }]}
            >
              <Avatar url={p.customer.avatarUrl} name={p.customer.name} size={36} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.name, { color: c.ink }]}>
                  {p.customer.name}
                  {p.customer.deleted ? " (đã xoá)" : ""}
                </Text>
                <Text style={[styles.meta, { color: c.ink }]}>{p.name}{packageLabel(p) ? ` · ${packageLabel(p)}` : ""}</Text>
                <Text style={[styles.meta, { color: c.inkSoft }]}>
                  {`Bán ${fmtDate(p.activatedAt)} · ${PAYMENT_LABEL[p.paymentMethod] || p.paymentMethod}`}
                  {p.customer.phone ? ` · ${p.customer.phone}` : ""}
                </Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={[styles.price, { color: c.ink }]}>{money(p.price)}</Text>
                {p.debt > 0 ? (
                  <Text style={[styles.debt, { color: c.danger }]}>{`nợ ${money(p.debt)}`}</Text>
                ) : (
                  <Text style={[styles.debt, { color: c.success }]}>đã thu đủ</Text>
                )}
              </View>
            </TouchableOpacity>
          ))}
          {loadingMore && <ActivityIndicator color={c.accent} style={{ marginTop: 12 }} />}
          {!loadingMore && hasMore && items.length > 0 && (
            <TouchableOpacity onPress={loadMore} style={{ alignSelf: "center", marginTop: 12 }}>
              <Text style={{ fontSize: 12.5, fontWeight: "700", color: c.accent }}>Tải thêm</Text>
            </TouchableOpacity>
          )}
        </ScrollView>

        <MonthPickerSheet
          visible={monthSheet}
          year={month.y}
          month={month.m}
          minMonth={minMonth}
          onPick={(y, m) => { setMonth({ y, m }); setMonthSheet(false); }}
          onClose={() => setMonthSheet(false)}
        />

        {/* Đóng màn gói của khách -> tải lại (có thể vừa sửa/xoá/thu nợ) */}
        {!!customer && <CustomerPackagesModal customer={customer} onClose={() => { setCustomer(null); load(month, search); }} />}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  pill: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1.5, borderRadius: 999, paddingVertical: 5, paddingHorizontal: 11 },
  pillText: { fontSize: 12.5, fontWeight: "800" },
  searchBox: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 999, borderWidth: 1.5, paddingHorizontal: 16, paddingVertical: 10, marginTop: 4 },
  searchInput: { flex: 1, fontSize: 13.5 },
  summary: { fontSize: 12, fontWeight: "700", marginTop: 12, marginBottom: 4 },
  error: { fontSize: 12.5, fontWeight: "700", marginTop: 8 },
  empty: { fontSize: 13, marginTop: 24, textAlign: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12 },
  name: { fontSize: 13.5, fontWeight: "800" },
  meta: { fontSize: 11.5, marginTop: 2 },
  price: { fontSize: 13.5, fontWeight: "800" },
  debt: { fontSize: 11, fontWeight: "700", marginTop: 2 },
});
