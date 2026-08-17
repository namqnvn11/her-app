import { Text, StyleSheet } from "react-native";
import { useTheme } from "../theme";

export default function SectionLabel({ children, style }) {
  const { c } = useTheme();
  return <Text style={[styles.label, { color: c.inkSoft }, style]}>{String(children).toUpperCase()}</Text>;
}

const styles = StyleSheet.create({
  label: { fontSize: 10.5, fontWeight: "700", letterSpacing: 1.4, marginTop: 20, marginBottom: 2 },
});
