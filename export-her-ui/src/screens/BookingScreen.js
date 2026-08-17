import { useState, useCallback, useRef, useMemo } from "react";
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl } from "react-native";
import { useFocusEffect, useNavigation, useRoute } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import TopBar from "../components/TopBar";
import TimeRow from "../components/TimeRow";
import AppButton from "../components/AppButton";
import { api } from "../api/client";
import { useTheme } from "../theme";

function fmtTime(d) {
  return new Date(d).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
}
function dayKey(d) {
  return new Date(d).toDateString();
}

export default function BookingScreen() {
  const route = useRoute();
  const navigation = useNavigation();
  const { c } = useTheme();
  const [tab, setTab] = useState(route.params?.initialTab === "pt" ? "pt" : "group");
  const [dayIndex, setDayIndex] = useState(0);
  const [classes, setClasses] = useState([]);
  const [trainers, setTrainers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setErrorMsg("");
      const [classesRes, trainersRes] = await Promise.all([api.get("/classes"), api.get("/trainers")]);
      setClasses(classesRes.classes);
      setTrainers(trainersRes.trainers);
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (route.params?.initialTab === "pt" || route.params?.initialTab === "group") {
        setTab(route.params.initialTab);
        navigation.setParams({ initialTab: undefined });
      }
      load();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [load, route.params?.initialTab])
  );

  const toastTimer = useRef(null);
  const flash = (msg, isError = false) => {
    clearTimeout(toastTimer.current);
    setToast({ msg, isError });
    toastTimer.current = setTimeout(() => setToast(null), isError ? 3500 : 2200);
  };

  const book = async (payload, successMsg) => {
    if (busy) return;
    setBusy(true);
    try {
      await api.post("/bookings", payload);
      flash(successMsg);
      load();
    } catch (err) {
      flash(err.message || "Không thể đặt lịch, vui lòng thử lại", true);
    } finally {
      setBusy(false);
    }
  };

  // 7 ngày tới làm dải chọn ngày
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => new Date(Date.now() + i * 86400000)),
    []
  );
  const activeDay = days[dayIndex];

  const dayClasses = classes.filter((x) => dayKey(x.startAt) === dayKey(activeDay));
  const daySlots = trainers.flatMap((t) =>
    (t.slots || [])
      .filter((s) => dayKey(s.startAt) === dayKey(activeDay))
      .map((s) => ({ ...s, trainer: t.name, specialty: t.specialty }))
  );
  const sorted = (tab === "group" ? dayClasses : daySlots).slice().sort((a, b) => new Date(a.startAt) - new Date(b.startAt));

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <TopBar title="Đặt lịch" />

      <View style={{ paddingHorizontal: 22 }}>
        <View style={[styles.tabs, { borderBottomColor: c.line }]}>
          {[
            ["group", "Lớp Group"],
            ["pt", "PT 1:1"],
          ].map(([key, label]) => (
            <TouchableOpacity
              key={key}
              onPress={() => setTab(key)}
              style={[styles.tabBtn, tab === key && { borderBottomWidth: 2.5, borderBottomColor: c.primary }]}
            >
              <Text style={[styles.tabLabel, { color: tab === key ? c.primary : c.inkSoft }]}>{label}</Text>
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
              <Text style={[styles.dayName, { color: i === dayIndex ? "#F0D8CE" : c.inkSoft }]}>
                {d.toLocaleDateString("vi-VN", { weekday: "short" })}
              </Text>
              <Text style={[styles.dayNum, { color: i === dayIndex ? "#fff" : c.ink }]}>{d.getDate()}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {!!errorMsg && <Text style={[styles.error, { color: c.primary }]}>{errorMsg}</Text>}

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: 100 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={c.primary} />}
      >
        {sorted.length === 0 && !loading && (
          <Text style={[styles.empty, { color: c.inkSoft }]}>Ngày này chưa có khung giờ nào.</Text>
        )}

        {tab === "group" &&
          sorted.map((x, i) => (
            <TimeRow
              key={x.id}
              time={fmtTime(x.startAt)}
              sub={`${Math.round((new Date(x.endAt) - new Date(x.startAt)) / 60000)}'`}
              title={x.name}
              meta={x.spotsLeft === 0 ? `${x.coach} · hết chỗ` : `${x.coach} · còn ${x.spotsLeft}/${x.capacity} chỗ`}
              last={i === sorted.length - 1}
              right={
                <AppButton
                  variant={x.spotsLeft === 0 ? "ghost" : "primary"}
                  disabled={x.spotsLeft === 0 || busy}
                  style={styles.smallBtn}
                  onPress={() => book({ type: "group", classId: x.id }, `Đã đặt lịch: ${x.name}`)}
                >
                  {x.spotsLeft === 0 ? "Hết chỗ" : "Đặt"}
                </AppButton>
              }
            />
          ))}

        {tab === "pt" &&
          sorted.map((s, i) => (
            <TimeRow
              key={s.id}
              time={fmtTime(s.startAt)}
              title={`PT — ${s.trainer}`}
              meta={s.specialty}
              last={i === sorted.length - 1}
              right={
                <AppButton
                  disabled={busy}
                  style={styles.smallBtn}
                  onPress={() => book({ type: "pt", slotId: s.id }, `Đã đặt lịch với ${s.trainer}`)}
                >
                  Đặt
                </AppButton>
              }
            />
          ))}
      </ScrollView>

      {!!toast && (
        <View style={[styles.toast, { backgroundColor: toast.isError ? "#8C3A3A" : c.primary }]}>
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
