import { View, Text, Image, StyleSheet } from "react-native";
import { useTheme } from "../theme";
import { avatarUri } from "../utils/avatar";

// her-61 (04/09/2026): vòng tròn ảnh đại diện dùng chung — có ảnh thì hiện ảnh, không thì chữ cái
// đầu tên như trước (initials: "one" = 1 chữ, "two" = 2 chữ cuối tên như màn Cá nhân).
export default function Avatar({ url, name, size = 40, initials = "one", style }) {
  const { c } = useTheme();
  const uri = avatarUri(url);
  const dim = { width: size, height: size, borderRadius: size / 2 };
  if (uri) {
    return <Image source={{ uri }} style={[dim, { backgroundColor: c.primaryTint }, style]} />;
  }
  const words = String(name || "?").trim().split(/\s+/);
  const text = (initials === "two" ? words.slice(-2).map((w) => w[0]).join("") : words[0][0] || "?").toUpperCase();
  return (
    <View style={[styles.circle, dim, { backgroundColor: c.primaryTint }, style]}>
      <Text style={{ color: c.accent, fontWeight: "800", fontSize: size * 0.36 }}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  circle: { alignItems: "center", justifyContent: "center" },
});
