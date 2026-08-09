import { useState, useCallback, useRef } from "react";
import { View, Text, ScrollView, TextInput, TouchableOpacity, StyleSheet, RefreshControl } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import TopBar from "../components/TopBar";
import Pill from "../components/Pill";
import AppButton from "../components/AppButton";
import { api } from "../api/client";
import { parseQuickDateTime, parseDurationMinutes } from "../utils/quickDateTime";
import { COLORS } from "../theme";

function fmtDateTime(d) {
  return new Date(d).toLocaleString("vi-VN", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const TABS = [
  ["group", "Lớp Group"],
  ["pt", "Khung PT 1:1"],
];

export default function ScheduleBuilderScreen() {
  const [tab, setTab] = useState("group");
  const [trainers, setTrainers] = useState([]);
  const [classes, setClasses] = useState([]);
  const [ptSlots, setPtSlots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  // toast: { msg, isError } — lỗi hiện icon/màu riêng, không giống thông báo thành công
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(false); // chặn bấm đúp tạo/xoá khung giờ

  // form state — tạo khung giờ mới (duration = thời lượng phút, mặc định 60)
  const [form, setForm] = useState({ name: "Pilates Reformer", coachId: "", when: "", capacity: "8", duration: "60" });

  const load = useCallback(async () => {
    setLoading(true); // để RefreshControl hiện spinner đúng lúc kéo làm mới
    try {
      setErrorMsg("");
      // Lấy 60 ngày tới — lễ tân có thể tạo khung giờ xa (kể cả năm sau), phải thấy được ngay
      const to = new Date(Date.now() + 60 * 24 * 3600 * 1000).toISOString();
      const [trainersRes, classesRes, slotsRes] = await Promise.all([
        api.get("/schedule/trainers"),
        api.get("/schedule/classes", { to }),
        api.get("/schedule/pt-slots", { to }),
      ]);
      setTrainers(trainersRes.trainers);
      setClasses(classesRes.classes);
      setPtSlots(slotsRes.slots);
      setForm((f) => ({
        ...f,
        // HLV đang chọn có thể vừa bị khoá (biến mất khỏi danh sách) -> tự chọn lại người đầu
        coachId: trainersRes.trainers.some((t) => t.id === f.coachId)
          ? f.coachId
          : trainersRes.trainers[0]?.id || "",
      }));
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
  const flash = (msg, isError = false) => {
    clearTimeout(toastTimer.current);
    setToast({ msg, isError });
    toastTimer.current = setTimeout(() => setToast(null), isError ? 3500 : 2200);
  };

  // Kiểm tra chung cho cả 2 loại khung giờ: HLV + ngày giờ (không nhận ngày quá khứ) + thời lượng
  const validateForm = () => {
    if (!form.coachId) {
      flash("Chọn HLV phụ trách trước", true);
      return null;
    }
    const parsed = parseQuickDateTime(form.when);
    if (parsed.error) {
      flash(parsed.error, true);
      return null;
    }
    const duration = parseDurationMinutes(form.duration);
    if (duration.error) {
      flash(duration.error, true);
      return null;
    }
    if (tab === "group") {
      const cap = Number(form.capacity);
      if (!Number.isInteger(cap) || cap < 1 || cap > 100) {
        flash("Sức chứa phải là số nguyên từ 1 đến 100", true);
        return null;
      }
    }
    return {
      startAt: parsed.date.toISOString(),
      endAt: new Date(parsed.date.getTime() + duration.minutes * 60 * 1000).toISOString(),
    };
  };

  const createClass = async () => {
    if (busy) return;
    const range = validateForm();
    if (!range) return;
    setBusy(true);
    try {
      await api.post("/schedule/classes", {
        name: form.name,
        coachId: form.coachId,
        ...range,
        capacity: Number(form.capacity),
      });
      flash("Đã tạo khung giờ Group");
      setForm((f) => ({ ...f, when: "" }));
      load();
    } catch (err) {
      flash(err.message, true);
    } finally {
      setBusy(false);
    }
  };

  const createSlot = async () => {
    if (busy) return;
    const range = validateForm();
    if (!range) return;
    setBusy(true);
    try {
      await api.post("/schedule/pt-slots", {
        trainerId: form.coachId,
        ...range,
      });
      flash("Đã tạo khung giờ PT 1:1");
      setForm((f) => ({ ...f, when: "" }));
      load();
    } catch (err) {
      flash(err.message, true);
    } finally {
      setBusy(false);
    }
  };

  const removeClass = async (id) => {
    if (busy) return;
    setBusy(true);
    try {
      await api.delete(`/schedule/classes/${id}`);
      load();
    } catch (err) {
      flash(err.message, true);
    } finally {
      setBusy(false);
    }
  };

  const removeSlot = async (id) => {
    if (busy) return;
    setBusy(true);
    try {
      await api.delete(`/schedule/pt-slots/${id}`);
      load();
    } catch (err) {
      flash(err.message, true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <TopBar title="Xếp lịch HLV" sub="Tạo khung giờ Group / PT 1:1 cho từng huấn luyện viên" />

      <View style={styles.tabs}>
        {TABS.map(([key, label]) => (
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
        <View style={styles.formCard}>
          <Text style={styles.formTitle}>{tab === "group" ? "Tạo khung giờ Group mới" : "Tạo khung giờ PT 1:1 mới"}</Text>

          <Text style={styles.label}>HLV phụ trách</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
            {trainers.map((t) => (
              <TouchableOpacity
                key={t.id}
                onPress={() => setForm((f) => ({ ...f, coachId: t.id }))}
                style={[styles.trainerChip, form.coachId === t.id && styles.trainerChipActive]}
              >
                <Text style={[styles.trainerChipText, form.coachId === t.id && { color: "#fff" }]}>{t.name}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {tab === "group" && (
            <>
              <Text style={styles.label}>Tên lớp</Text>
              <TextInput
                value={form.name}
                onChangeText={(v) => setForm((f) => ({ ...f, name: v }))}
                style={styles.input}
                placeholder="VD: Pilates Reformer"
                placeholderTextColor={COLORS.inkSoft}
              />
              <Text style={styles.label}>Sức chứa</Text>
              <TextInput
                value={form.capacity}
                onChangeText={(v) => setForm((f) => ({ ...f, capacity: v }))}
                keyboardType="number-pad"
                style={styles.input}
              />
            </>
          )}

          <Text style={styles.label}>Ngày giờ (dd/MM HH:mm)</Text>
          <TextInput
            value={form.when}
            onChangeText={(v) => setForm((f) => ({ ...f, when: v }))}
            placeholder="VD: 25/07 07:00"
            placeholderTextColor={COLORS.inkSoft}
            style={styles.input}
          />

          <Text style={styles.label}>Thời lượng (phút)</Text>
          <TextInput
            value={form.duration}
            onChangeText={(v) => setForm((f) => ({ ...f, duration: v }))}
            keyboardType="number-pad"
            placeholder="60"
            placeholderTextColor={COLORS.inkSoft}
            style={styles.input}
          />

          <AppButton disabled={busy} onPress={tab === "group" ? createClass : createSlot}>
            {tab === "group" ? "Tạo khung Group" : "Tạo khung PT 1:1"}
          </AppButton>
        </View>

        {tab === "group" &&
          classes.map((c) => (
            <View key={c.id} style={styles.card}>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{c.name}</Text>
                  <Text style={styles.cardMeta}>{fmtDateTime(c.startAt)} · {c.coach}</Text>
                </View>
                <Pill tone={c.spotsLeft === 0 ? "danger" : "taupe"}>
                  Còn {c.spotsLeft}/{c.capacity}
                </Pill>
              </View>

              {/* Yêu cầu: hiển thị tên khách hàng đã đặt lịch trên khung giờ group */}
              <View style={{ marginTop: 8 }}>
                {c.customerNames.length === 0 ? (
                  <Text style={styles.emptyNames}>Chưa có khách đặt</Text>
                ) : (
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                    {c.customerNames.map((n, i) => (
                      <View key={i} style={styles.namePill}>
                        <Text style={styles.namePillText}>{n}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>

              {c.customerNames.length === 0 && (
                <View style={{ marginTop: 10 }}>
                  <AppButton variant="outline" disabled={busy} onPress={() => removeClass(c.id)}>Xoá khung giờ</AppButton>
                </View>
              )}
            </View>
          ))}

        {tab === "pt" &&
          ptSlots.map((s) => (
            <View key={s.id} style={styles.card}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{s.trainer}</Text>
                  <Text style={styles.cardMeta}>{fmtDateTime(s.startAt)}</Text>
                </View>
                <Pill tone={s.isBooked ? "danger" : "taupe"}>{s.isBooked ? "Đã có khách" : "Còn trống"}</Pill>
              </View>
              {!s.isBooked && (
                <View style={{ marginTop: 10 }}>
                  <AppButton variant="outline" disabled={busy} onPress={() => removeSlot(s.id)}>Xoá khung giờ</AppButton>
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
  tabs: { flexDirection: "row", marginHorizontal: 20, marginBottom: 14, backgroundColor: "#EFEAE1", borderRadius: 12, padding: 4 },
  tabBtn: { flex: 1, paddingVertical: 9, borderRadius: 9, alignItems: "center" },
  tabBtnActive: { backgroundColor: COLORS.card },
  tabLabel: { fontWeight: "700", fontSize: 12.5, color: COLORS.inkSoft },
  errorText: { marginHorizontal: 20, marginBottom: 10, color: COLORS.ink, fontSize: 12.5 },
  formCard: { backgroundColor: COLORS.card, borderRadius: 16, padding: 14, gap: 4 },
  formTitle: { fontWeight: "800", fontSize: 14, color: COLORS.ink, marginBottom: 6 },
  label: { fontSize: 11.5, color: COLORS.inkSoft, fontWeight: "700", marginTop: 8, marginBottom: 5 },
  input: {
    borderWidth: 1.5,
    borderColor: COLORS.line,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 13.5,
    color: COLORS.ink,
    marginBottom: 10,
  },
  trainerChip: { paddingVertical: 7, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1.5, borderColor: COLORS.line },
  trainerChipActive: { backgroundColor: COLORS.ink, borderColor: COLORS.ink },
  trainerChipText: { fontSize: 12.5, fontWeight: "700", color: COLORS.ink },
  card: { backgroundColor: COLORS.card, borderRadius: 16, padding: 14 },
  cardTitle: { fontWeight: "800", fontSize: 14, color: COLORS.ink },
  cardMeta: { fontSize: 12, color: COLORS.inkSoft, marginTop: 3 },
  emptyNames: { fontSize: 12, color: COLORS.inkSoft },
  namePill: { backgroundColor: "#F1EEE7", borderRadius: 8, paddingVertical: 4, paddingHorizontal: 8 },
  namePillText: { fontSize: 11.5, color: COLORS.ink, fontWeight: "600" },
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
