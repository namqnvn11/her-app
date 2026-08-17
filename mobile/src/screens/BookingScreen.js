import { useState, useCallback, useRef } from "react";
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl } from "react-native";
import { useFocusEffect, useNavigation, useRoute } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import TopBar from "../components/TopBar";
import TimeRow from "../components/TimeRow";
import AppButton from "../components/AppButton";
import FormSheet from "../components/FormSheet";
import { api } from "../api/client";
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

// Dự đoán gói sẽ bị trừ — CHỈ để hiển thị màn xác nhận (mục 3). Bản sao luật Q4:
// gói CÓ hạn còn phủ ngày tập, hạn gần trước; hết mới tới gói không hạn, kích hoạt trước
// trước. Quyết định thật vẫn ở server (chargeSession) — lệch thì message server là chốt.
function predictPackage(packages, serviceType, startAt) {
  const usable = packages.filter(
    (p) =>
      p.status === "active" &&
      p.serviceType === serviceType &&
      (p.remainingSessions == null || p.remainingSessions > 0)
  );
  const start = new Date(startAt);
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

// Mục 2 (bản gửi khách): tab theo BỘ MÔN, chỉ hiện tab khách đang có gói còn hiệu lực —
// lớp không thuộc gói ẨN HẲN. Đây chỉ là lớp hiển thị; luật thật vẫn ở server (H7, C1).
const GROUP_TABS = [
  ["pilates", "Pilates"],
  ["yoga", "Yoga"],
  ["gym", "Gym"],
];

export default function BookingScreen() {
  const route = useRoute();
  const navigation = useNavigation();
  const { c } = useTheme();
  // tab = serviceType ("pilates"/"yoga"/"gym") hoặc "pt"; null = chưa chọn -> tab đầu tiên
  const [tab, setTab] = useState(null);
  const [dayIndex, setDayIndex] = useState(0);
  const [classes, setClasses] = useState([]);
  const [trainers, setTrainers] = useState([]);
  // null = đang tải danh sách gói; [] = không có gói còn hiệu lực
  const [myTypes, setMyTypes] = useState(null);
  const [myPackages, setMyPackages] = useState([]);
  const [myBookedIds, setMyBookedIds] = useState([]);
  const [hasPausedOnly, setHasPausedOnly] = useState(false);
  // Màn xác nhận trước khi chốt (mục 3): { kind: "group"|"pt", item } | null
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
      const [classesRes, trainersRes, pkgRes, myBkRes] = await Promise.all([
        api.get("/classes"),
        api.get("/trainers"),
        api.get("/me/packages"),
        api.get("/me/bookings"),
      ]);
      setClasses(classesRes.classes);
      setTrainers(trainersRes.trainers);
      // Lớp/slot mình ĐÃ đặt -> hiện nút "Đã đặt" ngay trên danh sách (góp ý 16/08)
      setMyBookedIds(myBkRes.bookings.map((b) => String(b.classId || b.slotId)).filter(Boolean));
      const active = pkgRes.packages.filter((p) => p.status === "active");
      setMyPackages(pkgRes.packages);
      setMyTypes([...new Set(active.map((p) => p.serviceType))]);
      setHasPausedOnly(active.length === 0 && pkgRes.packages.some((p) => p.status === "paused"));
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (route.params?.initialTab === "pt") {
        setTab("pt"); // khách không có gói PT thì activeTab tự rơi về tab đầu
        navigation.setParams({ initialTab: undefined });
      } else if (route.params?.initialTab === "group") {
        setTab(null); // null -> tab bộ môn đầu tiên khách có
        navigation.setParams({ initialTab: undefined });
      }
      load();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [load, route.params?.initialTab])
  );

  // Clear timer cũ để toast lỗi không bị toast trước đó "giết non" giữa chừng
  const toastTimer = useRef(null);
  const flash = (msg, isError = false) => {
    clearTimeout(toastTimer.current);
    setToast({ msg, isError });
    toastTimer.current = setTimeout(() => setToast(null), isError ? 3500 : 2200);
  };

  const book = async (payload, successMsg) => {
    if (busyRef.current) return; // chặn bấm đúp — 1 lần đặt, trừ 1 buổi
    busyRef.current = true;
    setBusy(true);
    const bookedId = payload.classId || payload.slotId;
    try {
      await api.post("/bookings", payload);
      confirmIdRef.current = null;
      setConfirm(null);
      flash(successMsg);
      load();
    } catch (err) {
      const msg = err.message || "Không thể đặt lịch, vui lòng thử lại";
      // Lỗi hiện NGAY TRONG sheet xác nhận — toast ngoài màn bị Modal che (L8).
      // Sheet đã đóng/đã đổi sang buổi khác thì rơi về toast, không nuốt và không hiện lạc chỗ.
      if (confirmIdRef.current === bookedId) setConfirmError(msg);
      else flash(msg, true);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const openConfirm = (kind, item) => {
    setConfirmError("");
    confirmIdRef.current = item.id;
    setConfirm({ kind, item });
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

  // Bộ tab khả dụng: chỉ bộ môn khách có gói active, thứ tự cố định; PT cuối cùng
  const availableTabs = GROUP_TABS.filter(([key]) => myTypes?.includes(key));
  if (myTypes?.includes("pt")) availableTabs.push(["pt", "PT"]); // tab chứa cả PT 1:1 lẫn PT nhóm
  // Tab đang chọn không còn khả dụng (gói vừa hết...) -> rơi về tab đầu
  const activeTab = availableTabs.some(([k]) => k === tab) ? tab : availableTabs[0]?.[0] ?? null;

  const dayClasses = classes.filter(
    (x) => x.serviceType === activeTab && dayKey(x.startAt) === dayKey(activeDay)
  );
  const daySlots = trainers.flatMap((t) =>
    (t.slots || [])
      .filter((s) => dayKey(s.startAt) === dayKey(activeDay))
      .map((s) => ({ ...s, trainer: t.name, specialty: t.specialty }))
  );
  const sorted = (activeTab === "pt" ? daySlots : dayClasses)
    .slice()
    .sort((a, b) => new Date(a.startAt) - new Date(b.startAt));

  // Khách không có gói còn hiệu lực: không hiện danh sách — hướng dẫn liên hệ quầy (mục 2)
  const noPackage = myTypes !== null && availableTabs.length === 0;

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <TopBar title="Đặt lịch" />

      {!!errorMsg && <Text style={[styles.error, { color: c.danger }]}>{errorMsg}</Text>}

      {noPackage ? (
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 22, paddingTop: 8 }}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={c.primary} />}
        >
          <View style={[styles.noPkg, { backgroundColor: c.primarySoft }]}>
            <Feather name="info" size={18} color={c.primary} />
            <Text style={[styles.noPkgText, { color: c.primary }]}>
              {hasPausedOnly
                ? "Gói của bạn đang bảo lưu — ghé quầy lễ tân để mở lại là đặt lịch được ngay."
                : "Bạn chưa có gói tập còn hiệu lực. Ghé quầy lễ tân để mua gói — có gói là màn này sẽ hiện lịch của đúng bộ môn bạn tập."}
            </Text>
          </View>
        </ScrollView>
      ) : (
        <>
          <View style={{ paddingHorizontal: 22 }}>
            <View style={[styles.tabs, { borderBottomColor: c.line }]}>
              {availableTabs.map(([key, label]) => (
                <TouchableOpacity
                  key={key}
                  onPress={() => setTab(key)}
                  style={[styles.tabBtn, activeTab === key && { borderBottomWidth: 2.5, borderBottomColor: c.primary }]}
                >
                  <Text style={[styles.tabLabel, { color: activeTab === key ? c.primary : c.inkSoft }]}>{label}</Text>
                </TouchableOpacity>
              ))}
            </View>

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
          </View>

          <ScrollView
            contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: 100 }}
            refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={c.primary} />}
          >
            {/* Chỉ khẳng định "ngày trống" khi ĐÃ tải được dữ liệu — lỗi mạng lần đầu thì
                errorMsg ở trên nói lý do, không hiện empty-state sai sự thật (review N1) */}
            {sorted.length === 0 && !loading && myTypes !== null && !errorMsg && (
              <Text style={[styles.empty, { color: c.inkSoft }]}>Ngày này chưa có khung giờ nào.</Text>
            )}

            {activeTab !== "pt" &&
              sorted.map((x, i) => (
                <TimeRow
                  key={x.id}
                  time={fmtTime(x.startAt)}
                  sub={`${Math.round((new Date(x.endAt) - new Date(x.startAt)) / 60000)}'`}
                  title={x.name}
                  meta={x.spotsLeft === 0 ? `${x.coach} · hết chỗ` : `${x.coach} · còn ${x.spotsLeft}/${x.capacity} chỗ`}
                  last={i === sorted.length - 1}
                  right={
                    myBookedIds.includes(String(x.id)) ? (
                      <AppButton variant="ghost" disabled style={styles.smallBtn}>
                        Đã đặt
                      </AppButton>
                    ) : (
                      <AppButton
                        variant={x.spotsLeft === 0 ? "ghost" : "primary"}
                        disabled={x.spotsLeft === 0 || busy}
                        style={styles.smallBtn}
                        onPress={() => openConfirm("group", x)}
                      >
                        {x.spotsLeft === 0 ? "Hết chỗ" : "Đặt"}
                      </AppButton>
                    )
                  }
                />
              ))}

            {activeTab === "pt" &&
              sorted.map((s, i) => (
                <TimeRow
                  key={s.id}
                  time={fmtTime(s.startAt)}
                  title={`${s.capacity > 1 ? "PT nhóm" : "PT"} — ${s.trainer}`}
                  meta={
                    s.capacity > 1
                      ? `${s.specialty ? `${s.specialty} · ` : ""}còn ${Math.max(s.capacity - s.bookedCount, 0)}/${s.capacity} chỗ`
                      : s.specialty
                  }
                  last={i === sorted.length - 1}
                  right={
                    myBookedIds.includes(String(s.id)) ? (
                      <AppButton variant="ghost" disabled style={styles.smallBtn}>
                        Đã đặt
                      </AppButton>
                    ) : s.full ? (
                      // Slot đã kín vẫn hiển thị cho thấy hệ thống đông (góp ý 16/08)
                      <AppButton variant="ghost" disabled style={styles.smallBtn}>
                        Hết chỗ
                      </AppButton>
                    ) : (
                      <AppButton disabled={busy} style={styles.smallBtn} onPress={() => openConfirm("pt", s)}>
                        Đặt
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
          const it = confirm.item;
          const isPT = confirm.kind === "pt";
          const serviceType = isPT ? "pt" : it.serviceType;
          const pkg = predictPackage(myPackages, serviceType, it.startAt);
          const minutes = Math.round((new Date(it.endAt) - new Date(it.startAt)) / 60000);
          return (
            <View>
              <View style={[styles.cRow, { borderBottomColor: c.hairline }]}>
                <Text style={[styles.cLabel, { color: c.inkSoft }]}>Buổi tập</Text>
                <Text style={[styles.cValue, { color: c.ink }]}>
                  {isPT ? (it.capacity > 1 ? "Buổi PT nhóm" : "Buổi PT 1:1") : it.name}
                </Text>
              </View>
              <View style={[styles.cRow, { borderBottomColor: c.hairline }]}>
                <Text style={[styles.cLabel, { color: c.inkSoft }]}>Ngày giờ</Text>
                <Text style={[styles.cValue, { color: c.ink }]}>
                  {fmtDayTime(it.startAt)}{minutes > 0 ? ` · ${minutes} phút` : ""}
                </Text>
              </View>
              <View style={[styles.cRow, { borderBottomColor: c.hairline }]}>
                <Text style={[styles.cLabel, { color: c.inkSoft }]}>HLV</Text>
                <Text style={[styles.cValue, { color: c.ink }]}>{isPT ? it.trainer : it.coach}</Text>
              </View>
              <View style={styles.cRowLast}>
                <Text style={[styles.cLabel, { color: c.inkSoft }]}>Trừ vào gói</Text>
                {pkg ? (
                  <Text style={[styles.cValue, { color: c.primary }]}>
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
              <AppButton
                style={{ marginTop: 18 }}
                disabled={busy}
                onPress={() =>
                  book(
                    isPT ? { type: "pt", slotId: it.id } : { type: "group", classId: it.id },
                    isPT ? `Đã đặt lịch với ${it.trainer}` : `Đã đặt lịch: ${it.name}`
                  )
                }
              >
                {busy ? "Đang đặt..." : "Xác nhận đặt lịch"}
              </AppButton>
            </View>
          );
        })()}
      </FormSheet>

      {!!toast && (
        <View style={[styles.toast, { backgroundColor: toast.isError ? c.danger : c.primary }]}>
          <Feather name={toast.isError ? "alert-circle" : "check"} size={14} color="#fff" />
          <Text style={styles.toastText}>{toast.msg}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  tabs: { flexDirection: "row", gap: 20, borderBottomWidth: 1, marginTop: 4 },
  tabBtn: { paddingBottom: 9 },
  tabLabel: { fontSize: 13, fontWeight: "700" },
  days: { flexDirection: "row", gap: 6, marginTop: 14, marginBottom: 6 },
  day: { flex: 1, borderRadius: 10, paddingVertical: 8, alignItems: "center" },
  dayName: { fontSize: 10, fontWeight: "700" },
  dayNum: { fontSize: 14, fontWeight: "800" },
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
