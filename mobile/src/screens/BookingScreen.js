import { useState, useCallback, useEffect, useRef } from "react";
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import PullRefresh from "../components/PullRefresh";
import { useFocusEffect } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import TopBar from "../components/TopBar";
import TimeRow from "../components/TimeRow";
import AppButton from "../components/AppButton";
import FormSheet from "../components/FormSheet";
import { api } from "../api/client";
import { classTitle } from "../utils/displayName";
import { useTheme } from "../theme";

function fmtTime(d) {
  return new Date(d).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
}
function dayKey(d) {
  return new Date(d).toDateString();
}
function fmtDayTime(d) {
  const date = new Date(d);
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm} ${fmtTime(date)}`;
}

// Dự đoán gói sẽ bị trừ — CHỈ để hiển thị màn xác nhận (mục 3). Bản sao luật chargeSession
// (her-35): gói còn hiệu lực, CHỨA bộ môn của buổi và ĐÚNG loại hình; gói CÓ hạn còn phủ
// ngày tập trừ trước (hạn gần trước), hết mới tới gói không hạn (kích hoạt trước trừ trước).
// Quyết định thật vẫn ở server — lệch thì message server là chốt.
function predictPackage(packages, cls) {
  const usable = packages.filter(
    (p) =>
      p.status === "active" &&
      (p.serviceTypes || []).includes(cls.serviceType) &&
      p.format === cls.format &&
      (p.remainingSessions == null || p.remainingSessions > 0)
  );
  const start = new Date(cls.startAt);
  const dated = usable
    .filter((p) => p.expiresAt && new Date(p.expiresAt) >= start)
    .sort(
      (a, b) =>
        new Date(a.expiresAt) - new Date(b.expiresAt) ||
        new Date(a.activatedAt) - new Date(b.activatedAt) ||
        String(a.id).localeCompare(String(b.id))
    );
  if (dated[0]) return dated[0];
  const noExp = usable
    .filter((p) => !p.expiresAt)
    .sort((a, b) => new Date(a.activatedAt) - new Date(b.activatedAt) || String(a.id).localeCompare(String(b.id)));
  return noExp[0] || null;
}

export default function BookingScreen() {
  const { c } = useTheme();
  const [dayIndex, setDayIndex] = useState(0);
  const [classes, setClasses] = useState([]);
  const [disciplines, setDisciplines] = useState([]);
  // null = đang tải danh sách gói; [] = không có gói còn hiệu lực
  const [myPackages, setMyPackages] = useState(null);
  const [myBookedIds, setMyBookedIds] = useState([]);
  const [hasPausedOnly, setHasPausedOnly] = useState(false);
  // 3 filter (chốt 19/08): HLV · chỉ buổi còn chỗ · bộ môn. null = "Tất cả".
  const [filterCoach, setFilterCoach] = useState(null);
  const [filterDiscipline, setFilterDiscipline] = useState(null);
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  // Màn xác nhận trước khi chốt (mục 3): lớp đang chọn | null
  const [confirm, setConfirm] = useState(null);
  const [confirmError, setConfirmError] = useState("");
  // Cờ đồng bộ chống bấm đúp (state busy render trễ 1 nhịp) + id đang xác nhận
  // để lỗi về muộn không hiện lạc sang sheet khác (review B1/N1)
  const busyRef = useRef(false);
  const confirmIdRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setErrorMsg("");
      // Danh mục bộ môn CHỈ dùng để lấy nhãn chip -> tách khỏi Promise.all: hỏng cũng không
      // được làm hỏng cả màn đặt lịch, nhãn rơi về chính key bộ môn
      api
        .get("/disciplines")
        .then((r) => setDisciplines(r.disciplines || []))
        .catch(() => setDisciplines([]));
      const [classesRes, pkgRes, myBkRes] = await Promise.all([
        api.get("/classes"),
        api.get("/me/packages"),
        api.get("/me/bookings"),
      ]);
      setClasses(classesRes.classes || []);
      // Buổi mình ĐÃ đặt -> hiện nút "Đã đặt" ngay trên danh sách (góp ý 16/08)
      setMyBookedIds((myBkRes.bookings || []).map((b) => String(b.classId)).filter(Boolean));
      const all = pkgRes.packages || [];
      setMyPackages(all);
      const active = all.filter((p) => p.status === "active");
      setHasPausedOnly(active.length === 0 && all.some((p) => p.status === "paused"));
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

  // Clear timer cũ để toast lỗi không bị toast trước đó "giết non" giữa chừng
  const toastTimer = useRef(null);
  // Rời màn khi toast còn treo -> dọn timer, tránh setState trên component đã gỡ
  useEffect(() => () => clearTimeout(toastTimer.current), []);
  const flash = (msg, isError = false) => {
    clearTimeout(toastTimer.current);
    setToast({ msg, isError });
    toastTimer.current = setTimeout(() => setToast(null), isError ? 3500 : 2200);
  };

  const book = async (cls) => {
    if (busyRef.current) return; // chặn bấm đúp — 1 lần đặt, trừ 1 buổi
    busyRef.current = true;
    setBusy(true);
    try {
      await api.post("/bookings", { classId: cls.id });
      confirmIdRef.current = null;
      setConfirm(null);
      flash(`Đã đặt lịch: ${cls.name}`);
      load();
    } catch (err) {
      const msg = err.message || "Không thể đặt lịch, vui lòng thử lại";
      // Lỗi hiện NGAY TRONG sheet xác nhận — toast ngoài màn bị Modal che (L8).
      // Sheet đã đóng/đã đổi sang buổi khác thì rơi về toast, không nuốt và không hiện lạc chỗ.
      if (confirmIdRef.current === cls.id) setConfirmError(msg);
      else flash(msg, true);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const openConfirm = (cls) => {
    setConfirmError("");
    confirmIdRef.current = cls.id;
    setConfirm(cls);
  };

  const closeConfirm = () => {
    if (busyRef.current) return; // đang đặt thì không cho đóng — kết quả phải hiện đúng chỗ
    confirmIdRef.current = null;
    setConfirm(null);
  };

  // 7 ngày tới làm dải chọn ngày — tính mỗi lần render để app mở qua nửa đêm
  // chip "hôm nay" không bị đóng băng ở ngày hôm trước
  const days = Array.from({ length: 7 }, (_, i) => new Date(Date.now() + i * 86400000));
  const activeDay = days[dayIndex];

  // her-35: buổi nào khách ĐẶT ĐƯỢC = có gói còn hiệu lực ĐÚNG loại hình và CHỨA bộ môn
  // của buổi. Đây chỉ là lớp hiển thị; luật thật vẫn ở server (H7, C1).
  const activePkgs = (myPackages || []).filter((p) => p.status === "active");
  const matchesPkg = (x) =>
    activePkgs.some((p) => p.format === x.format && (p.serviceTypes || []).includes(x.serviceType));
  const matched = classes.filter(matchesPkg);
  const bookedSet = new Set(myBookedIds);

  // Bộ môn của khách (gộp mọi gói active) — hàng chip bộ môn CHỈ hiện khi có từ 2 môn.
  // Nhãn lấy từ danh mục; danh mục lỗi/thiếu môn thì dùng chính key làm nhãn.
  const myDisciplines = [...new Set(activePkgs.flatMap((p) => p.serviceTypes || []))];
  const catalogKeys = disciplines.map((d) => d.key);
  const disciplineChips = [
    ...catalogKeys.filter((k) => myDisciplines.includes(k)),
    ...myDisciplines.filter((k) => !catalogKeys.includes(k)),
  ].map((k) => ({ key: k, label: disciplines.find((d) => d.key === k)?.label || k }));
  const showDisciplines = myDisciplines.length > 1;
  const activeDiscipline = showDisciplines && myDisciplines.includes(filterDiscipline) ? filterDiscipline : null;

  // Chip HLV lấy từ chính danh sách buổi đang hiện (cả 7 ngày, để đổi ngày không mất lựa chọn).
  // Giới hạn đã biết: lọc theo TÊN nên 2 HLV trùng tên sẽ gộp chung 1 chip (/classes chỉ trả
  // tên HLV, không trả id) — hiếm gặp, chấp nhận cho tới khi API trả kèm coachId.
  const coachesOf = (discipline) => [
    ...new Set(
      matched
        .filter((x) => !discipline || x.serviceType === discipline)
        .map((x) => x.coach)
        .filter(Boolean)
    ),
  ].sort((a, b) => a.localeCompare(b, "vi"));
  const coachNames = coachesOf(activeDiscipline);
  // Đổi bộ môn mà HLV đang chọn không còn buổi nào ở môn đó -> bỏ chọn HLV luôn,
  // không để chip HLV "tự bật lại" khi quay về Tất cả
  const pickDiscipline = (key) => {
    setFilterDiscipline(key);
    if (filterCoach && !coachesOf(key).includes(filterCoach)) setFilterCoach(null);
  };
  const activeCoach = coachNames.includes(filterCoach) ? filterCoach : null;

  const dayMatched = matched.filter((x) => dayKey(x.startAt) === dayKey(activeDay));
  const visible = dayMatched
    .filter((x) => !activeDiscipline || x.serviceType === activeDiscipline)
    .filter((x) => !activeCoach || x.coach === activeCoach)
    .filter((x) => !onlyAvailable || (x.spotsLeft > 0 && !bookedSet.has(String(x.id))))
    .sort((a, b) => new Date(a.startAt) - new Date(b.startAt));

  // Khách không có gói còn hiệu lực: không hiện danh sách — hướng dẫn liên hệ quầy (mục 2)
  const noPackage = myPackages !== null && activePkgs.length === 0;

  const chipStyle = (on) => [styles.chip, { borderColor: on ? c.primaryTint : c.line }, on && { backgroundColor: c.primaryTint }];
  const chipTextStyle = (on) => [styles.chipText, { color: on ? c.accent : c.ink }];

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <TopBar title="Đặt lịch" />

      {!!errorMsg && <Text style={[styles.error, { color: c.danger }]}>{errorMsg}</Text>}

      {noPackage ? (
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 22, paddingTop: 8 }}
          refreshControl={<PullRefresh onRefresh={load} />}
        >
          <View style={[styles.noPkg, { backgroundColor: c.primarySoft }]}>
            <Feather name="info" size={18} color={c.accent} />
            <Text style={[styles.noPkgText, { color: c.accent }]}>
              {hasPausedOnly
                ? "Gói của bạn đang bảo lưu — ghé quầy lễ tân để mở lại là đặt lịch được ngay."
                : "Bạn chưa có gói tập còn hiệu lực. Ghé quầy lễ tân để mua gói — có gói là màn này sẽ hiện đúng buổi bạn đặt được."}
            </Text>
          </View>
        </ScrollView>
      ) : (
        <>
          <View style={{ paddingHorizontal: 22 }}>
            <View style={styles.days}>
              {days.map((d, i) => (
                <TouchableOpacity
                  key={d.toDateString()}
                  onPress={() => setDayIndex(i)}
                  style={[styles.day, { backgroundColor: i === dayIndex ? c.primary : c.card }]}
                >
                  <Text style={[styles.dayName, { color: i === dayIndex ? c.primaryOnSoft : c.inkSoft }]}>
                    {d.toLocaleDateString("vi-VN", { weekday: "short" })}
                  </Text>
                  <Text style={[styles.dayNum, { color: i === dayIndex ? c.primaryOn : c.ink }]}>{d.getDate()}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Chip bộ môn chỉ có ý nghĩa khi gói của khách phủ từ 2 môn trở lên */}
            {showDisciplines && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
                <TouchableOpacity onPress={() => pickDiscipline(null)} style={chipStyle(!activeDiscipline)}>
                  <Text style={chipTextStyle(!activeDiscipline)}>Tất cả</Text>
                </TouchableOpacity>
                {disciplineChips.map((d) => (
                  <TouchableOpacity
                    key={d.key}
                    onPress={() => pickDiscipline(d.key)}
                    style={chipStyle(activeDiscipline === d.key)}
                  >
                    <Text style={chipTextStyle(activeDiscipline === d.key)}>{d.label}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}

            <View style={styles.filterRow}>
              <TouchableOpacity onPress={() => setOnlyAvailable((v) => !v)} style={chipStyle(onlyAvailable)}>
                <Text style={chipTextStyle(onlyAvailable)}>Còn chỗ</Text>
              </TouchableOpacity>
              {/* flex:1 bắt buộc — ScrollView ngang không tự co, thiếu là tràn mép phải */}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={{ flex: 1 }}
                contentContainerStyle={styles.chipRow}
              >
                <TouchableOpacity onPress={() => setFilterCoach(null)} style={chipStyle(!activeCoach)}>
                  <Text style={chipTextStyle(!activeCoach)}>Tất cả HLV</Text>
                </TouchableOpacity>
                {coachNames.map((n) => (
                  <TouchableOpacity key={n} onPress={() => setFilterCoach(n)} style={chipStyle(activeCoach === n)}>
                    <Text style={chipTextStyle(activeCoach === n)}>{n}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </View>

          <ScrollView
            contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: 100 }}
            refreshControl={<PullRefresh onRefresh={load} />}
          >
            {/* Chỉ khẳng định "ngày trống" khi ĐÃ tải được dữ liệu — lỗi mạng lần đầu thì
                errorMsg ở trên nói lý do, không hiện empty-state sai sự thật (review N1) */}
            {visible.length === 0 && loading && <ActivityIndicator color={c.accent} style={{ marginTop: 24 }} />}
            {visible.length === 0 && !loading && myPackages !== null && !errorMsg && (
              <Text style={[styles.empty, { color: c.inkSoft }]}>
                {dayMatched.length > 0 ? "Không có buổi nào khớp bộ lọc." : "Ngày này chưa có buổi nào."}
              </Text>
            )}

            {visible.map((x, i) => (
              <TimeRow
                key={x.id}
                time={fmtTime(x.startAt)}
                sub={`${Math.round((new Date(x.endAt) - new Date(x.startAt)) / 60000)}'`}
                // her-38: dòng đậm thống nhất mọi vai — tên lớp · loại hình · HLV
                title={classTitle(x)}
                meta={x.spotsLeft === 0 ? "hết chỗ" : `còn ${x.spotsLeft}/${x.capacity} chỗ`}
                last={i === visible.length - 1}
                right={
                  bookedSet.has(String(x.id)) ? (
                    <AppButton variant="ghost" disabled style={styles.smallBtn}>
                      Đã đặt
                    </AppButton>
                  ) : (
                    // Buổi đã kín vẫn hiển thị cho thấy hệ thống đông (góp ý 16/08)
                    <AppButton
                      variant={x.spotsLeft === 0 ? "ghost" : "primary"}
                      disabled={x.spotsLeft === 0 || busy}
                      style={styles.smallBtn}
                      onPress={() => openConfirm(x)}
                    >
                      {x.spotsLeft === 0 ? "Hết chỗ" : "Đặt"}
                    </AppButton>
                  )
                }
              />
            ))}
          </ScrollView>
        </>
      )}

      <FormSheet visible={!!confirm} title="Xác nhận đặt lịch" onClose={closeConfirm}>
        {!!confirm && (() => {
          const it = confirm;
          const pkg = predictPackage(myPackages || [], it);
          const minutes = Math.round((new Date(it.endAt) - new Date(it.startAt)) / 60000);
          return (
            <View>
              <View style={[styles.cRow, { borderBottomColor: c.hairline }]}>
                <Text style={[styles.cLabel, { color: c.inkSoft }]}>Buổi tập</Text>
                <Text style={[styles.cValue, { color: c.ink }]}>{it.name}</Text>
              </View>
              <View style={[styles.cRow, { borderBottomColor: c.hairline }]}>
                <Text style={[styles.cLabel, { color: c.inkSoft }]}>Loại hình</Text>
                <Text style={[styles.cValue, { color: c.ink }]}>{`Buổi ${it.format}`}</Text>
              </View>
              <View style={[styles.cRow, { borderBottomColor: c.hairline }]}>
                <Text style={[styles.cLabel, { color: c.inkSoft }]}>Ngày giờ</Text>
                <Text style={[styles.cValue, { color: c.ink }]}>
                  {fmtDayTime(it.startAt)}{minutes > 0 ? ` · ${minutes} phút` : ""}
                </Text>
              </View>
              <View style={[styles.cRow, { borderBottomColor: c.hairline }]}>
                <Text style={[styles.cLabel, { color: c.inkSoft }]}>HLV</Text>
                <Text style={[styles.cValue, { color: c.ink }]}>{it.coach}</Text>
              </View>
              <View style={styles.cRowLast}>
                <Text style={[styles.cLabel, { color: c.inkSoft }]}>Trừ vào gói</Text>
                {pkg ? (
                  <Text style={[styles.cValue, { color: c.accent }]}>
                    {pkg.name}
                    {pkg.remainingSessions == null ? " · không giới hạn buổi" : ` · còn ${pkg.remainingSessions} buổi`}
                  </Text>
                ) : (
                  <Text style={[styles.cValue, { color: c.inkSoft }]}>
                    Gói hiện tại có thể không đủ điều kiện — hệ thống sẽ kiểm tra khi xác nhận
                  </Text>
                )}
              </View>
              {!!confirmError && <Text style={[styles.cError, { color: c.danger }]}>{confirmError}</Text>}
              <AppButton style={{ marginTop: 18 }} disabled={busy} onPress={() => book(it)}>
                {busy ? "Đang đặt..." : "Xác nhận đặt lịch"}
              </AppButton>
            </View>
          );
        })()}
      </FormSheet>

      {!!toast && (
        <View style={[styles.toast, { backgroundColor: toast.isError ? c.danger : c.accent }]}>
          <Feather name={toast.isError ? "alert-circle" : "check"} size={14} color="#fff" />
          <Text style={styles.toastText}>{toast.msg}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  days: { flexDirection: "row", gap: 6, marginTop: 10, marginBottom: 6 },
  day: { flex: 1, borderRadius: 10, paddingVertical: 8, alignItems: "center" },
  dayName: { fontSize: 10, fontWeight: "700" },
  dayNum: { fontSize: 14, fontWeight: "800" },
  chipRow: { flexDirection: "row", gap: 8, paddingVertical: 6, paddingRight: 8 },
  filterRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  chip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1.5 },
  chipText: { fontSize: 12, fontWeight: "700" },
  error: { fontSize: 12.5, marginHorizontal: 22, marginTop: 10, fontWeight: "700" },
  empty: { fontSize: 13, marginTop: 18 },
  smallBtn: { paddingVertical: 8, paddingHorizontal: 14 },
  noPkg: { flexDirection: "row", gap: 12, borderRadius: 12, padding: 16, marginTop: 10 },
  cRow: { flexDirection: "row", alignItems: "flex-start", gap: 14, paddingVertical: 12, borderBottomWidth: 1 },
  cRowLast: { flexDirection: "row", alignItems: "flex-start", gap: 14, paddingVertical: 12 },
  cLabel: { width: 86, fontSize: 12, fontWeight: "700" },
  cValue: { flex: 1, fontSize: 13.5, fontWeight: "700", lineHeight: 20 },
  cError: { fontSize: 12.5, fontWeight: "700", marginTop: 4 },
  noPkgText: { flex: 1, fontSize: 13, lineHeight: 20, fontWeight: "500" },
  toast: {
    position: "absolute",
    bottom: 90,
    left: 22,
    right: 22,
    borderRadius: 999,
    paddingVertical: 11,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  toastText: { color: "#fff", fontSize: 12.5, flex: 1 },
});
