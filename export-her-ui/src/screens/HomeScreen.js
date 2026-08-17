import { useState, useCallback } from "react";
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import HeaderBlock from "../components/HeaderBlock";
import SectionLabel from "../components/SectionLabel";
import { useAuth } from "../context/AuthContext";
import { api } from "../api/client";
import { useTheme } from "../theme";

function fmtDate(d) {
  return new Date(d).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
}
function fmtDateTime(d) {
  return new Date(d).toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}
function daysLeft(d) {
  return Math.max(Math.ceil((new Date(d).getTime() - Date.now()) / 86400000), 0);
}

export default function HomeScreen() {
  const { user } = useAuth();
  const navigation = useNavigation();
  const { c } = useTheme();
  const [pkg, setPkg] = useState(null);
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setErrorMsg("");
      const [pkgRes, bookingsRes] = await Promise.all([api.get("/me/package"), api.get("/me/bookings")]);
      setPkg(pkgRes.package);
      setBookings(bookingsRes.bookings || []);
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

  const left = pkg ? Math.max(pkg.totalSessions - pkg.usedSessions, 0) : 0;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.bg }}
      contentContainerStyle={{ paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={c.primary} />}
    >
      <HeaderBlock
        eyebrow={new Date().toLocaleDateString("vi-VN", { weekday: "long", day: "2-digit", month: "2-digit" })}
        title={`Chào ${user?.name || ""}`}
        stats={[
          { value: pkg ? left : "—", label: "buổi còn lại" },
          { value: pkg ? daysLeft(pkg.expiresAt) : "—", label: "ngày còn hạn" },
          { value: bookings.length, label: "lịch sắp tới" },
        ]}
        progress={pkg && pkg.totalSessions > 0 ? pkg.usedSessions / pkg.totalSessions : undefined}
      />

      <View style={{ paddingHorizontal: 22 }}>
        {!!errorMsg && <Text style={[styles.error, { color: c.primary }]}>{errorMsg}</Text>}

        <SectionLabel>Sắp tới</SectionLabel>
        {bookings.length === 0 && !loading && (
          <Text style={[styles.empty, { color: c.inkSoft }]}>Chưa có lịch nào sắp tới.</Text>
        )}
        {bookings.slice(0, 3).map((b) => (
          <View key={b.id} style={[styles.row, { borderBottomColor: c.hairline }]}>
            <View style={[styles.badge, { backgroundColor: c.primaryTint }]}>
              <Text style={[styles.badgeText, { color: c.primary }]}>{b.type === "pt" ? "PT" : "GR"}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowTitle, { color: c.ink }]}>{b.title}</Text>
              <Text style={[styles.rowMeta, { color: c.inkSoft }]}>
                {b.coach} · {fmtDateTime(b.startAt)}
              </Text>
            </View>
          </View>
        ))}

        {pkg && (
          <View style={[styles.note, { backgroundColor: c.primarySoft }]}>
            <Text style={[styles.noteText, { color: c.primary }]}>
              Gói {pkg.name} còn {left} buổi, hết hạn {fmtDate(pkg.expiresAt)}.
            </Text>
          </View>
        )}
        {!pkg && !loading && (
          <View style={[styles.note, { backgroundColor: c.primarySoft }]}>
            <Text style={[styles.noteText, { color: c.primary }]}>
              Bạn chưa có gói tập còn hiệu lực — liên hệ quầy lễ tân để mua gói.
            </Text>
          </View>
        )}

        <View style={styles.quickRow}>
          <TouchableOpacity
            activeOpacity={0.85}
            style={[styles.quick, { backgroundColor: c.primary }]}
            onPress={() => navigation.navigate("Dat_lich", { initialTab: "group" })}
          >
            <Text style={[styles.quickTitle, { color: c.primaryOn }]}>Đặt lớp Group</Text>
            <Text style={[styles.quickSub, { color: "#F0D8CE" }]}>Pilates · Yoga</Text>
          </TouchableOpacity>
          <TouchableOpacity
            activeOpacity={0.85}
            style={[styles.quick, { borderWidth: 1.5, borderColor: c.primary }]}
            onPress={() => navigation.navigate("Dat_lich", { initialTab: "pt" })}
          >
            <Text style={[styles.quickTitle, { color: c.primary }]}>Đặt PT 1:1</Text>
            <Text style={[styles.quickSub, { color: c.inkSoft }]}>Chọn HLV</Text>
          </TouchableOpacity>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  error: { fontSize: 12.5, marginTop: 14, fontWeight: "700" },
  empty: { fontSize: 13, marginTop: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 14, borderBottomWidth: 1 },
  badge: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  badgeText: { fontSize: 12, fontWeight: "800" },
  rowTitle: { fontSize: 13.5, fontWeight: "700" },
  rowMeta: { fontSize: 11.5, marginTop: 2 },
  note: { borderRadius: 12, paddingVertical: 12, paddingHorizontal: 14, marginTop: 16 },
  noteText: { fontSize: 12, lineHeight: 18, fontWeight: "500" },
  quickRow: { flexDirection: "row", gap: 10, marginTop: 16 },
  quick: { flex: 1, borderRadius: 14, padding: 14 },
  quickTitle: { fontSize: 13, fontWeight: "800" },
  quickSub: { fontSize: 11, marginTop: 2 },
});
