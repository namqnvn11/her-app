import { useState, useEffect } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import FormSheet from "./FormSheet";
import { useTheme } from "../theme";

// her-46 (góp ý 21/08): bộ chọn THÁNG của báo cáo admin — sheet từ dưới lên, lưới 12 tháng
// thay cho pill "‹ Tháng này ›" phải bấm từng nhịp để lùi. Tháng không có dữ liệu (trước
// minMonth) và tháng TƯƠNG LAI đều mờ, bấm không ăn — cùng luật với bộ chuyển cũ.
//
// minMonth: "YYYY-MM" server trả (tháng xa nhất có dữ liệu). Chưa tải được thì chỉ chọn
// được tháng hiện tại — không đoán bừa là có dữ liệu.
export default function MonthPickerSheet({ visible, year, month, minMonth, onPick, onClose }) {
  const { c } = useTheme();
  const now = new Date();
  const nowY = now.getFullYear();
  const nowM = now.getMonth() + 1;

  // Năm đang XEM trong lưới (khác năm đang CHỌN khi người dùng bấm mũi tên)
  const [viewYear, setViewYear] = useState(year);
  useEffect(() => {
    if (visible) setViewYear(year);
  }, [visible, year]);

  const minY = minMonth ? Number(minMonth.slice(0, 4)) : nowY;
  const canPrevYear = viewYear > minY;
  const canNextYear = viewYear < nowY;

  const enabled = (m) => {
    const key = `${viewYear}-${String(m).padStart(2, "0")}`;
    if (viewYear > nowY || (viewYear === nowY && m > nowM)) return false; // chưa tới
    if (!minMonth) return viewYear === nowY && m === nowM; // chưa biết mốc dữ liệu
    return key >= minMonth;
  };

  const pick = (m) => {
    if (!enabled(m)) return;
    onPick(viewYear, m);
  };

  return (
    <FormSheet visible={visible} onClose={onClose}>
      <View style={styles.yearRow}>
        {canPrevYear ? (
          <TouchableOpacity onPress={() => setViewYear(viewYear - 1)} hitSlop={12} style={styles.yearArrow}>
            <Feather name="chevron-left" size={19} color={c.primary} />
          </TouchableOpacity>
        ) : (
          <View style={styles.yearArrow} />
        )}
        <Text style={[styles.yearText, { color: c.ink }]}>{viewYear}</Text>
        {canNextYear ? (
          <TouchableOpacity onPress={() => setViewYear(viewYear + 1)} hitSlop={12} style={styles.yearArrow}>
            <Feather name="chevron-right" size={19} color={c.primary} />
          </TouchableOpacity>
        ) : (
          <View style={styles.yearArrow} />
        )}
      </View>

      <View style={styles.grid}>
        {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
          const on = enabled(m);
          const sel = viewYear === year && m === month;
          return (
            <TouchableOpacity
              key={m}
              disabled={!on}
              activeOpacity={0.7}
              onPress={() => pick(m)}
              style={[styles.cell, sel && { backgroundColor: c.primary }]}
            >
              <Text style={[styles.cellText, { color: sel ? c.primaryOn : on ? c.ink : c.tabInactive }]}>
                {`T${m}`}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <TouchableOpacity onPress={() => onPick(nowY, nowM)} style={[styles.todayBtn, { borderTopColor: c.hairline }]}>
        <Text style={[styles.todayText, { color: c.primary }]}>Về tháng này</Text>
      </TouchableOpacity>
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  yearRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },
  yearArrow: { width: 30, alignItems: "center", paddingVertical: 4 },
  yearText: { fontSize: 16, fontWeight: "800" },
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 10 },
  cell: { width: "23%", paddingVertical: 13, borderRadius: 12, alignItems: "center" },
  cellText: { fontSize: 14, fontWeight: "800" },
  todayBtn: { borderTopWidth: 1, marginTop: 18, paddingTop: 16, alignItems: "center" },
  todayText: { fontSize: 13.5, fontWeight: "800" },
});
