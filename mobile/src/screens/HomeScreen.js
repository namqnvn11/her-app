import { useState, useCallback } from "react";
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import PullRefresh from "../components/PullRefresh";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import HeaderBlock from "../components/HeaderBlock";
import SectionLabel from "../components/SectionLabel";
import { useAuth } from "../context/AuthContext";
import { api } from "../api/client";
import { syncReminders } from "../utils/reminders";
import { classTitle } from "../utils/displayName";
import { packageLabel } from "../utils/formats";
import { dayLabelOrToday } from "../utils/dayLabel";
import { useTheme } from "../theme";

function fmtDate(d) {
  const date = new Date(d);
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${date.getFullYear()}`;
}
function fmtDateTime(d) {
  const date = new Date(d);
  const time = date.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
  // Có THỨ ở đầu ("T2-24/08 07:00") — nhìn là biết ngay buổi rơi vào thứ mấy
  return `${dayLabelOrToday(date)} ${time}`;
}
// Số ngày còn hạn. Gói KHÔNG thời hạn (Q3) trả null -> ô "ngày còn hạn" ẩn hẳn
// (góp ý 21/08: hiện "∞" khó hiểu hơn là không hiện gì)
function daysLeft(d) {
  if (!d) return null;
  return Math.max(Math.ceil((new Date(d).getTime() - Date.now()) / 86400000), 0);
}

// Ngưỡng "sắp hết" của dòng nhắc gia hạn (góp ý 21/08 — lúc nào cũng nhắc thì thành chữ thừa)
const LOW_SESSIONS = 6; // còn từ 6 buổi trở xuống
const LOW_DAYS = 15; // hoặc còn dưới 15 ngày

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
  const expiryDays = pkg ? daysLeft(pkg.expiresAt) : null;
  // Chỉ nhắc gia hạn khi gói THỰC SỰ sắp hết — hết buổi hoặc sắp hết hạn
  const runningLow =
    !!pkg &&
    pkg.status !== "paused" &&
    ((!unlimited && left <= LOW_SESSIONS) || (expiryDays != null && expiryDays < LOW_DAYS));

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.bg }}
      contentContainerStyle={{ paddingBottom: 40 }}
      refreshControl={<PullRefresh onRefresh={load} />}
    >
      <HeaderBlock
        eyebrow={new Date().toLocaleDateString("vi-VN", { weekday: "long", day: "2-digit", month: "2-digit" })}
        title={`Chào ${user?.name || ""}`}
        stats={[
          { value: pkg ? (unlimited ? "∞" : left) : "—", label: "buổi còn lại" },
          // Gói không thời hạn thì bỏ hẳn ô này (không hiện "∞")
          ...(pkg && expiryDays == null ? [] : [{ value: pkg ? expiryDays : "—", label: "ngày còn hạn" }]),
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
        {bookings.length === 0 && loading && <ActivityIndicator color={c.accent} style={{ marginTop: 24 }} />}
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
          </View>
        ))}

        {pkg && pkg.status === "paused" && (
          <View style={[styles.note, { backgroundColor: c.primarySoft }]}>
            <Text style={[styles.noteText, { color: c.accent }]}>
              Gói của bạn đang bảo lưu — ghé quầy lễ tân để mở lại, thời hạn sẽ được cộng bù.
            </Text>
          </View>
        )}
        {runningLow && (
          <View style={[styles.note, { backgroundColor: c.primarySoft }]}>
            <Text style={[styles.noteText, { color: c.accent }]}>
              {`Gói của bạn ${[
                unlimited ? null : `còn ${left} buổi`,
                pkg.expiresAt ? `hết hạn ${fmtDate(pkg.expiresAt)}` : null,
              ]
                .filter(Boolean)
                .join(", ")}. Ghé quầy để gia hạn sớm nhé.`}
            </Text>
          </View>
        )}
        {!pkg && !loading && (
          <View style={[styles.note, { backgroundColor: c.primarySoft }]}>
            <Text style={[styles.noteText, { color: c.accent }]}>
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
