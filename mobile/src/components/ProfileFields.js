import { View, Text, TextInput, TouchableOpacity, StyleSheet } from "react-native";
import SectionLabel from "./SectionLabel";
import { useTheme } from "../theme";

// her-59 (04/09/2026): các ô hồ sơ mở rộng dùng CHUNG cho form tạo/sửa tài khoản (quầy) và màn
// Cá nhân (tự sửa). Không ô nào bắt buộc. Server validate thật (utils/profileFields.js) —
// ở đây chỉ gom giá trị. `full` = có thêm nhóm của học viên (khẩn cấp, sức khỏe, mục tiêu).
export const GENDER_OPTIONS = [
  ["female", "Nữ"],
  ["male", "Nam"],
  ["other", "Khác"],
];
export const GENDER_LABEL = Object.fromEntries(GENDER_OPTIONS);

export const EMPTY_PROFILE = { email: "", gender: null, ecName: "", ecPhone: "", healthNotes: "", goals: "" };

// account/user từ server -> giá trị form
export function profileFromUser(u) {
  return {
    email: u?.email || "",
    gender: u?.gender || null,
    ecName: u?.emergencyContact?.name || "",
    ecPhone: u?.emergencyContact?.phone || "",
    healthNotes: u?.healthNotes || "",
    goals: u?.goals || "",
  };
}

// giá trị form -> body gửi server (đúng tên field của API)
export function profileToBody(p, { full = true } = {}) {
  const body = { email: (p.email || "").trim(), gender: p.gender || null };
  if (full) {
    body.emergencyContact = { name: (p.ecName || "").trim(), phone: (p.ecPhone || "").trim() };
    body.healthNotes = (p.healthNotes || "").trim();
    body.goals = (p.goals || "").trim();
  }
  return body;
}

export default function ProfileFields({ value, onChange, full = true, inputStyle, labelStyle }) {
  const { c } = useTheme();
  const set = (patch) => onChange({ ...value, ...patch });
  const input = inputStyle || [styles.input, { borderBottomColor: c.line, color: c.ink }];
  return (
    <>
      <SectionLabel style={labelStyle}>Email</SectionLabel>
      <TextInput
        value={value.email}
        onChangeText={(v) => set({ email: v })}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="Không bắt buộc"
        placeholderTextColor={c.tabInactive}
        style={input}
      />
      <SectionLabel style={labelStyle}>Giới tính</SectionLabel>
      <View style={styles.chipWrap}>
        {GENDER_OPTIONS.map(([key, label]) => {
          const on = value.gender === key;
          return (
            <TouchableOpacity
              key={key}
              onPress={() => set({ gender: on ? null : key })}
              style={[styles.chip, { borderColor: c.line }, on && { backgroundColor: c.primaryTint, borderColor: c.primaryTint }]}
            >
              <Text style={[styles.chipText, { color: on ? c.accent : c.ink }]}>{label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {full && (
        <>
          <SectionLabel style={labelStyle}>Liên hệ khẩn cấp</SectionLabel>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <TextInput
              value={value.ecName}
              onChangeText={(v) => set({ ecName: v })}
              placeholder="Họ tên"
              placeholderTextColor={c.tabInactive}
              style={[input, { flex: 1.3 }]}
            />
            <TextInput
              value={value.ecPhone}
              onChangeText={(v) => set({ ecPhone: v })}
              placeholder="Số điện thoại"
              placeholderTextColor={c.tabInactive}
              keyboardType="phone-pad"
              style={[input, { flex: 1 }]}
            />
          </View>
          <SectionLabel style={labelStyle}>Sức khỏe / tiền sử chấn thương</SectionLabel>
          <TextInput
            value={value.healthNotes}
            onChangeText={(v) => set({ healthNotes: v })}
            placeholder="VD: đau lưng, thoát vị, đang mang thai..."
            placeholderTextColor={c.tabInactive}
            multiline
            maxLength={500}
            style={[input, styles.multi]}
          />
          <SectionLabel style={labelStyle}>Mục tiêu tập luyện</SectionLabel>
          <TextInput
            value={value.goals}
            onChangeText={(v) => set({ goals: v })}
            placeholder="VD: giảm cân, cải thiện tư thế..."
            placeholderTextColor={c.tabInactive}
            multiline
            maxLength={500}
            style={[input, styles.multi]}
          />
        </>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  input: { borderBottomWidth: 1.5, paddingVertical: 8, fontSize: 15, marginTop: 2 },
  multi: { minHeight: 56, textAlignVertical: "top" },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  chip: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1.5 },
  chipText: { fontSize: 12.5, fontWeight: "700" },
});
