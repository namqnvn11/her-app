import { useState, useCallback } from "react";
import { View, Text, ScrollView, StyleSheet, RefreshControl } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import HeaderBlock from "../components/HeaderBlock";
import SectionLabel from "../components/SectionLabel";
import TimeRow from "../components/TimeRow";
import AppButton from "../components/AppButton";
import { useAuth } from "../context/AuthContext";
import { api } from "../api/client";
import { useTheme } from "../theme";

const money = (n) => (n || 0).toLocaleString("vi-VN") + "đ";
const short = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1).replace(".", ",") + "tr" : String(n || 0));

export default function DashboardScreen() {
  const { user } = useAuth();
  const { c } = useTheme();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setErrorMsg("");
      // Backend cần bổ sung GET /api/dashboard — trả số liệu theo vai trò của token (xem README)
      const res = await api.get("/dashboard");
      setData(res);
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

  const role = user?.role;
  const isAdmin = role === "admin";
  const isTrainer = role === "trainer";

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.bg }}
      contentContainerStyle={{ paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={c.primary} />}
    >
      {isTrainer ? (
        <HeaderBlock
          eyebrow={`${user?.name || "HLV"} · ${user?.specialty || "Huấn luyện viên"}`}
          title={`${data?.todayCount ?? 0} buổi dạy hôm nay`}
          stats={[
            { value: data?.weekHours ?? "—", label: "giờ dạy tuần" },
            { value: data?.monthSessions ?? "—", label: "buổi tháng này" },
            { value: data ? short(data.estimatedPay) : "—", label: "thù lao tạm tính" },
          ]}
        />
      ) : (
        <HeaderBlock
          eyebrow={isAdmin ? "Admin · Chủ phòng tập" : `Lễ tân · ${user?.name || ""}`}
          title={isAdmin ? "Tổng quan tháng này" : "Hôm nay"}
          stats={
            isAdmin
              ? [
                  { value: data ? short(data.payroll) : "—", label: "lương + hoa hồng" },
                  { value: data?.packagesSold ?? "—", label: "gói bán ra" },
                  { value: data?.sessions ?? "—", label: "buổi đã tập" },
                ]
              : [
                  { value: data?.classesToday ?? "—", label: "lớp" },
                  { value: data?.bookingsToday ?? "—", label: "lượt đặt" },
                  { value: data?.freeSlots ?? "—", label: "chỗ trống" },
                  { value: data?.unpaid ?? "—", label: "khách nợ" },
                ]
          }
        />
      )}

      <View style={{ paddingHorizontal: 22 }}>
        {!!errorMsg && <Text style={[styles.error, { color: c.primary }]}>{errorMsg}</Text>}
        {!data && !loading && !errorMsg && (
          <Text style={[styles.empty, { color: c.inkSoft }]}>Chưa có số liệu tổng quan.</Text>
        )}

        {isAdmin && data && (
          <>
            <SectionLabel>Doanh thu bán gói</SectionLabel>
            <Text style={[styles.big, { color: c.primary }]}>{money(data.revenue)}</Text>
            <SectionLabel>Khung giờ đông nhất</SectionLabel>
            {(data.peakHours || []).map((h) => (
              <View key={h.time} style={styles.barRow}>
                <Text style={[styles.barTime, { color: c.ink }]}>{h.time}</Text>
                <View style={[styles.track, { backgroundColor: c.primaryTint }]}>
                  <View style={[styles.fill, { width: `${Math.round(h.rate * 100)}%`, backgroundColor: c.primary }]} />
                </View>
                <Text style={[styles.barPct, { color: c.inkSoft }]}>{Math.round(h.rate * 100)}%</Text>
              </View>
            ))}
            <SectionLabel>Thù lao HLV</SectionLabel>
            {(data.trainers || []).map((t) => (
              <View key={t.name} style={[styles.payRow, { borderBottomColor: c.hairline }]}>
                <View>
                  <Text style={[styles.payName, { color: c.ink }]}>{t.name}</Text>
                  <Text style={[styles.paySub, { color: c.inkSoft }]}>
                    {t.sessions} buổi · {Math.round((t.attendance || 0) * 100)}% điểm danh
                  </Text>
                </View>
                <Text style={[styles.payValue, { color: c.primary }]}>{short(t.pay)}</Text>
              </View>
            ))}
          </>
        )}

        {isTrainer && data?.next && (
          <>
            <SectionLabel>Buổi kế tiếp</SectionLabel>
            <TimeRow
              time={data.next.time}
              title={data.next.title}
              meta={(data.next.customers || []).join(", ")}
              last
            >
              <AppButton onPress={data.onAttendance}>Điểm danh lớp</AppButton>
            </TimeRow>
            <SectionLabel>Còn lại hôm nay</SectionLabel>
            {(data.rest || []).map((r, i, arr) => (
              <TimeRow key={r.time} time={r.time} title={r.title} meta={r.sub} last={i === arr.length - 1} />
            ))}
          </>
        )}

        {!isAdmin && !isTrainer && data && (
          <>
            <SectionLabel>Lịch hôm nay</SectionLabel>
            {(data.today || []).map((t, i, arr) => (
              <TimeRow
                key={t.time + t.title}
                time={t.time}
                title={t.title}
                meta={t.coach}
                last={i === arr.length - 1}
                right={
                  <Text style={{ fontSize: 12, fontWeight: "700", color: t.booked >= t.capacity ? c.primary : c.ink }}>
                    {t.booked >= t.capacity ? "Đầy" : `${t.booked}/${t.capacity}`}
                  </Text>
                }
              />
            ))}
            <SectionLabel>Cần xử lý</SectionLabel>
            {(data.todo || []).map((t, i, arr) => (
              <View key={t.title} style={[styles.todo, i !== arr.length - 1 && { borderBottomWidth: 1, borderBottomColor: c.hairline }]}>
                <Text style={[styles.payName, { color: c.ink }]}>{t.title}</Text>
                {!!t.sub && <Text style={[styles.paySub, { color: c.inkSoft }]}>{t.sub}</Text>}
              </View>
            ))}
          </>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  error: { fontSize: 12.5, marginTop: 14, fontWeight: "700" },
  empty: { fontSize: 13, marginTop: 18 },
  big: { fontSize: 30, fontWeight: "800", marginTop: 6, letterSpacing: -0.5 },
  barRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 10 },
  barTime: { width: 44, fontSize: 12, fontWeight: "700" },
  track: { flex: 1, height: 8, borderRadius: 99 },
  fill: { height: 8, borderRadius: 99 },
  barPct: { fontSize: 11, fontWeight: "700" },
  payRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 12, borderBottomWidth: 1 },
  payName: { fontSize: 13, fontWeight: "700" },
  paySub: { fontSize: 11, marginTop: 2 },
  payValue: { fontSize: 13, fontWeight: "800" },
  todo: { paddingVertical: 13 },
});
