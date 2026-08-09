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
      <View style={{ alignItems: "center", marginBottom: 34 }}>
        <Svg width={86} height={86} viewBox="0 0 1000 1000">
          <Circle cx="500" cy="500" r="430" fill="none" stroke={COLORS.beigeDark} strokeWidth="55" />
          <SvgText x="500" y="600" textAnchor="middle" fontSize="320" fontWeight="800" fill={COLORS.ink}>
            HER
          </SvgText>
        </Svg>
        <Text style={styles.tagline}>PILATES · GYM · YOGA</Text>
      </View>

      <Text style={styles.label}>Số điện thoại</Text>
      <TextInput
        value={phone}
        onChangeText={setPhone}
        placeholder="VD: 0909090909"
        placeholderTextColor={COLORS.inkSoft}
        autoCapitalize="none"
        keyboardType="phone-pad"
        style={styles.input}
      />

      <Text style={styles.label}>Mật khẩu</Text>
      <TextInput
        value={password}
        onChangeText={setPassword}
        placeholder="••••••••"
        placeholderTextColor={COLORS.inkSoft}
        secureTextEntry
        style={styles.input}
      />

      {!!error && <Text style={styles.error}>{error}</Text>}

      <AppButton onPress={handleLogin} disabled={submitting} style={{ marginTop: 8 }}>
        {submitting ? "Đang đăng nhập..." : "Đăng nhập"}
      </AppButton>

      <Text style={styles.forgot}>
        Tài khoản demo — mật khẩu chung: 123456{"\n"}
        Học viên: 0909090909{"\n"}
        HLV: 0911111111{"\n"}
        Lễ tân: 0900000000{"\n"}
        Admin: 0999999999
      </Text>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: COLORS.bg, justifyContent: "center", paddingHorizontal: 28 },
  tagline: { marginTop: 10, fontSize: 12, letterSpacing: 3, color: COLORS.beigeDark, fontWeight: "700" },
  label: { fontSize: 12, color: COLORS.inkSoft, fontWeight: "700", marginBottom: 6 },
  input: {
    borderWidth: 1.5,
    borderColor: COLORS.line,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 16,
    fontSize: 14,
    color: COLORS.ink,
  },
  error: { color: COLORS.ink, fontSize: 12.5, marginBottom: 10, fontWeight: "700" },
  forgot: { textAlign: "center", marginTop: 16, fontSize: 11.5, color: COLORS.inkSoft, lineHeight: 17 },
});
