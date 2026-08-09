import { View, Text, StyleSheet } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { COLORS } from "../theme";

export default function Ring({ used, total, size = 100 }) {
  const stroke = 11;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  // Guard chia 0 / dữ liệu lạ — total=0 thì coi như đã dùng hết (vòng đầy, 0 buổi còn lại)
  const pct = total > 0 ? Math.min(Math.max(used / total, 0), 1) : 1;

  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={StyleSheet.absoluteFill}>
        <Circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={COLORS.beige} strokeWidth={stroke} />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={COLORS.ink}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${c}`}
          strokeDashoffset={c * (1 - pct)}
          rotation="-90"
          origin={`${size / 2}, ${size / 2}`}
        />
      </Svg>
      <Text style={{ fontSize: 22, fontWeight: "800", color: COLORS.ink }}>{Math.max(total - used, 0)}</Text>
      <Text style={{ fontSize: 10, color: COLORS.inkSoft }}>buổi còn lại</Text>
    </View>
  );
}
