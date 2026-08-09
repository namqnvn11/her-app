import { useState, useCallback, useRef } from "react";
import { View, Text, ScrollView, TextInput, TouchableOpacity, StyleSheet, RefreshControl } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import TopBar from "../components/TopBar";
import Pill from "../components/Pill";
import AppButton from "../components/AppButton";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { COLORS } from "../theme";

function fmtDateTime(d) {
  return new Date(d).toLocaleString("vi-VN", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const RANGES = [
  ["today", "Hôm nay"],
  ["upcoming", "Sắp tới"],
  ["all", "Tất cả"],
];

export default function ManagementScheduleScreen() {
  const { user } = useAuth();
  const canCancel = user?.role === "reception" || user?.role === "admin";
  const [range, setRange] = useState("upcoming");
  const [search, setSearch] = useState("");
  // searchRef = chuỗi tìm kiếm ĐÃ SUBMIT (đang áp cho danh sách hiển thị).
  // Chỉ chốt khi bấm tìm — gõ dở không được dùng cho refocus/"Tải thêm", tránh trộn
  // trang của 2 query khác nhau vào cùng một danh sách.
  const searchRef = useRef("");
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [confirmId, setConfirmId] = useState(null);
  // Phân trang: server trả hasMore, bấm "Tải thêm" để lấy trang kế tiếp nối vào danh sách
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);

  const load = useCallback(async (r = range, s = searchRef.current, p = 1) => {
    setLoading(true); // để RefreshControl hiện spinner đúng lúc kéo làm mới
    try {
      setErrorMsg("");
      const res = await api.get("/management/bookings", { range: r, search: s, page: p });
      setBookings((prev) => (p === 1 ? res.bookings : [...prev, ...res.bookings]));
      setHasMore(!!res.hasMore);
      setPage(p);
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  }, [range]);

  useFocusEffect(
    useCallback(() => {
      load(range);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [range])
  );

  // Chỉ setRange — useFocusEffect (deps [range]) sẽ tự load, không gọi trực tiếp
  // để khỏi bắn 2 request giống hệt nhau
  const changeRange = (r) => {
    setRange(r);
    setLoading(true);
  };

  const runSearch = () => {
    searchRef.current = search; // chốt chuỗi tìm kiếm tại thời điểm submit
    setLoading(true);
    load(range);
  };

  const cancel = async (id) => {
    try {
      await api.delete(`/bookings/${id}`);
      setConfirmId(null);
      load(range);
    } catch (err) {
      setErrorMsg(err.message);
      setConfirmId(null);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <TopBar
        title={canCancel ? "Lịch tập của khách" : "Lịch dạy của tôi"}
        sub={canCancel ? "Lễ tân/Admin có thể hủy lịch bất cứ lúc nào" : "Chỉ xem — liên hệ lễ tân để đổi/hủy lịch khách"}
      />

      {canCancel && (
        <View style={styles.searchRow}>
          <View style={styles.searchBox}>
            <Feather name="search" size={14} color={COLORS.inkSoft} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              onSubmitEditing={runSearch}
              placeholder="Tìm theo tên hoặc số điện thoại"
              placeholderTextColor={COLORS.inkSoft}
              style={styles.searchInput}
              returnKeyType="search"
            />
          </View>
        </View>
      )}

      <View style={styles.tabs}>
        {RANGES.map(([key, label]) => (
          <TouchableOpacity
            key={key}
            onPress={() => changeRange(key)}
            style={[styles.tabBtn, range === key && styles.tabBtnActive]}
          >
            <Text style={[styles.tabLabel, range === key && { color: COLORS.ink }]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {!!errorMsg && <Text style={styles.errorText}>{errorMsg}</Text>}

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 100, gap: 10 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => load(range)} tintColor={COLORS.ink} />}
      >
        {bookings.length === 0 && !loading && (
          <Text style={{ color: COLORS.inkSoft, fontSize: 13, marginTop: 8 }}>Không có lịch nào phù hợp.</Text>
        )}
        {bookings.map((b) => (
          <View key={b.id} style={styles.card}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <View style={styles.avatar}>
                    <Text style={{ fontSize: 11, fontWeight: "800", color: COLORS.ink }}>
                      {(b.customer.name || "?").slice(0, 1).toUpperCase()}
                    </Text>
                  </View>
                  <View>
                    <Text style={styles.customerName}>{b.customer.name}</Text>
                    <Text style={styles.customerPhone}>{b.customer.phone}</Text>
                  </View>
                </View>
                <Text style={styles.classTitle}>{b.title}</Text>
                <Text style={styles.classMeta}>{b.coach} · {fmtDateTime(b.startAt)}</Text>
              </View>
              <Pill tone={b.type === "pt" ? "brass" : "taupe"}>{b.type === "pt" ? "PT 1:1" : "Group"}</Pill>
            </View>

            {canCancel && (
              <View style={{ marginTop: 10 }}>
                {confirmId === b.id ? (
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <View style={{ flex: 1 }}>
                      <AppButton variant="outline" onPress={() => setConfirmId(null)}>Giữ lịch</AppButton>
                    </View>
                    <View style={{ flex: 1 }}>
                      <AppButton onPress={() => cancel(b.id)}>Xác nhận hủy</AppButton>
                    </View>
                  </View>
                ) : (
                  <AppButton
                    variant="outline"
                    onPress={() => setConfirmId(b.id)}
                    icon={<Feather name="x" size={14} color={COLORS.ink} style={{ marginRight: 2 }} />}
                  >
                    Hủy lịch này
                  </AppButton>
                )}
              </View>
            )}
          </View>
        ))}

        {hasMore && (
          <AppButton variant="outline" onPress={() => load(range, searchRef.current, page + 1)}>
            Tải thêm
          </AppButton>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  searchRow: { paddingHorizontal: 20, marginBottom: 10 },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: COLORS.card,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: COLORS.line,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  searchInput: { flex: 1, fontSize: 13.5, color: COLORS.ink },
  tabs: { flexDirection: "row", marginHorizontal: 20, marginBottom: 14, backgroundColor: "#EFEAE1", borderRadius: 12, padding: 4 },
  tabBtn: { flex: 1, paddingVertical: 9, borderRadius: 9, alignItems: "center" },
  tabBtnActive: { backgroundColor: COLORS.card },
  tabLabel: { fontWeight: "700", fontSize: 12.5, color: COLORS.inkSoft },
  errorText: { marginHorizontal: 20, marginBottom: 10, color: COLORS.ink, fontSize: 12.5 },
  card: { backgroundColor: COLORS.card, borderRadius: 16, padding: 14 },
  avatar: { width: 26, height: 26, borderRadius: 13, backgroundColor: COLORS.beige, alignItems: "center", justifyContent: "center" },
  customerName: { fontSize: 13, fontWeight: "800", color: COLORS.ink },
  customerPhone: { fontSize: 11, color: COLORS.inkSoft },
  classTitle: { fontSize: 14, fontWeight: "700", color: COLORS.ink, marginTop: 8 },
  classMeta: { fontSize: 12, color: COLORS.inkSoft, marginTop: 2 },
});
