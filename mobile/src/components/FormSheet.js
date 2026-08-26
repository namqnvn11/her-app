// LƯU Ý (her-15 B1): nhiều form dựa vào việc Modal UNMOUNT children khi visible=false
// (DateTimeField khởi tạo state từ value lúc mount). Nếu đổi FormSheet sang View/Animated
// không unmount, phải thêm key cho children để state không dính giữa 2 lần mở.
import { useEffect, useState } from "react";
import { Modal, View, Text, Pressable, ScrollView, StyleSheet, KeyboardAvoidingView, Keyboard, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../theme";

// Bottom sheet chứa form tạo mới — thay cho form nằm đè trên danh sách.
export default function FormSheet({ visible, title, onClose, children }) {
  const { c } = useTheme();
  // Android edge-to-edge: sheet nằm sát đáy nên phải đệm thêm chiều cao thanh điều hướng 3 nút,
  // không thì nút cuối sheet bị thanh này che (phát hiện khi test bản Play 25/08)
  const insets = useSafeAreaInsets();

  // her-50 (26/08): sheet sát đáy nên bàn phím bật lên là che ô nhập.
  // - iOS: KeyboardAvoidingView "padding" đẩy sheet lên theo bàn phím.
  // - Android: cửa sổ Modal KHÔNG được hệ thống tự thu như màn thường, còn KeyboardAvoidingView
  //   thì đẩy dư (thừa đúng phần đệm đáy) và không hạ xuống khi đóng bàn phím (test Samsung 26/08).
  //   → tự nghe sự kiện bàn phím: mở = đệm đúng chiều cao bàn phím (bàn phím đã phủ thanh điều
  //   hướng nên bỏ đệm insets), đóng = về 0 chắc chắn.
  const [kb, setKb] = useState(0);
  useEffect(() => {
    if (Platform.OS !== "android") return undefined;
    const show = Keyboard.addListener("keyboardDidShow", (e) => setKb(e.endCoordinates?.height || 0));
    const hide = Keyboard.addListener("keyboardDidHide", () => setKb(0));
    return () => { show.remove(); hide.remove(); };
  }, []);
  useEffect(() => { if (!visible) setKb(0); }, [visible]);

  const sheetPadBottom = kb > 0 ? 12 : 26 + insets.bottom;
  const Wrap = Platform.OS === "ios" ? KeyboardAvoidingView : View;
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* Sheet đặt bằng justifyContent thay vì absolute để phần đệm đáy của Wrap có tác dụng */}
      <Wrap style={[styles.fill, { paddingBottom: kb }]} behavior="padding">
        <Pressable style={[styles.backdrop, { backgroundColor: c.overlay }]} onPress={onClose} />
        <View style={[styles.sheet, { backgroundColor: c.card, paddingBottom: sheetPadBottom }]}>
          <View style={[styles.grabber, { backgroundColor: c.line }]} />
          {!!title && <Text style={[styles.title, { color: c.ink }]}>{title}</Text>}
          <ScrollView keyboardShouldPersistTaps="handled">{children}</ScrollView>
        </View>
      </Wrap>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFillObject },
  sheet: {
    maxHeight: "82%",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 22,
    paddingTop: 14,
  },
  grabber: { width: 38, height: 4, borderRadius: 99, alignSelf: "center", marginBottom: 14 },
  title: { fontSize: 16, fontWeight: "800", marginBottom: 14 },
});
