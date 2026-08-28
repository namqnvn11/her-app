// LƯU Ý (her-15 B1): nhiều form dựa vào việc Modal UNMOUNT children khi visible=false
// (DateTimeField khởi tạo state từ value lúc mount). Nếu đổi FormSheet sang View/Animated
// không unmount, phải thêm key cho children để state không dính giữa 2 lần mở.
import { useEffect, useRef, useState } from "react";
import { Modal, View, Text, Pressable, ScrollView, StyleSheet, Keyboard, Platform, Animated, PanResponder, LayoutAnimation, UIManager, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../theme";

const CLOSE_DRAG = 90; // kéo xuống quá ngần này (pt) rồi thả → thu nhỏ / đóng sheet
const EXPAND_DRAG = 60; // kéo lên quá ngần này → mở rộng sheet gần hết màn hình

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// Bottom sheet chứa form tạo mới — thay cho form nằm đè trên danh sách.
export default function FormSheet({ visible, title, onClose, children }) {
  const { c } = useTheme();
  // Android edge-to-edge: sheet nằm sát đáy nên phải đệm thêm chiều cao thanh điều hướng 3 nút,
  // không thì nút cuối sheet bị thanh này che (phát hiện khi test bản Play 25/08)
  const insets = useSafeAreaInsets();

  // her-50 (26/08) + her-51 (28/08): sheet sát đáy nên bàn phím bật lên là che ô nhập.
  // Cả 2 nền tảng đều TỰ nghe sự kiện bàn phím rồi đệm đúng chiều cao bàn phím (bàn phím đã phủ
  // thanh điều hướng / home indicator nên bỏ đệm insets); đóng = về 0 chắc chắn.
  // - Android: cửa sổ Modal không được hệ thống tự thu; KeyboardAvoidingView đẩy dư (test Samsung 26/08).
  // - iOS: KeyboardAvoidingView trong Modal cũng đẩy dư → chừa khoảng trắng giữa sheet và bàn phím
  //   (test TestFlight 28/08). Dùng keyboardWillShow để sheet trượt cùng lúc với bàn phím.
  const [kb, setKb] = useState(0);
  useEffect(() => {
    const showEv = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEv = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const show = Keyboard.addListener(showEv, (e) => setKb(e.endCoordinates?.height || 0));
    const hide = Keyboard.addListener(hideEv, () => setKb(0));
    return () => { show.remove(); hide.remove(); };
  }, []);
  useEffect(() => { if (!visible) setKb(0); }, [visible]);

  // her-51: kéo dấu gạch / tiêu đề như các app khác — kéo LÊN mở rộng sheet gần hết màn hình
  // (chừa tai thỏ), kéo XUỐNG: đang mở rộng → về cỡ thường, cỡ thường → đóng.
  // Chỉ vùng đầu sheet bắt cử chỉ, để ScrollView bên dưới vẫn cuộn bình thường.
  const { height: winH } = useWindowDimensions();
  const [expanded, setExpanded] = useState(false);
  const expandedRef = useRef(false);
  const setExpand = (v) => {
    expandedRef.current = v;
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded(v);
  };
  const dragY = useRef(new Animated.Value(0)).current;
  const pan = useRef(
    PanResponder.create({
      // Giành cử chỉ NGAY LÚC CHẠM (capture) để dấu gạch/tiêu đề bên trong không nuốt mất — test TestFlight 28/08:
      // chỉ nghe onMove thì iOS không kéo được.
      onStartShouldSetPanResponderCapture: () => true,
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      // Kéo xuống: sheet đi theo tay; kéo lên: chỉ nhích nhẹ (cản) cho có cảm giác, rồi mở rộng khi thả
      onPanResponderMove: (_, g) => dragY.setValue(g.dy >= 0 ? g.dy : g.dy / 4),
      onPanResponderRelease: (_, g) => {
        if (g.dy < -EXPAND_DRAG || g.vy < -1.2) {
          dragY.setValue(0);
          if (!expandedRef.current) setExpand(true);
        } else if (g.dy > CLOSE_DRAG || g.vy > 1.2) {
          dragY.setValue(0);
          if (expandedRef.current) { setExpand(false); return; }
          Keyboard.dismiss();
          onClose?.();
        } else {
          Animated.spring(dragY, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start();
        }
      },
      onPanResponderTerminate: () => Animated.spring(dragY, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start(),
    }),
  ).current;
  useEffect(() => {
    if (!visible) { dragY.setValue(0); expandedRef.current = false; setExpanded(false); }
  }, [visible, dragY]);

  const sheetPadBottom = kb > 0 ? 12 : 26 + insets.bottom;
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* Sheet đặt bằng justifyContent thay vì absolute để phần đệm đáy có tác dụng */}
      <View style={[styles.fill, { paddingBottom: kb }]}>
        <Pressable style={[styles.backdrop, { backgroundColor: c.overlay }]} onPress={onClose} />
        <Animated.View
          style={[
            styles.sheet,
            { backgroundColor: c.card, paddingBottom: sheetPadBottom, transform: [{ translateY: dragY }] },
            // Mở rộng: chiếm cả màn trừ tai thỏ; cỡ thường: theo nội dung, tối đa 82%
            expanded ? { height: winH - insets.top - 8, maxHeight: undefined } : null,
          ]}
        >
          {/* Đuôi cùng màu nối dài dưới sheet: lúc kéo lên (cản) sheet nhích lên không bị hở đáy */}
          <View pointerEvents="none" style={[styles.tail, { backgroundColor: c.card }]} />
          <View {...pan.panHandlers} style={styles.dragArea}>
            <View style={[styles.grabber, { backgroundColor: c.line }]} />
            {!!title && <Text style={[styles.title, { color: c.ink }]}>{title}</Text>}
          </View>
          <ScrollView keyboardShouldPersistTaps="handled">{children}</ScrollView>
        </Animated.View>
      </View>
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
  },
  tail: { position: "absolute", left: 0, right: 0, top: "100%", height: 300 },
  // Vùng bắt cử chỉ kéo: gồm cả phần đệm trên để dễ chạm trúng dấu gạch
  dragArea: { paddingTop: 14, minHeight: 44 }, // tối thiểu 44pt để dễ chạm trúng kể cả sheet không có tiêu đề
  grabber: { width: 38, height: 4, borderRadius: 99, alignSelf: "center", marginBottom: 14 },
  title: { fontSize: 16, fontWeight: "800", marginBottom: 14 },
});
