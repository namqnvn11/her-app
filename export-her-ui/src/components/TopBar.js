import { View, Text, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../theme";

export default function TopBar({ title, sub }) {
  const insets = useSafeAreaInsets();
  const { c } = useTheme();
  return (
    <View style={[styles.wrap, { paddingTop: 14 + insets.top }]}>
      <Text style={[styles.title, { color: c.ink }]}>{title}</Text>
      {!!sub && <Text style={[styles.sub, { color: c.inkSoft }]}>{sub}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 22, paddingBottom: 10 },
  title: { fontSize: 20, fontWeight: "800" },
  sub: { fontSize: 11.5, marginTop: 3 },
});
