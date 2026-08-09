import { useState, useCallback, useRef } from "react";
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl } from "react-native";
import { useFocusEffect, useNavigation, useRoute } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import TopBar from "../components/TopBar";
import Pill from "../components/Pill";
import AppButton from "../components/AppButton";
import { api } from "../api/client";
import { COLORS } from "../theme";

function fmtTime(d) {
  return new Date(d).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
}
function fmtSlot(d) {
  return new Date(d).toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export default function BookingScreen() {
  const route = useRoute();
  const navigation = useNavigation();
  const [tab, setTab] = useState(route.params?.initialTab === "pt" ? "pt" : "group");
  const [classes, setClasses] = useState([]);
  const [trainers, setTrainers] = useState([]);
  const [loading, setLoading] = useState(true);
  // toast: { msg, isError } — lỗi hiện ĐÚNG lý do server trả về (L8), không dùng câu chung chung
  const [toast, setToast] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");
  // Chặn bấm đúp khi request đang chạy (server đã chống race, đây là phần UX)
  const [busy, setBusy] = useState(false);
  // HLV nào đang mở rộng danh sách khung giờ (mặc định chỉ hiện 6 khung đầu)
  const [expandedTrainers, setExpandedTrainers] = useState({});

  const load = useCallback(async () => {
    setLoading(true); // để RefreshControl hiện spinner đúng lúc kéo làm mới
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
        // Xoá param sau khi dùng — không thì mỗi lần quay lại tab đều bị ép về tab cũ
        navigation.setParams({ initialTab: undefined });
      }
      load();
    }, [load, route.params?.initialTab])
  );

  // Clear timer cũ để toast lỗi không bị toast trước đó "giết non" giữa chừng.
  // Lỗi cho khách đọc lâu hơn (3.5s) — message có nội dung cụ thể (hết chỗ, hết buổi...)
  const toastTimer = useRef(null);
  const flash = (msg, isError = false) => {
    clearTimeout(toastTimer.current);
    setToast({ msg, isError });
    toastTimer.current = setTimeout(() => setToast(null), isError ? 3500 : 2200);
  };

  const bookGroup = async (classId, name) => {
    if (busy) return;
    setBusy(true);
    try {
      await api.post("/bookings", { type: "group", classId });
      flash(`Đã đặt lịch: ${name}`);
      load();
    } catch (err) {
      flash(err.message || "Không thể đặt lịch, vui lòng thử lại", true);
    } finally {
      setBusy(false);
    }
  };

  const bookPT = async (slotId, trainerName) => {
    if (busy) return;
    setBusy(true);
    try {
      await api.post("/bookings", { type: "pt", slotId });
      flash(`Đã đặt lịch với ${trainerName}`);
      load();
    } catch (err) {
      flash(err.message || "Không thể đặt lịch, vui lòng thử lại", true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <TopBar title="Đặt lịch tập" />

      <View style={styles.tabs}>
        {[
          ["group", "Lớp Group"],
          ["pt", "PT 1:1"],
        ].map(([key, label]) => (
          <TouchableOpacity
            key={key}
            onPress={() => setTab(key)}
            style={[styles.tabBtn, tab === key && styles.tabBtnActive]}
          >
            <Text style={[styles.tabLabel, tab === key && { color: COLORS.ink }]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {!!errorMsg && <Text style={styles.errorText}>{errorMsg}</Text>}

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 100, gap: 10 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={COLORS.ink} />}
      >
        {tab === "group" &&
          (classes.length === 0 && !loading ? (
            <Text style={{ color: COLORS.inkSoft, fontSize: 13 }}>Chưa có lớp nào trong 7 ngày tới.</Text>
          ) : (
            classes.map((c) => (
              <View key={c.id} style={styles.card}>
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardTitle}>{c.name}</Text>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginTop: 3 }}>
                      <Feather name="clock" size={12} color={COLORS.inkSoft} />
                      <Text style={styles.cardMeta}>
                        {new Date(c.startAt).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" })} ·{" "}
                        {fmtTime(c.startAt)}-{fmtTime(c.endAt)} · {c.coach}
                      </Text>
                    </View>
                  </View>
                  <Pill tone={c.spotsLeft === 0 ? "danger" : "taupe"}>
                    {c.spotsLeft === 0 ? "Hết chỗ" : `Còn ${c.spotsLeft}/${c.capacity}`}
                  </Pill>
                </View>
                <View style={{ marginTop: 10 }}>
                  <AppButton
                    variant={c.spotsLeft === 0 ? "outline" : "primary"}
                    disabled={c.spotsLeft === 0 || busy}
                    onPress={() => bookGroup(c.id, c.name)}
                  >
                    {c.spotsLeft === 0 ? "Hết chỗ" : "Đăng ký"}
                  </AppButton>
                </View>
              </View>
            ))
          ))}

        {tab === "pt" &&
          trainers.map((t) => (
            <View key={t.id} style={styles.card}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <View style={styles.avatar}>
                    <Text style={{ fontWeight: "800", color: COLORS.ink }}>{t.name.split(" ").pop()[0]}</Text>
                  </View>
                  <View>
                    <Text style={styles.cardTitle}>{t.name}</Text>
                    <Text style={styles.cardMetaSmall}>{t.specialty}</Text>
                  </View>
                </View>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
                  <Feather name="star" size={12} color={COLORS.beigeDark} />
                  <Text style={{ fontSize: 12, color: COLORS.beigeDark, fontWeight: "700" }}>{t.rating}</Text>
                </View>
              </View>

              {t.slots.length === 0 ? (
                <Text style={{ fontSize: 12, color: COLORS.inkSoft, marginTop: 10 }}>
                  Chưa có khung giờ trống trong 7 ngày tới.
                </Text>
              ) : (
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
                  {(expandedTrainers[t.id] ? t.slots : t.slots.slice(0, 6)).map((s) => (
                    <TouchableOpacity key={s.id} disabled={busy} onPress={() => bookPT(s.id, t.name)} style={styles.slotBtn}>
                      <Text style={styles.slotText}>{fmtSlot(s.startAt)}</Text>
                    </TouchableOpacity>
                  ))}
                  {t.slots.length > 6 && !expandedTrainers[t.id] && (
                    <TouchableOpacity
                      onPress={() => setExpandedTrainers((e) => ({ ...e, [t.id]: true }))}
                      style={[styles.slotBtn, styles.moreBtn]}
                    >
                      <Text style={styles.slotText}>+{t.slots.length - 6} khung nữa</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </View>
          ))}
      </ScrollView>

      {!!toast && (
        <View style={[styles.toast, toast.isError && styles.toastError]}>
          <Feather name={toast.isError ? "alert-circle" : "check"} size={14} color="#fff" />
          <Text style={styles.toastText}>{toast.msg}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  tabs: { flexDirection: "row", marginHorizontal: 20, marginBottom: 16, backgroundColor: "#EFEAE1", borderRadius: 12, padding: 4 },
  tabBtn: { flex: 1, paddingVertical: 9, borderRadius: 9, alignItems: "center" },
  tabBtnActive: { backgroundColor: COLORS.card },
  tabLabel: { fontWeight: "700", fontSize: 13, color: COLORS.inkSoft },
  errorText: { marginHorizontal: 20, marginBottom: 10, color: COLORS.ink, fontSize: 12.5 },
  card: { backgroundColor: COLORS.card, borderRadius: 16, padding: 14 },
  cardTitle: { fontWeight: "800", fontSize: 14, color: COLORS.ink },
  cardMeta: { fontSize: 12, color: COLORS.inkSoft },
  cardMetaSmall: { fontSize: 11.5, color: COLORS.inkSoft },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.beige, alignItems: "center", justifyContent: "center" },
  slotBtn: { paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, borderWidth: 1.5, borderColor: COLORS.line, alignItems: "center" },
  moreBtn: { backgroundColor: "#F1EEE7", borderStyle: "dashed" },
  slotText: { fontSize: 12, fontWeight: "700", color: COLORS.ink },
  toast: {
    position: "absolute",
    bottom: 90,
    left: 20,
    right: 20,
    backgroundColor: COLORS.ink,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  toastText: { color: "#fff", fontSize: 12.5, flex: 1 },
  toastError: { backgroundColor: "#8C3A3A" },
});