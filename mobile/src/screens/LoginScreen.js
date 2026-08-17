import { useState } from "react";
import { View, Text, TextInput, StyleSheet, KeyboardAvoidingView, Platform } from "react-native";
import Svg, { Circle, Text as SvgText } from "react-native-svg";
import AppButton from "../components/AppButton";
import { useAuth } from "../context/AuthContext";
import { COLORS } from "../theme";

export default function LoginScreen() {
  const { login } = useAuth();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleLogin = async () => {
    if (!phone || !password) {
      setError("Vui lòng nhập số điện thoại và mật khẩu");
      return;
    }
    setError("");
    setSubmitting(true);
    const result = await login(phone.trim(), password);
    setSubmitting(false);
    // Dùng error trả về trực tiếp — hiện đúng lý do (vd tài khoản bị khoá) ngay lần đầu
    if (!result.ok) setError(result.error || "Sai số điện thoại hoặc mật khẩu");
  };

  return (
    <KeyboardAvoidingView
      style={styles.wrap}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={{ alignItems: "center", marginBottom: 38 }}>
        <Svg width={92} height={92} viewBox="0 0 1000 1000">
          <Circle cx="500" cy="500" r="430" fill="none" stroke={COLORS.primary} strokeWidth="55" />
          <SvgText x="500" y="600" textAnchor="middle" fontSize="320" fontWeight="800" fill={COLORS.ink}>
            HER
          </SvgText>
        </Svg>
        <Text style={styles.tagline}>PILATES · GYM · YOGA</Text>
      </View>

      <Text style={styles.label}>SỐ ĐIỆN THOẠI</Text>
      <TextInput
        value={phone}
        onChangeText={setPhone}
        placeholder="VD: 0909090909"
        placeholderTextColor={COLORS.tabInactive}
        autoCapitalize="none"
        keyboardType="phone-pad"
        style={styles.input}
      />

      <Text style={styles.label}>MẬT KHẨU</Text>
      <TextInput
        value={password}
        onChangeText={setPassword}
        placeholder="••••••••"
        placeholderTextColor={COLORS.tabInactive}
        secureTextEntry
        style={styles.input}
      />

      {!!error && <Text style={styles.error}>{error}</Text>}

      <AppButton onPress={handleLogin} disabled={submitting} style={{ marginTop: 14 }}>
        {submitting ? "Đang đăng nhập..." : "Đăng nhập"}
      </AppButton>

      <Text style={styles.forgot}>Quên mật khẩu? Liên hệ quầy lễ tân</Text>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: COLORS.bg, justifyContent: "center", paddingHorizontal: 32 },
  tagline: { marginTop: 12, fontSize: 12, letterSpacing: 3, color: COLORS.primary, fontWeight: "700" },
  label: { fontSize: 10.5, color: COLORS.inkSoft, fontWeight: "700", letterSpacing: 1.4, marginTop: 18 },
  // Ô nhập kiểu gạch chân theo bản thiết kế — không đóng khung
  input: {
    borderBottomWidth: 1.5,
    borderBottomColor: COLORS.line,
    paddingVertical: 9,
    fontSize: 15.5,
    color: COLORS.ink,
  },
  error: { color: COLORS.danger, fontSize: 12.5, marginTop: 12, fontWeight: "700" },
  forgot: { textAlign: "center", marginTop: 18, fontSize: 12, color: COLORS.inkSoft },
});
