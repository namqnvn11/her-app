import { useState, useCallback } from "react";
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import HeaderBlock from "../components/HeaderBlock";
import SectionLabel from "../components/SectionLabel";
import { useAuth } from "../context/AuthContext";
import { api } from "../api/client";
import { syncReminders } from "../utils/reminders";
import { classTitle } from "../utils/displayName";
import { packageLabel } from "../utils/formats";
import { useTheme } from "../theme";

function fmtDate(d) {
  const date = new Date(d);
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${date.getFullYear()}`;
}
function fmtDateTime(d) {
  const date = new Date(d);
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const time = date.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
  return `${dd}/${mm} ${time}`;
}
function daysLeft(d) {
  if (!d) return "∞"; // gói không thời hạn (Q3)
  return Math.max(Math.ceil((new Date(d).getTime() - Date.now()) / 86400000), 0);
}

export default function HomeScreen() {
  const { user } = useAuth();
  const navigation = useNavigation();
  const { c } = useTheme();
  const [pkg, setPkg] = useState(null);
  const [bookings, setBookings] = useState([]);
  // Trạng thái gói cho ô Đặt lịch: null = chưa biết (chưa khoá ô — server vẫn là
  // chốt chặn thật) | "ok" | "paused" (có gói nhưng đang bảo lưu) | "none"
  const [pkgState, setPkgState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setErrorMsg("");
      const [pkgsRes, bookingsRes] = await Promise.all([
        api.get("/me/packages"),
        api.get("/me/bookings"),
      ]);
      // Mục 9: đặt lại nhắc-1-tiếng theo lịch mới nhất (no-op trên web)
      syncReminders((bookingsRes.bookings || []).filter((b) => b.status === "booked"));
      // her-35: mọi buổi tập đều là lớp -> chỉ còn 1 ô Đặt lịch. Không có gói còn hiệu lực
      // thì ô mờ + nói rõ lý do, phân biệt gói đang BẢO LƯU với không có gói (góp ý 16/08).
      const pkgs = pkgsRes.packages || [];
      // Gói nổi bật của card đầu màn suy thẳng từ /me/packages — bớt 1 request ở màn mở
      // nhiều nhất. Server đã sort sẵn: active trước (hạn gần lên đầu), rồi bảo lưu; không
      // có 2 loại này thì coi như chưa có gói (đúng như /me/package cũ trả null).
      setPkg(pkgs.find((p) => p.status === "active") || pkgs.find((p) => p.status === "paused") || null);
      setPkgState(
        pkgs.some((p) => p.status === "active")
          ? "ok"
          : pkgs.some((p) => p.status === "paused")
            ? "paused"
            : "none"
      );
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

  // Gói không giới hạn buổi: totalSessions null (Q3) — hiện ∞ thay vì NaN
  const unlimited = pkg && pkg.totalSessions == null;
  const left = pkg && !unlimited ? Math.max(pkg.totalSessions - pkg.usedSessions, 0) : 0;

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
          { value: pkg ? (unlimited ? "∞" : left) : "—", label: "buổi còn lại" },
          { value: pkg ? daysLeft(pkg.expiresAt) : "—", label: "ngày còn hạn" },
          { value: bookings.length, label: "lịch sắp tới" },
        ]}
        progress={pkg && !unlimited && pkg.totalSessions > 0 ? pkg.usedSessions / pkg.totalSessions : undefined}
        footnote={
          pkg
            ? [
                pkg.name,
                // her-35: bộ môn + loại hình để khách có 2 gói mix phân biệt được
                packageLabel(pkg),
                unlimited ? "không giới hạn buổi" : `đã dùng ${pkg.usedSessions}/${pkg.totalSessions}`,
              ]
                .filter(Boolean)
                .join(" · ")
            : undefined
        }
      />

      <View style={{ paddingHorizontal: 22 }}>
        {!!errorMsg && <Text style={[styles.error, { color: c.danger }]}>{errorMsg}</Text>}

        <SectionLabel>Sắp tới</SectionLabel>
        {bookings.length === 0 && !loading && (
          <Text style={[styles.empty, { color: c.inkSoft }]}>Chưa có lịch nào sắp tới.</Text>
        )}
        {bookings.slice(0, 3).map((b) => (
          <View key={b.id} style={[styles.row, { borderBottomColor: c.hairline }]}>
            {/* her-38: bỏ badge loại hình — loại hình đã nằm trong dòng đậm */}
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowTitle, { color: c.ink }]}>{classTitle(b)}</Text>
              <Text style={[styles.rowMeta, { color: c.inkSoft }]}>{fmtDateTime(b.startAt)}</Text>
            </View>
            <Feather name="chevron-right" size={16} color={c.inkSoft} />
          </View>
        ))}

        {pkg && pkg.status === "paused" && (
          <View style={[styles.note, { backgroundColor: c.primarySoft }]}>
            <Text style={[styles.noteText, { color: c.primary }]}>
              Gói của bạn đang bảo lưu — ghé quầy lễ tân để mở lại, thời hạn sẽ được cộng bù.
            </Text>
          </View>
        )}
        {pkg && pkg.status !== "paused" && (
          <View style={[styles.note, { backgroundColor: c.primarySoft }]}>
            <Text style={[styles.noteText, { color: c.primary }]}>
              {unlimited ? "Gói của bạn không giới hạn buổi" : `Gói của bạn còn ${left} buổi`}
              {pkg.expiresAt ? `, hết hạn ${fmtDate(pkg.expiresAt)}. Ghé quầy để gia hạn sớm nhé.` : " và không có thời hạn."}
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
          {(() => {
            const off = pkgState === "none" || pkgState === "paused";
            return (
              <TouchableOpacity
                activeOpacity={off ? 1 : 0.85}
                disabled={off}
                style={[styles.quick, { backgroundColor: c.primary }, off && { opacity: 0.45 }]}
                onPress={() => navigation.navigate("Dat_lich")}
              >
                <Text style={[styles.quickTitle, { color: c.primaryOn }]}>Đặt lịch</Text>
                <Text style={[styles.quickSub, { color: c.primaryOnSoft }]}>
                  {pkgState === "paused"
                    ? "Gói đang bảo lưu — ghé quầy"
                    : pkgState === "none" ? "Cần gói tập — ghé quầy" : "Đặt buổi tập theo gói của bạn"}
                </Text>
              </TouchableOpacity>
            );
          })()}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  error: { fontSize: 12.5, marginTop: 14, fontWeight: "700" },
  empty: { fontSize: 13, marginTop: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 14, borderBottomWidth: 1 },
  rowTitle: { fontSize: 13.5, fontWeight: "700" },
  rowMeta: { fontSize: 11.5, marginTop: 2 },
  note: { borderRadius: 12, paddingVertical: 12, paddingHorizontal: 14, marginTop: 16 },
  noteText: { fontSize: 12, lineHeight: 18, fontWeight: "500" },
  quickRow: { flexDirection: "row", gap: 10, marginTop: 16 },
  quick: { flex: 1, borderRadius: 14, padding: 14 },
  quickTitle: { fontSize: 13, fontWeight: "800" },
  quickSub: { fontSize: 11, marginTop: 2 },
});
