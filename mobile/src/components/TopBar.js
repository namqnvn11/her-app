import { View, Text, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Text as SvgText } from "react-native-svg";
import { COLORS } from "../theme";

export default function TopBar({ title, sub }) {
  // Cộng inset trên để tiêu đề không bị status bar / tai thỏ đè lên (headerShown: false)
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.wrap, { paddingTop: 18 + insets.top }]}>
      <Svg width={30} height={30} viewBox="0 0 1000 1000">
        <Circle cx="500" cy="500" r="430" fill="none" stroke={COLORS.beigeDark} strokeWidth="60" />
        <SvgText x="500" y="600" textAnchor="middle" fontSize="330" fontWeight="800" fill={COLORS.ink}>
          HER
        </SvgText>
      </Svg>
      <View style={{ marginLeft: 10 }}>
        <Text style={styles.title}>{title}</Text>
        {!!sub && <Text style={styles.sub}>{sub}</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingBottom: 12 },
  title: { fontSize: 18, fontWeight: "800", color: COLORS.ink },
  sub: { fontSize: 12, color: COLORS.inkSoft, marginTop: 2 },
});
