import { useState, useEffect } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useTheme } from "../theme";

// Mục 11 (her-15): ô chọn NGÀY GIỜ thay ô gõ tay — bấm mở lịch tháng + lưới giờ:phút,
// không lo gõ sai định dạng. Không dùng thư viện ngoài (quy tắc dự án).
// Giá trị trả ra qua onChange là chuỗi "dd/MM HH:mm" (kèm "/yyyy" khi khác năm hiện tại) —
// đúng định dạng parseQuickDateTime đang dùng, server vẫn validate lần cuối như cũ.

const WEEKDAYS = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];
const HOURS = Array.from({ length: 17 }, (_, i) => i + 5); // 05h..21h
const MINUTES = [0, 15, 30, 45];
const pad = (n) => String(n).padStart(2, "0");

function parseValue(value, mode) {
  if (mode === "time") {
    // "HH:mm" -> {hour, minute} (ngày giả để dùng chung cấu trúc)
    const m = /^(\d{1,2}):(\d{2})$/.exec((value || "").trim());
    if (!m) return null;
    return { day: 1, month: 1, year: 2000, hour: Number(m[1]), minute: Number(m[2]) };
  }
  if (mode === "date") {
    // "dd/MM/yyyy" -> {day, month, year}
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec((value || "").trim());
    if (!m) return null;
    return { day: Number(m[1]), month: Number(m[2]), year: Number(m[3]), hour: 0, minute: 0 };
  }
  // "dd/MM HH:mm" | "dd/MM/yyyy HH:mm" -> {day, month, year, hour, minute} | null
  const m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\s+(\d{1,2}):(\d{2})$/.exec((value || "").trim());
  if (!m) return null;
  return {
    day: Number(m[1]),
    month: Number(m[2]),
    year: m[3] ? Number(m[3]) : new Date().getFullYear(),
    hour: Number(m[4]),
    minute: Number(m[5]),
  };
}

function fmt(year, month, day, hour, minute, mode) {
  if (mode === "time") return `${pad(hour)}:${pad(minute)}`;
  if (mode === "date") return `${pad(day)}/${pad(month)}/${year}`;
  const y = year !== new Date().getFullYear() ? `/${year}` : "";
  return `${pad(day)}/${pad(month)}${y} ${pad(hour)}:${pad(minute)}`;
}

// mode: "datetime" (mặc định) | "date" (chỉ ngày — vd hạn gói) | "time" (chỉ giờ — vd lịch tự động)
// allowPast (her-39): mặc định false — ngày trước hôm nay bị mờ/khoá như cũ. Màn xếp lịch của
// QUẦY truyền true để dựng lại buổi ĐÃ TẬP trong quá khứ (server cũng chỉ mở cho quầy).
// clearable (her-44, góp ý 21/08): ô nào ĐƯỢC PHÉP để trống thì bật cờ này -> chọn nhầm còn có
// nút ✕ để bỏ, không phải tắt cả form mở lại. Ô bắt buộc KHÔNG bật (xoá chỉ tổ làm form sai).
export default function DateTimeField({ value, onChange, mode = "datetime", placeholder, allowPast = false, clearable = false }) {
  const { c } = useTheme();
  const parsed = parseValue(value, mode);
  const now = new Date();
  const [open, setOpen] = useState(false);
  // Con trỏ tháng đang xem + lựa chọn hiện tại (khởi tạo từ value nếu có)
  const [cursor, setCursor] = useState(() =>
    parsed ? new Date(parsed.year, parsed.month - 1, 1) : new Date(now.getFullYear(), now.getMonth(), 1)
  );
  const [sel, setSel] = useState(() => parsed || { day: null, month: null, year: null, hour: null, minute: 0 });
  const [hint, setHint] = useState(""); // nhắc trong bảng khi bấm Xong mà chưa chọn đủ (review B2)

  // Giá trị bị đổi/xoá TỪ NGOÀI (bấm ✕, hoặc form reset sau khi lưu) -> đồng bộ lại lựa chọn
  // trong bảng. Không làm thì bảng vẫn tô ngày cũ và lần chọn kế tiếp ghép nhầm với ngày đó.
  useEffect(() => {
    const next = parseValue(value, mode);
    if (next) {
      setSel(next);
      if (mode !== "time") setCursor(new Date(next.year, next.month - 1, 1));
    } else {
      setSel({ day: null, month: null, year: null, hour: null, minute: 0 });
      setHint("");
    }
  }, [value, mode]);

  const clear = () => {
    onChange("");
    setSel({ day: null, month: null, year: null, hour: null, minute: 0 });
    setHint("");
    setOpen(false); // đóng bảng để thấy rõ ô đã trống trở lại
  };

  const apply = (next) => {
    setSel(next);
    const enough = mode === "time" ? next.hour != null : next.day != null && (mode === "date" || next.hour != null);
    if (enough) {
      onChange(fmt(next.year ?? 2000, next.month ?? 1, next.day ?? 1, next.hour ?? 0, next.minute ?? 0, mode));
    }
  };

  const pickDay = (d) =>
    apply({ ...sel, day: d, month: cursor.getMonth() + 1, year: cursor.getFullYear() });
  const pickHour = (h) => apply({ ...sel, hour: h });
  const pickMinute = (m) => apply({ ...sel, minute: m });

  // Lưới ngày của tháng đang xem: chèn ô trống đầu tuần (tuần bắt đầu Thứ 2)
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
  const lead = (first.getDay() + 6) % 7;
  const cells = [...Array(lead).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const isPastDay = (d) =>
    !allowPast && new Date(cursor.getFullYear(), cursor.getMonth(), d) < today;
  const isSelDay = (d) =>
    sel.day === d && sel.month === cursor.getMonth() + 1 && sel.year === cursor.getFullYear();

  return (
    <View>
      <View style={[styles.field, { borderBottomColor: c.line }]}>
        <TouchableOpacity onPress={() => setOpen((o) => !o)} style={styles.fieldMain}>
          <Text style={[styles.fieldText, { color: value ? c.ink : c.inkSoft }]}>
            {value || placeholder || (mode === "date" ? "Chọn ngày" : mode === "time" ? "Chọn giờ" : "Chọn ngày giờ")}
          </Text>
        </TouchableOpacity>
        {clearable && !!value && (
          <TouchableOpacity onPress={clear} hitSlop={10} style={styles.fieldIcon}>
            <Feather name="x" size={15} color={c.inkSoft} />
          </TouchableOpacity>
        )}
        <TouchableOpacity onPress={() => setOpen((o) => !o)} hitSlop={8} style={styles.fieldIcon}>
          <Feather name={open ? "chevron-up" : mode === "time" ? "clock" : "calendar"} size={15} color={c.primary} />
        </TouchableOpacity>
      </View>

      {open && (
        <View style={[styles.panel, { borderColor: c.line, backgroundColor: c.card }]}>
          {mode !== "time" && (
          <>
          {/* Điều hướng tháng */}
          <View style={styles.monthNav}>
            <TouchableOpacity onPress={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))} hitSlop={10}>
              <Feather name="chevron-left" size={17} color={c.primary} />
            </TouchableOpacity>
            <Text style={[styles.monthLabel, { color: c.ink }]}>
              Tháng {cursor.getMonth() + 1}/{cursor.getFullYear()}
            </Text>
            <TouchableOpacity onPress={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))} hitSlop={10}>
              <Feather name="chevron-right" size={17} color={c.primary} />
            </TouchableOpacity>
          </View>

          {/* Lịch tháng */}
          <View style={styles.week}>
            {WEEKDAYS.map((w) => (
              <Text key={w} style={[styles.weekday, { color: c.inkSoft }]}>{w}</Text>
            ))}
          </View>
          <View style={styles.grid}>
            {cells.map((d, i) =>
              d === null ? (
                <View key={`e${i}`} style={styles.dayCell} />
              ) : (
                <TouchableOpacity
                  key={d}
                  disabled={isPastDay(d)}
                  onPress={() => pickDay(d)}
                  style={[styles.dayCell, isSelDay(d) && { backgroundColor: c.primary, borderRadius: 999 }]}
                >
                  <Text
                    style={[
                      styles.dayText,
                      { color: isPastDay(d) ? c.tabInactive : isSelDay(d) ? c.primaryOn : c.ink },
                    ]}
                  >
                    {d}
                  </Text>
                </TouchableOpacity>
              )
            )}
          </View>
          </>
          )}

          {/* Giờ */}
          {mode !== "date" && (
          <>
          <Text style={[styles.groupLabel, { color: c.inkSoft }]}>GIỜ</Text>
          <View style={styles.chipWrap}>
            {HOURS.map((h) => (
              <TouchableOpacity
                key={h}
                onPress={() => pickHour(h)}
                style={[styles.chip, { borderColor: c.line }, sel.hour === h && { backgroundColor: c.primary, borderColor: c.primary }]}
              >
                <Text style={[styles.chipText, { color: sel.hour === h ? c.primaryOn : c.ink }]}>{pad(h)}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Phút */}
          <Text style={[styles.groupLabel, { color: c.inkSoft }]}>PHÚT</Text>
          <View style={styles.chipWrap}>
            {MINUTES.map((m) => (
              <TouchableOpacity
                key={m}
                onPress={() => pickMinute(m)}
                style={[styles.chip, { borderColor: c.line }, (sel.minute ?? 0) === m && { backgroundColor: c.primaryTint, borderColor: c.primaryTint }]}
              >
                <Text style={[styles.chipText, { color: (sel.minute ?? 0) === m ? c.primary : c.ink }]}>{pad(m)}</Text>
              </TouchableOpacity>
            ))}
          </View>

          </>
          )}

          {!!hint && <Text style={[styles.hint, { color: c.danger }]}>{hint}</Text>}
          <TouchableOpacity
            onPress={() => {
              // Chưa chọn đủ ngày + giờ thì không đóng im lặng (review her-15 B2)
              if (mode !== "time" && sel.day == null) return setHint("Chọn NGÀY trên lịch trước đã");
              if (mode !== "date" && sel.hour == null) return setHint("Chọn GIỜ bên dưới trước đã");
              setHint("");
              setOpen(false);
            }}
            style={styles.doneBtn}
            hitSlop={8}
          >
            <Text style={[styles.doneText, { color: c.primary }]}>Xong</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    borderBottomWidth: 1.5,
    paddingVertical: 9,
    marginTop: 2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  fieldMain: { flex: 1 },
  fieldIcon: { paddingLeft: 12 },
  fieldText: { fontSize: 15 },
  panel: { borderWidth: 1, borderRadius: 14, padding: 12, marginTop: 10 },
  monthNav: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  monthLabel: { fontSize: 13, fontWeight: "800" },
  week: { flexDirection: "row" },
  weekday: { width: `${100 / 7}%`, textAlign: "center", fontSize: 10.5, fontWeight: "700" },
  grid: { flexDirection: "row", flexWrap: "wrap", marginTop: 2 },
  dayCell: { width: `${100 / 7}%`, aspectRatio: 1.35, alignItems: "center", justifyContent: "center" },
  dayText: { fontSize: 12.5, fontWeight: "600" },
  groupLabel: { fontSize: 10, fontWeight: "800", letterSpacing: 1, marginTop: 10, marginBottom: 6 },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { paddingVertical: 6, paddingHorizontal: 11, borderRadius: 999, borderWidth: 1.5 },
  chipText: { fontSize: 12, fontWeight: "700" },
  hint: { fontSize: 11.5, fontWeight: "700", marginTop: 8 },
  doneBtn: { alignSelf: "flex-end", marginTop: 10 },
  doneText: { fontSize: 12.5, fontWeight: "800" },
});
