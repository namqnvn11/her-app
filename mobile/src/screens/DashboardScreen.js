import { useState, useCallback, useRef } from "react";
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import TopBar from "../components/TopBar";
import HeaderBlock from "../components/HeaderBlock";
import SectionLabel from "../components/SectionLabel";
import TimeRow from "../components/TimeRow";
import AppButton from "../components/AppButton";
import RosterSheet from "../components/RosterSheet";
import MonthPickerSheet from "../components/MonthPickerSheet";
import { useAuth } from "../context/AuthContext";
import { api } from "../api/client";
import { useTheme } from "../theme";
import { FORMATS } from "../utils/formats";
import { classTitle } from "../utils/displayName";
import { dayLabel } from "../utils/dayLabel";

const money = (n) => (n || 0).toLocaleString("vi-VN") + "đ";
const short = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1).replace(".", ",") + "tr" : (n || 0).toLocaleString("vi-VN"));

export default function DashboardScreen() {
  const { user } = useAuth();
  const navigation = useNavigation();
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
  const [monthSheet, setMonthSheet] = useState(false); // her-46: sheet chọn tháng báo cáo

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

  // her-46: chọn tháng bằng SHEET lưới 12 tháng (góp ý 21/08) thay cho pill phải bấm từng
  // nhịp. Luật giới hạn giữ nguyên: không có tháng tương lai, không lùi quá minMonth của server.
  const pickReportMonth = (y, m) => {
    setMonthSheet(false);
    if (y === repMonth.y && m === repMonth.m) return; // chọn lại đúng tháng đang xem — khỏi tải lại
    const pm = { y, m };
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
      refreshControl={<RefreshControl refreshing={loading} onRefresh={() => { load(); loadPayroll(); }} tintColor={c.accent} />}
    >
      {/* Mẫu 11: dashboard Admin KHÔNG có header màu — tiêu đề thường */}
      {isAdmin && (
        <>
          <TopBar
            title="Tổng quan"
            sub="Báo cáo thu – chi theo tháng · Admin"
            right={
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={() => setMonthSheet(true)}
                style={[styles.repPill, { borderColor: c.accent }]}
              >
                <Text style={[styles.repMonthText, { color: c.ink }]}>{`T${repMonth.m}/${repMonth.y}`}</Text>
                <Feather name="chevron-down" size={13} color={c.accent} />
              </TouchableOpacity>
            }
          />
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
            { value: data?.classesToday ?? "—", label: "buổi" },
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
            <Text style={[styles.big, { color: c.accent }]}>{money(data.revenue)}</Text>
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
                  <View style={[styles.fill, { width: `${Math.round(h.rate * 100)}%`, backgroundColor: c.accent }]} />
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
                <Text style={[styles.payValue, { color: c.accent }]}>{short(t.pay)}</Text>
              </View>
            ))}
          </>
        )}

        {/* Lỗi tải thù lao phải hiện cho CẢ admin kiêm HLV — không để khối biến mất im lặng (C4) */}
        {!!payError && <Text style={[styles.error, { color: c.danger }]}>{payError}</Text>}
        {(isTrainer || (isAdmin && user?.trainerId)) && myPay?.entry && (
          <>
            <SectionLabel>{`Thù lao tháng ${new Date().getMonth() + 1}`}</SectionLabel>
            {[
              ["Lương cứng", myPay.entry.baseSalary, null],
              // her-35: 4 dòng theo loại hình buổi (1:1/1:2/1:4/1:8)
              ...FORMATS.map((f) => {
                const row = myPay.entry.byFormat?.[f] || { count: 0, amount: 0, per: "session" };
                return [`Buổi ${f} · ${row.count} ${row.per === "attendee" ? "khách" : "buổi"}`, row.amount, row.count];
              }),
            ]
              .filter(([, amount, count]) => amount > 0 || count > 0)
              .map(([label, amount]) => (
                <View key={label} style={[styles.payRow, { borderBottomColor: c.hairline }]}>
                  <Text style={[styles.paySub, { color: c.ink }]}>{label}</Text>
                  <Text style={[styles.payValue, { color: c.ink }]}>{money(amount)}</Text>
                </View>
              ))}
            <View style={[styles.payRow, { borderBottomColor: c.hairline }]}>
              <Text style={[styles.payName, { color: c.ink }]}>Tổng nhận</Text>
              <Text style={[styles.payValue, { color: c.accent }]}>{money(myPay.entry.total)}</Text>
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
              // Ghi rõ thứ/ngày ("T5-21/08") dưới giờ — chỉ "07:00" thì không biết là khi nào
              sub={data.next.startAt ? dayLabel(data.next.startAt) : null}
              // her-38: dòng đậm thống nhất — buổi này là của chính HLV nên ghép tên mình
              title={classTitle({ name: data.next.title, format: data.next.format, coach: user?.name })}
              meta={(data.next.customers || []).join(", ")}
              last
            >
              {/* Mục 8: nối nút với RosterSheet của mục 5 — mọi buổi đều là lớp (her-35) */}
              {data.next.classId ? (
                <AppButton onPress={() => setRosterClassId(data.next.classId)}>Điểm danh lớp</AppButton>
              ) : (
                <Text style={{ fontSize: 11.5, color: c.inkSoft }}>Điểm danh buổi dạy ở màn Lịch dạy</Text>
              )}
            </TimeRow>
            {(data.rest || []).length > 0 && (
              <>
                <SectionLabel>Còn lại hôm nay</SectionLabel>
                {data.rest.map((r, i, arr) => (
                  <TimeRow
                    key={`${r.time}-${i}`}
                    time={r.time}
                    title={classTitle({ name: r.title, format: r.format, coach: user?.name })}
                    meta={r.sub}
                    last={i === arr.length - 1}
                  />
                ))}
              </>
            )}
            {typeof data.attendanceRate === "number" && (
              <View style={[styles.note, { backgroundColor: c.primarySoft }]}>
                <Text style={[styles.noteText, { color: c.accent }]}>
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
                // her-38: dòng đậm thống nhất — HLV lên dòng đậm nên bỏ khỏi dòng phụ
                title={classTitle({ name: t.title, format: t.format, coach: t.coach })}
                last={i === arr.length - 1}
                right={
                  <Text style={{ fontSize: 12, fontWeight: "700", color: t.booked >= t.capacity ? c.accent : c.ink }}>
                    {t.booked >= t.capacity ? "Đầy" : `${t.booked}/${t.capacity}`}
                  </Text>
                }
              />
            ))}
            <SectionLabel>Cần xử lý</SectionLabel>
            {/* her-43: dòng nào server gắn `flag` thì bấm được — nhảy sang tab Tài khoản đã lọc
                sẵn đúng nhóm khách đang nói tới. Không có flag = không có mũi tên (mũi tên mà
                bấm không ra gì là đánh lừa người dùng — góp ý 21/08). */}
            {(data.todo || []).map((t, i, arr) => {
              const rowStyle = [
                styles.todo,
                i !== arr.length - 1 && { borderBottomWidth: 1, borderBottomColor: c.hairline },
              ];
              const body = (
                <>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.payName, { color: c.ink }]}>{t.title}</Text>
                    {!!t.sub && <Text style={[styles.paySub, { color: c.inkSoft }]}>{t.sub}</Text>}
                  </View>
                  {!!t.flag && <Feather name="chevron-right" size={16} color={c.inkSoft} />}
                </>
              );
              return t.flag ? (
                <TouchableOpacity
                  key={t.title}
                  activeOpacity={0.7}
                  onPress={() => navigation.navigate("Tai_khoan", { flag: t.flag })}
                  style={rowStyle}
                >
                  {body}
                </TouchableOpacity>
              ) : (
                <View key={t.title} style={rowStyle}>
                  {body}
                </View>
              );
            })}
          </>
        )}
      </View>

      {/* Chỉ HLV mở được sheet này ở màn Tổng quan (khối "Buổi kế tiếp") — không truyền
          canAdd/canCancel: đặt hộ & hủy hộ là quyền của quầy (her-39) */}
      <RosterSheet classId={rosterClassId} onClose={() => setRosterClassId(null)} />

      {/* her-46: sheet chọn tháng báo cáo — chỉ admin có bộ lọc này */}
      {isAdmin && (
        <MonthPickerSheet
          visible={monthSheet}
          year={repMonth.y}
          month={repMonth.m}
          minMonth={data?.minMonth}
          onPick={pickReportMonth}
          onClose={() => setMonthSheet(false)}
        />
      )}
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
  // Nút mở sheet chọn tháng — viền màu chủ đạo cho thấy bấm được (góp ý 21/08)
  repPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: 999,
    borderWidth: 1.5,
    paddingHorizontal: 11,
    paddingVertical: 5,
  },
  repMonthText: { fontSize: 12.5, fontWeight: "800" },
  closedNote: { fontSize: 11.5, lineHeight: 17, marginTop: 10 },
});
