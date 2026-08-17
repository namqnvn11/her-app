import { useState, useCallback, useRef } from "react";
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import TopBar from "../components/TopBar";
import HeaderBlock from "../components/HeaderBlock";
import SectionLabel from "../components/SectionLabel";
import TimeRow from "../components/TimeRow";
import AppButton from "../components/AppButton";
import RosterSheet from "../components/RosterSheet";
import { useAuth } from "../context/AuthContext";
import { api } from "../api/client";
import { useTheme } from "../theme";

const money = (n) => (n || 0).toLocaleString("vi-VN") + "đ";
const short = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1).replace(".", ",") + "tr" : (n || 0).toLocaleString("vi-VN"));

export default function DashboardScreen() {
  const { user } = useAuth();
  const { c } = useTheme();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  // Mục 7 — bảng lương: admin xem/chốt theo tháng; HLV xem thù lao CỦA MÌNH (tháng hiện tại)
  // her-17: khối "Bảng lương HLV" đã BỎ khỏi Tổng quan admin (trùng với "Thù lao HLV" của
  // dashboard); chỉ còn phần thù-lao-của-tôi cho HLV/admin kiêm HLV (paySeq chặn response trễ)
  const paySeq = useRef(0);
  const [myPay, setMyPay] = useState(null); // HLV: phần của mình
  const [payError, setPayError] = useState("");
  // her-18: admin xem báo cáo theo THÁNG — bộ chuyển nhỏ dưới tiêu đề; mặc định tháng này
  const [repMonth, setRepMonth] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() + 1 }; });
  const repMonthRef = useRef(null);
  const loadSeq = useRef(0);
  const [rosterClassId, setRosterClassId] = useState(null); // HLV bấm "Điểm danh lớp" từ Buổi kế tiếp

  const load = useCallback(async (pm) => {
    // her-18: admin xem theo THÁNG — pm truyền từ bộ chuyển; không truyền thì dùng tháng đang xem
    const target = pm || repMonthRef.current;
    if (target) repMonthRef.current = target;
    const seq = ++loadSeq.current;
    setLoading(true);
    try {
      setErrorMsg("");
      const params = target ? { month: `${target.y}-${String(target.m).padStart(2, "0")}` } : undefined;
      const res = await api.get("/dashboard", params);
      if (seq === loadSeq.current) setData(res);
    } catch (err) {
      if (seq === loadSeq.current) {
        setData(null); // không để số tháng cũ nằm dưới nhãn tháng mới
        setErrorMsg(err.message);
      }
    } finally {
      if (seq === loadSeq.current) setLoading(false);
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
  if (isAdmin && repMonthRef.current === null) repMonthRef.current = repMonth;

  const nowM = new Date();
  const atCurrentMonth = repMonth.y === nowM.getFullYear() && repMonth.m === nowM.getMonth() + 1;
  // Chỉ lùi tới tháng đầu tiên CÓ DỮ LIỆU (server trả minMonth) — không lùi vô hạn (her-19)
  const curStr = `${repMonth.y}-${String(repMonth.m).padStart(2, "0")}`;
  const canGoBack = !!data?.minMonth && curStr > data.minMonth; // lỗi/chưa tải -> ẩn mũi tên (review N9)
  const shiftReportMonth = (delta) => {
    if (delta > 0 && atCurrentMonth) return; // không có tháng tương lai
    if (delta < 0 && !canGoBack) return; // trước đó không còn dữ liệu
    const next = new Date(repMonth.y, repMonth.m - 1 + delta, 1);
    const pm = { y: next.getFullYear(), m: next.getMonth() + 1 };
    setRepMonth(pm);
    load(pm);
  };

  const loadPayroll = useCallback(async () => {
    if (!user?.trainerId) return; // chỉ HLV / admin kiêm HLV có phần thù-lao-của-tôi
    const seq = ++paySeq.current;
    try {
      setPayError("");
      const d = new Date();
      const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const res = await api.get("/payroll/my", { month });
      if (seq === paySeq.current) setMyPay(res);
    } catch (err) {
      if (seq === paySeq.current) setPayError(err.message);
    }
  }, [user?.trainerId]);

  useFocusEffect(
    useCallback(() => {
      if (user?.trainerId) loadPayroll();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.trainerId])
  );


  const now = new Date();
  const todayLabel = `${String(now.getDate()).padStart(2, "0")}/${String(now.getMonth() + 1).padStart(2, "0")}`;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.bg }}
      contentContainerStyle={{ paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={() => { load(); loadPayroll(); }} tintColor={c.primary} />}
    >
      {/* Mẫu 11: dashboard Admin KHÔNG có header màu — tiêu đề thường */}
      {isAdmin && (
        <>
          <TopBar title="Tổng quan" sub="Báo cáo thu – chi theo tháng · Admin" />
          {/* her-19: bộ chuyển tháng dạng pill gọn — mũi tên ẨN hẳn khi không đi tiếp được;
              chỉ lùi được tới tháng ĐẦU TIÊN có dữ liệu (minMonth từ server) */}
          <View style={styles.repMonthRow}>
            <View style={[styles.repPill, { backgroundColor: c.card, borderColor: c.hairline }]}>
              {canGoBack ? (
                <TouchableOpacity onPress={() => shiftReportMonth(-1)} hitSlop={12} style={styles.repArrow}>
                  <Feather name="chevron-left" size={15} color={c.primary} />
                </TouchableOpacity>
              ) : (
                <View style={styles.repArrow} />
              )}
              <Text style={[styles.repMonthText, { color: c.ink }]}>
                {atCurrentMonth ? "Tháng này" : `Tháng ${repMonth.m}/${repMonth.y}`}
              </Text>
              {!atCurrentMonth ? (
                <TouchableOpacity onPress={() => shiftReportMonth(1)} hitSlop={12} style={styles.repArrow}>
                  <Feather name="chevron-right" size={15} color={c.primary} />
                </TouchableOpacity>
              ) : (
                <View style={styles.repArrow} />
              )}
            </View>
          </View>
        </>
      )}

      {isTrainer && (
        <HeaderBlock
          eyebrow={`${user?.name || "HLV"} · Huấn luyện viên`}
          title={`${data?.todayCount ?? 0} buổi dạy hôm nay`}
          stats={[
            { value: data?.weekHours ?? "—", label: "giờ dạy tuần" },
            { value: data?.monthSessions ?? "—", label: `buổi tháng ${now.getMonth() + 1}` },
            { value: myPay?.entry ? short(myPay.entry.total) : "—", label: "thù lao tháng này" },
          ]}
        />
      )}

      {!isAdmin && !isTrainer && (
        <HeaderBlock
          eyebrow={`Lễ tân · ${user?.name || ""}`}
          title={`Hôm nay, ${todayLabel}`}
          stats={[
            { value: data?.classesToday ?? "—", label: "lớp" },
            { value: data?.bookingsToday ?? "—", label: "lượt đặt" },
            { value: data?.freeSlots ?? "—", label: "chỗ trống" },
            { value: data?.unpaid ?? "—", label: "khách nợ" },
          ]}
        />
      )}

      <View style={{ paddingHorizontal: 22 }}>
        {!!errorMsg && <Text style={[styles.error, { color: c.danger }]}>{errorMsg}</Text>}
        {!data && !loading && !errorMsg && (
          <Text style={[styles.empty, { color: c.inkSoft }]}>
            Chưa có số liệu tổng quan — phần này sẽ có dữ liệu khi làm xong điểm danh &amp; báo cáo.
          </Text>
        )}

        {isAdmin && data && (
          <>
            <SectionLabel>Doanh thu bán gói</SectionLabel>
            <Text style={[styles.big, { color: c.primary }]}>{money(data.revenue)}</Text>
            {!!data.packagesSold && (
              <Text style={[styles.bigSub, { color: c.inkSoft }]}>
                {data.packagesSold} gói bán ra
                {data.topPackages?.[0] ? ` · bán chạy: ${data.topPackages[0].name} (${data.topPackages[0].count})` : ""}
                {data.debt ? ` · còn nợ ${money(data.debt)}` : ""}
              </Text>
            )}

            <View style={[styles.statRow, { borderBottomColor: c.hairline, borderTopColor: c.hairline }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.statValue, { color: c.ink }]}>{short(data.payroll)}</Text>
                <Text style={[styles.statLabel, { color: c.inkSoft }]}>lương + hoa hồng</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.statValue, { color: c.ink }]}>{data.sessions ?? "—"}</Text>
                <Text style={[styles.statLabel, { color: c.inkSoft }]}>lượt đến tập</Text>
              </View>
            </View>

            {(data.peakHours || []).length > 0 && <SectionLabel>Khung giờ đông nhất</SectionLabel>}
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
            {(data.trainers || []).map((t, ti) => (
              <View key={String(t.trainerId || ti)} style={[styles.payRow, { borderBottomColor: c.hairline }]}>
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

        {!isAdmin && !!payError && <Text style={[styles.error, { color: c.danger }]}>{payError}</Text>}
        {(isTrainer || (isAdmin && user?.trainerId)) && myPay?.entry && (
          <>
            <SectionLabel>{`Thù lao tháng ${new Date().getMonth() + 1}`}</SectionLabel>
            {[
              ["Lương cứng", myPay.entry.baseSalary, null],
              [`Lớp nhóm · ${myPay.entry.group.count} ${myPay.entry.group.per === "attendee" ? "khách" : "buổi"}`, myPay.entry.group.amount, myPay.entry.group.count],
              [`PT 1:1 · ${myPay.entry.pt1.count} buổi`, myPay.entry.pt1.amount, myPay.entry.pt1.count],
              [`PT nhóm · ${myPay.entry.ptGroup.count} ${myPay.entry.ptGroup.per === "attendee" ? "khách" : "buổi"}`, myPay.entry.ptGroup.amount, myPay.entry.ptGroup.count],
            ]
              .filter(([, amount, count]) => amount > 0 || count > 0 || count === null && amount > 0)
              .map(([label, amount]) => (
                <View key={label} style={[styles.payRow, { borderBottomColor: c.hairline }]}>
                  <Text style={[styles.paySub, { color: c.ink }]}>{label}</Text>
                  <Text style={[styles.payValue, { color: c.ink }]}>{money(amount)}</Text>
                </View>
              ))}
            <View style={[styles.payRow, { borderBottomColor: c.hairline }]}>
              <Text style={[styles.payName, { color: c.ink }]}>Tổng nhận</Text>
              <Text style={[styles.payValue, { color: c.primary }]}>{money(myPay.entry.total)}</Text>
            </View>
            <Text style={[styles.closedNote, { color: c.inkSoft }]}>
              Chỉ tính buổi có khách được điểm danh Đến thật. Mức áp theo ngày buổi diễn ra.
            </Text>
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
              {/* Mục 8: nối nút với RosterSheet của mục 5 — chỉ buổi LỚP NHÓM có danh sách khách */}
              {data.next.classId ? (
                <AppButton onPress={() => setRosterClassId(data.next.classId)}>Điểm danh lớp</AppButton>
              ) : (
                <Text style={{ fontSize: 11.5, color: c.inkSoft }}>Buổi PT — điểm danh ở màn Lịch dạy</Text>
              )}
            </TimeRow>
            {(data.rest || []).length > 0 && (
              <>
                <SectionLabel>Còn lại hôm nay</SectionLabel>
                {data.rest.map((r, i, arr) => (
                  <TimeRow key={`${r.time}-${i}`} time={r.time} title={r.title} meta={r.sub} last={i === arr.length - 1} />
                ))}
              </>
            )}
            {typeof data.attendanceRate === "number" && (
              <View style={[styles.note, { backgroundColor: c.primarySoft }]}>
                <Text style={[styles.noteText, { color: c.primary }]}>
                  Tỉ lệ khách đến lớp của bạn tháng này: {Math.round(data.attendanceRate * 100)}%
                </Text>
              </View>
            )}
          </>
        )}

        {!isAdmin && !isTrainer && data && (
          <>
            <SectionLabel>Lịch hôm nay</SectionLabel>
            {(data.today || []).map((t, i, arr) => (
              <TimeRow
                key={`${t.time}-${t.title}-${i}`}
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
              <View
                key={t.title}
                style={[styles.todo, i !== arr.length - 1 && { borderBottomWidth: 1, borderBottomColor: c.hairline }]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.payName, { color: c.ink }]}>{t.title}</Text>
                  {!!t.sub && <Text style={[styles.paySub, { color: c.inkSoft }]}>{t.sub}</Text>}
                </View>
                <Feather name="chevron-right" size={16} color={c.inkSoft} />
              </View>
            ))}
          </>
        )}
      </View>

      <RosterSheet classId={rosterClassId} onClose={() => setRosterClassId(null)} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  error: { fontSize: 12.5, marginTop: 14, fontWeight: "700" },
  empty: { fontSize: 13, marginTop: 18, lineHeight: 19 },
  big: { fontSize: 30, fontWeight: "800", marginTop: 6, letterSpacing: -0.5 },
  bigSub: { fontSize: 12, marginTop: 4 },
  statRow: {
    flexDirection: "row",
    gap: 16,
    marginTop: 16,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderBottomWidth: 1,
  },
  statValue: { fontSize: 19, fontWeight: "800" },
  statLabel: { fontSize: 10.5, fontWeight: "500", marginTop: 2 },
  barRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 10 },
  barTime: { width: 44, fontSize: 12, fontWeight: "700" },
  track: { flex: 1, height: 8, borderRadius: 99 },
  fill: { height: 8, borderRadius: 99 },
  barPct: { fontSize: 11, fontWeight: "700" },
  payRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 12, borderBottomWidth: 1 },
  payName: { fontSize: 13, fontWeight: "700" },
  paySub: { fontSize: 11, marginTop: 2 },
  payValue: { fontSize: 13, fontWeight: "800" },
  todo: { flexDirection: "row", alignItems: "center", paddingVertical: 13 },
  note: { borderRadius: 12, paddingVertical: 12, paddingHorizontal: 14, marginTop: 16 },
  noteText: { fontSize: 12, lineHeight: 18, fontWeight: "500" },
  monthNav: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 10 },
  monthLabel: { fontSize: 13.5, fontWeight: "800" },
  repMonthRow: { paddingHorizontal: 22, marginTop: 4, flexDirection: "row" },
  repPill: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  repArrow: { padding: 5, width: 25, alignItems: "center" },
  repMonthText: { fontSize: 12, fontWeight: "700", minWidth: 96, textAlign: "center" },
  closedNote: { fontSize: 11.5, lineHeight: 17, marginTop: 10 },
});
