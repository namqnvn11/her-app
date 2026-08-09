import { useState, useCallback } from "react";
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import TopBar from "../components/TopBar";
import Pill from "../components/Pill";
import Ring from "../components/Ring";
import { useAuth } from "../context/AuthContext";
import { api } from "../api/client";
import { COLORS } from "../theme";

function fmtDate(d) {
  return new Date(d).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
}
function fmtDateTime(d) {
  return new Date(d).toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export default function HomeScreen() {
  const { user } = useAuth();
  const navigation = useNavigation();
  const [pkg, setPkg] = useState(null);
  const [next, setNext] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  const load = useCallback(async () => {
    setLoading(true); // để RefreshControl hiện spinner đúng lúc kéo làm mới
    try {
      setErrorMsg("");
      const [pkgRes, bookingsRes] = await Promise.all([api.get("/me/package"), api.get("/me/bookings")]);
      setPkg(pkgRes.package);
      setNext(bookingsRes.bookings[0] || null);
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

  return (
    <ScrollView
      style={styles.wrap}
      contentContainerStyle={{ paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={COLORS.ink} />}
    >
      <TopBar title={`Chào ${user?.name || ""} 👋`} sub="Chúc bạn một buổi tập tràn năng lượng" />

      {!!errorMsg && <Text style={styles.errorText}>{errorMsg}</Text>}

      {pkg ? (
        <View style={styles.card}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
            <View style={{ flex: 1 }}>
              <Pill tone="brass">GÓI ĐANG DÙNG</Pill>
              <Text style={styles.packageName}>{pkg.name}</Text>
              <Text style={styles.packageMeta}>
                Kích hoạt {fmtDate(pkg.activatedAt)} · Hết hạn {fmtDate(pkg.expiresAt)}
              </Text>
              <Text style={styles.packagePrice}>{pkg.price.toLocaleString("vi-VN")}đ</Text>
            </View>
            <Ring used={pkg.usedSessions} total={pkg.totalSessions} size={96} />
          </View>
        </View>
      ) : (
        !loading && (
          <View style={styles.card}>
            <Text style={{ color: COLORS.inkSoft, fontSize: 13 }}>Bạn chưa có gói tập còn hiệu lực.</Text>
          </View>
        )
      )}

      <Text style={styles.sectionTitle}>Lịch sắp tới</Text>
      {next ? (
        <View style={styles.rowCard}>
          <View style={styles.iconBubble}>
            <Feather name={next.type === "pt" ? "activity" : "users"} size={18} color={COLORS.ink} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>{next.title}</Text>
            <Text style={styles.rowMeta}>{next.coach} · {fmtDateTime(next.startAt)}</Text>
          </View>
          <Feather name="chevron-right" size={16} color={COLORS.beigeDark} />
        </View>
      ) : (
        <Text style={{ marginHorizontal: 20, color: COLORS.inkSoft, fontSize: 13 }}>
          Chưa có lịch nào sắp tới.
        </Text>
      )}

      <Text style={styles.sectionTitle}>Đặt lịch nhanh</Text>
      <View style={{ flexDirection: "row", marginHorizontal: 20, gap: 12 }}>
        <TouchableOpacity
          activeOpacity={0.85}
          style={[styles.quickCard, { backgroundColor: COLORS.ink }]}
          onPress={() => navigation.navigate("Dat_lich", { initialTab: "group" })}
        >
          <Feather name="users" size={20} color="#fff" />
          <Text style={[styles.quickTitle, { color: "#fff" }]}>Lớp Group</Text>
          <Text style={[styles.quickSub, { color: "#D8D3C7" }]}>Yoga, Pilates, Gym</Text>
        </TouchableOpacity>
        <TouchableOpacity
          activeOpacity={0.85}
          style={[styles.quickCard, { backgroundColor: "#EFE9DD" }]}
          onPress={() => navigation.navigate("Dat_lich", { initialTab: "pt" })}
        >
          <Feather name="activity" size={20} color={COLORS.ink} />
          <Text style={[styles.quickTitle, { color: COLORS.ink }]}>PT 1:1</Text>
          <Text style={[styles.quickSub, { color: COLORS.inkSoft }]}>Chọn HLV yêu thích</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: COLORS.bg },
  errorText: { marginHorizontal: 20, marginBottom: 10, color: COLORS.ink, fontSize: 12.5 },
  card: {
    marginHorizontal: 20,
    backgroundColor: COLORS.card,
    borderRadius: 20,
    padding: 18,
    shadowColor: "#2B2A28",
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  packageName: { fontSize: 17, fontWeight: "800", color: COLORS.ink, marginTop: 8 },
  packageMeta: { fontSize: 12, color: COLORS.inkSoft, marginTop: 4 },
  packagePrice: { fontSize: 13, color: COLORS.ink, marginTop: 10, fontWeight: "700" },
  sectionTitle: { marginHorizontal: 20, marginTop: 22, marginBottom: 8, fontSize: 13, fontWeight: "800", color: COLORS.ink },
  rowCard: {
    marginHorizontal: 20,
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    shadowColor: "#2B2A28",
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1,
  },
  iconBubble: { width: 44, height: 44, borderRadius: 12, backgroundColor: COLORS.beige, alignItems: "center", justifyContent: "center" },
  rowTitle: { fontSize: 13.5, fontWeight: "700", color: COLORS.ink },
  rowMeta: { fontSize: 12, color: COLORS.inkSoft, marginTop: 2 },
  quickCard: { flex: 1, borderRadius: 16, padding: 16 },
  quickTitle: { fontWeight: "800", fontSize: 13, marginTop: 8 },
  quickSub: { fontSize: 11.5, marginTop: 2 },
});
