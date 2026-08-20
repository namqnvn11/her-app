import { useState, useCallback, useEffect } from "react";
import { View, Text, ScrollView, TextInput, TouchableOpacity, StyleSheet, RefreshControl } from "react-native";
import { Feather } from "@expo/vector-icons";
import TopBar from "../components/TopBar";
import AppButton from "../components/AppButton";
import SectionLabel from "../components/SectionLabel";
import FormSheet from "../components/FormSheet";
import ConfirmSheet from "../components/ConfirmSheet";
import DateTimeField from "../components/DateTimeField";
import { api } from "../api/client";
import { FORMATS, FORMAT_18_SERVICE, disciplinesFor, coachesFor } from "../utils/formats";
import { useTheme } from "../theme";

// her-32: LỊCH TỰ ĐỘNG — quầy đặt luật (bộ môn + HLV + giờ + các thứ trong tuần), hệ thống
// tự sinh lớp phủ trước 7 ngày (đúng tầm thấy của học viên). Buổi đã sinh là độc lập —
// admin sửa/xoá tuỳ ý, không bị sinh lại. Sửa luật = xoá tạo lại (UI tối giản).

const WEEKDAYS = [
  [1, "T2"], [2, "T3"], [3, "T4"], [4, "T5"], [5, "T6"], [6, "T7"], [0, "CN"],
];
// her-35: luật sinh lớp theo LOẠI HÌNH — sức chứa do server gán (1/2/4/8), bỏ ô sức chứa
const pad = (n) => String(n).padStart(2, "0");
const dayLabels = (days) =>
  days.length === 7 ? "Hằng ngày" : WEEKDAYS.filter(([d]) => days.includes(d)).map(([, l]) => l).join(" · ");

// HLV đang chọn còn hợp bộ môn thì GIỮ; không hợp mà bộ môn chỉ có ĐÚNG 1 HLV thì
// chọn sẵn luôn (như form tạo buổi ở Lịch tập) — khỏi bắt bấm thêm 1 nhát thừa
const pickCoach = (trainerList, disciplineKey, currentId) => {
  const pool = coachesFor(trainerList, disciplineKey);
  if (pool.some((t) => t.id === currentId)) return currentId;
  return pool.length === 1 ? pool[0].id : "";
};

export default function AutoScheduleScreen({ onBack }) {
  const { c } = useTheme();
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const [disciplines, setDisciplines] = useState([]);
  const [trainers, setTrainers] = useState([]);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetError, setSheetError] = useState("");
  // days mặc định RỖNG — chọn sẵn cả tuần làm người dùng tưởng chưa chọn (góp ý 18/08)
  // her-36: name = tên riêng cho MỌI buổi luật sinh ra (tuỳ chọn — bỏ trống = tên bộ môn)
  const [form, setForm] = useState({ format: "1:4", discipline: "", coachId: "", name: "", time: "", days: [] });
  const [confirmDelete, setConfirmDelete] = useState(null); // rule | null

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setErrorMsg("");
      const [rulesRes, discRes, trRes] = await Promise.all([
        api.get("/auto-schedule"),
        api.get("/disciplines"),
        api.get("/schedule/trainers"),
      ]);
      setRules(rulesRes.rules);
      const discList = discRes.disciplines.map((d) => [d.key, d.label]);
      setDisciplines(discList);
      setTrainers(trRes.trainers);
      setForm((f) => {
        // Bộ môn mặc định phải hợp loại hình đang chọn (1:8 chỉ Yoga)
        const allowed = disciplinesFor(discList, f.format);
        const discipline =
          f.discipline && allowed.some(([k]) => k === f.discipline)
            ? f.discipline
            : allowed[0]?.[0] || "";
        return { ...f, discipline, coachId: pickCoach(trRes.trainers, discipline, f.coachId) };
      });
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // her-19/her-35: HLV lọc theo chuyên môn, bộ môn lọc theo loại hình — utils/formats.js
  const coaches = (key) => coachesFor(trainers, key);
  const disciplineChips = (format) => disciplinesFor(disciplines, format);
  // Chọn 1:8 thì tự sang Yoga — chỉ khi danh mục THẬT SỰ có Yoga (khớp fallback của load)
  const disciplineForFormat = (format, current) => {
    if (format !== "1:8") return current;
    return disciplines.some(([k]) => k === FORMAT_18_SERVICE) ? FORMAT_18_SERVICE : "";
  };

  const create = async () => {
    if (busy) return;
    if (!form.format) return setSheetError("Chọn loại hình");
    if (!form.discipline) return setSheetError("Chọn bộ môn");
    if (!form.coachId) return setSheetError("Chọn HLV phụ trách");
    const m = /^(\d{1,2}):(\d{2})$/.exec(form.time.trim());
    if (!m) return setSheetError('Chưa chọn giờ — bấm ô "Chọn giờ"');
    if (!form.days.length) return setSheetError("Chọn ít nhất 1 thứ trong tuần");
    setSheetError("");
    setBusy(true);
    try {
      const typedName = form.name.trim();
      await api.post("/auto-schedule", {
        ...(typedName ? { name: typedName } : {}), // her-36: bỏ trống -> server lấy tên bộ môn
        format: form.format, // sức chứa do server gán theo loại hình (her-35)
        serviceType: form.discipline,
        coachId: form.coachId,
        hour: Number(m[1]),
        minute: Number(m[2]),
        daysOfWeek: form.days,
      });
      setSheetOpen(false);
      // Tạo xong thì xoá tên + giờ + các thứ đã chọn — luật kế tiếp bắt đầu từ trang trắng
      setForm((f) => ({ ...f, name: "", time: "", days: [] }));
      load();
    } catch (err) {
      setSheetError(err.message); // hiện trong sheet — không để lỗi chìm sau Modal (L8)
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (rule) => {
    if (busy) return;
    setBusy(true);
    try {
      await api.patch(`/auto-schedule/${rule.id}`, { active: !rule.active });
      load();
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id) => {
    if (busy) return;
    setBusy(true);
    try {
      await api.delete(`/auto-schedule/${id}`);
      setConfirmDelete(null);
      load();
    } catch (err) {
      setErrorMsg(err.message);
      setConfirmDelete(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 110 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={c.primary} />}
      >
        <TopBar title="Lịch tự động" sub="Lớp được tự tạo sẵn cho 7 ngày tới để học viên đăng ký" onBack={onBack} />

        <View style={{ paddingHorizontal: 22 }}>
          {!!errorMsg && <Text style={[styles.error, { color: c.danger }]}>{errorMsg}</Text>}

          {rules.length === 0 && !loading && (
            <Text style={[styles.empty, { color: c.inkSoft }]}>Chưa có lịch tự động nào.</Text>
          )}
          {rules.map((r, i) => (
            <View
              key={r.id}
              style={[styles.row, i !== rules.length - 1 && { borderBottomWidth: 1, borderBottomColor: c.hairline }]}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.rowTitle, { color: r.active ? c.ink : c.inkSoft }]}>
                  {pad(r.hour)}:{pad(r.minute)} · {r.name} · {r.format}
                </Text>
                <Text style={[styles.rowMeta, { color: c.inkSoft }]}>
                  {r.coach} · {dayLabels(r.daysOfWeek)}{r.active ? "" : " · Đang tắt"}
                </Text>
                <View style={{ flexDirection: "row", gap: 16, marginTop: 6 }}>
                  <TouchableOpacity disabled={busy} hitSlop={8} onPress={() => toggle(r)}>
                    <Text style={[styles.link, { color: c.primary }]}>{r.active ? "Tắt" : "Bật"}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity disabled={busy} hitSlop={8} onPress={() => setConfirmDelete(r)}>
                    <Text style={[styles.link, { color: c.inkSoft }]}>Xoá</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>

      <TouchableOpacity
        activeOpacity={0.85}
        style={[styles.fab, { backgroundColor: c.card }]}
        onPress={() => {
          setSheetError("");
          setConfirmDelete(null);
          setSheetOpen(true);
        }}
      >
        <Feather name="plus" size={24} color={c.primary} />
      </TouchableOpacity>

      <FormSheet visible={sheetOpen} title="Lịch tự động mới" onClose={() => { if (!busy) setSheetOpen(false); }}>
        {/* her-35: loại hình → bộ môn → HLV → giờ (cùng thứ tự màn Lịch tập) */}
        <SectionLabel style={styles.sheetLabel}>Loại hình</SectionLabel>
        <View style={styles.chipWrap}>
          {FORMATS.map((key) => (
            <TouchableOpacity
              key={key}
              onPress={() => setForm((f) => {
                // 1:8 chỉ Yoga — chọn luôn giúp; HLV đang chọn còn hợp bộ môn thì GIỮ
                const discipline = disciplineForFormat(key, f.discipline);
                return { ...f, format: key, discipline, coachId: pickCoach(trainers, discipline, f.coachId) };
              })}
              style={[styles.chip, { borderColor: c.line }, form.format === key && { backgroundColor: c.primaryTint, borderColor: c.primaryTint }]}
            >
              <Text style={[styles.chipText, { color: form.format === key ? c.primary : c.ink }]}>{key}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <SectionLabel style={styles.sheetLabel}>Bộ môn</SectionLabel>
        <View style={styles.chipWrap}>
          {disciplineChips(form.format).map(([key, label]) => (
            <TouchableOpacity
              key={key}
              onPress={() => setForm((f) => ({
                ...f,
                discipline: key,
                coachId: pickCoach(trainers, key, f.coachId),
              }))}
              style={[styles.chip, { borderColor: c.line }, form.discipline === key && { backgroundColor: c.primaryTint, borderColor: c.primaryTint }]}
            >
              <Text style={[styles.chipText, { color: form.discipline === key ? c.primary : c.ink }]}>{label}</Text>
            </TouchableOpacity>
          ))}
          {disciplineChips(form.format).length === 0 && (
            <Text style={{ fontSize: 12, color: c.inkSoft }}>Chưa có bộ môn — kiểm tra kết nối</Text>
          )}
        </View>

        {/* her-36: mọi buổi luật này sinh ra sẽ mang tên dưới đây */}
        <SectionLabel style={styles.sheetLabel}>Tên lớp</SectionLabel>
        <TextInput
          value={form.name}
          onChangeText={(v) => setForm((f) => ({ ...f, name: v }))}
          placeholder="Bỏ trống = tên bộ môn"
          placeholderTextColor={c.inkSoft}
          maxLength={100}
          style={[styles.input, { borderBottomColor: c.line, color: c.ink }]}
        />

        <SectionLabel style={styles.sheetLabel}>HLV (có chuyên môn bộ môn này)</SectionLabel>
        <View style={styles.chipWrap}>
          {coaches(form.discipline).map((t) => (
            <TouchableOpacity
              key={t.id}
              onPress={() => setForm((f) => ({ ...f, coachId: t.id }))}
              style={[styles.chip, { borderColor: c.line }, form.coachId === t.id && { backgroundColor: c.primary, borderColor: c.primary }]}
            >
              <Text style={[styles.chipText, { color: form.coachId === t.id ? c.primaryOn : c.ink }]}>{t.name}</Text>
            </TouchableOpacity>
          ))}
          {coaches(form.discipline).length === 0 && (
            <Text style={{ fontSize: 12, color: c.inkSoft }}>Chưa có HLV nào có chuyên môn này</Text>
          )}
        </View>

        <SectionLabel style={styles.sheetLabel}>Lặp vào các thứ</SectionLabel>
        <View style={styles.chipWrap}>
          {WEEKDAYS.map(([d, label]) => {
            const on = form.days.includes(d);
            return (
              <TouchableOpacity
                key={d}
                onPress={() => setForm((f) => ({
                  ...f,
                  days: on ? f.days.filter((x) => x !== d) : [...f.days, d],
                }))}
                style={[styles.chip, { borderColor: c.line }, on && { backgroundColor: c.primaryTint, borderColor: c.primaryTint }]}
              >
                <Text style={[styles.chipText, { color: on ? c.primary : c.ink }]}>{label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <SectionLabel style={styles.sheetLabel}>Giờ bắt đầu (buổi 60 phút)</SectionLabel>
        <DateTimeField mode="time" value={form.time} onChange={(v) => setForm((f) => ({ ...f, time: v }))} />

        {!!sheetError && <Text style={[styles.sheetError, { color: c.danger }]}>{sheetError}</Text>}
        <AppButton style={{ marginTop: 22 }} disabled={busy} onPress={create}>
          {busy ? "Đang tạo..." : "Tạo lịch tự động"}
        </AppButton>
      </FormSheet>

      <ConfirmSheet
        visible={!!confirmDelete}
        busy={busy}
        title="Xoá lịch tự động?"
        message={
          confirmDelete
            ? `Bạn chắc chắn muốn xóa lịch ${pad(confirmDelete.hour)}:${pad(confirmDelete.minute)} ${confirmDelete.name}? Các buổi đã tạo vẫn giữ nguyên.`
            : ""
        }
        confirmLabel="Xoá lịch tự động"
        onConfirm={async () => {
          if (!confirmDelete) return;
          await remove(confirmDelete.id);
        }}
        onClose={() => setConfirmDelete(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  error: { fontSize: 12.5, fontWeight: "700", marginTop: 8 },
  empty: { fontSize: 13, marginTop: 14 },
  row: { paddingVertical: 13 },
  rowTitle: { fontSize: 13.5, fontWeight: "700" },
  rowMeta: { fontSize: 11.5, marginTop: 2 },
  link: { fontSize: 11.5, fontWeight: "700" },
  sheetLabel: { marginTop: 12 },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  chip: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1.5 },
  chipText: { fontSize: 12.5, fontWeight: "700" },
  // Ô nhập gạch chân — cùng kiểu với các form khác của app (her-36)
  input: { borderBottomWidth: 1.5, paddingVertical: 8, fontSize: 15, marginTop: 2 },
  sheetError: { fontSize: 12.5, fontWeight: "700", marginTop: 14 },
  // FAB chỉ icon "+" — tròn, nhích lên khỏi mép dưới (góp ý 18/08)
  fab: {
    position: "absolute",
    right: 22,
    bottom: 34,
    width: 54,
    height: 54,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.14,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
});
