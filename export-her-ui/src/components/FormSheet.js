import { Modal, View, Text, Pressable, ScrollView, StyleSheet } from "react-native";
import { useTheme } from "../theme";

// Bottom sheet chứa form tạo mới — thay cho form nằm đè trên danh sách.
export default function FormSheet({ visible, title, onClose, children }) {
  const { c } = useTheme();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={[styles.backdrop, { backgroundColor: c.overlay }]} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: c.card }]}>
        <View style={[styles.grabber, { backgroundColor: c.line }]} />
        <Text style={[styles.title, { color: c.ink }]}>{title}</Text>
        <ScrollView keyboardShouldPersistTaps="handled">{children}</ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1 },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: "82%",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 22,
    paddingTop: 14,
    paddingBottom: 26,
  },
  grabber: { width: 38, height: 4, borderRadius: 99, alignSelf: "center", marginBottom: 14 },
  title: { fontSize: 16, fontWeight: "800", marginBottom: 14 },
});
