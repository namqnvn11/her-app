import { View, Text, StyleSheet } from "react-native";
import FormSheet from "./FormSheet";
import AppButton from "./AppButton";
import { useTheme } from "../theme";

// her-17: hộp XÁC NHẬN dùng chung cho các hành động nhạy cảm (cấp lại mật khẩu, khoá tài
// khoản, xoá khung giờ...) — góp ý chủ dự án 16/08: không được "click 1 cái là chạy ngay".
// props: visible, title, message, confirmLabel, danger?, busy?, onConfirm, onClose
export default function ConfirmSheet({ visible, title, message, confirmLabel = "Xác nhận", busy = false, onConfirm, onClose }) {
  const { c } = useTheme();
  return (
    <FormSheet visible={visible} title={title} onClose={() => { if (!busy) onClose?.(); }}>
      {!!message && <Text style={[styles.message, { color: c.inkSoft }]}>{message}</Text>}
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <AppButton variant="ghost" disabled={busy} onPress={onClose}>
            Không, quay lại
          </AppButton>
        </View>
        <View style={{ flex: 1 }}>
          <AppButton disabled={busy} onPress={onConfirm}>
            {busy ? "Đang thực hiện..." : confirmLabel}
          </AppButton>
        </View>
      </View>
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  message: { fontSize: 13, lineHeight: 20, marginTop: 8 },
  row: { flexDirection: "row", gap: 10, marginTop: 20 },
});
