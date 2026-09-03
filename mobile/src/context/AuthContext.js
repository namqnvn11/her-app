import { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { api, setAuthToken, setSessionInvalidHandler } from "../api/client";
import { registerPush, unregisterPush } from "../utils/push";
import { cancelAllReminders } from "../utils/reminders";

const AuthContext = createContext(null);
const STORAGE_KEY = "her_app_token";

export function AuthProvider({ children }) {
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true); // đang khôi phục session lúc mở app
  // Cấu hình server công bố (vd minCancelHours) — nhận từ /auth/login và /me
  const [config, setConfig] = useState(null);
  // Ref theo dõi token hiện hành — chống race "logout xong mà fetch cũ resolve làm user hồi sinh"
  const tokenRef = useRef(null);

  useEffect(() => {
    (async () => {
      const saved = await AsyncStorage.getItem(STORAGE_KEY);
      if (saved) {
        setAuthToken(saved);
        tokenRef.current = saved;
        try {
          // her-45: /me có thể trả kèm `token` MỚI (gia hạn trượt) — lưu đè thì phiên tính
          // lại 30 ngày từ lần mở app này. Không có field đó = chưa tới lúc gia hạn.
          const { user, config, token: renewed } = await api.get("/me");
          const active = renewed || saved;
          if (renewed) {
            await AsyncStorage.setItem(STORAGE_KEY, renewed);
            setAuthToken(renewed);
            tokenRef.current = renewed;
          }
          setToken(active);
          setUser(user);
          registerPush(user); // her-57: mở app lại cũng đăng ký token (máy mới / token đổi)
          setConfig(config || null);
          // Lễ tân/admin không dùng nhắc lịch — dọn thông báo còn sót của người dùng trước (B1)
          if (user.role === "reception" || user.role === "admin") cancelAllReminders();
        } catch (err) {
          // Chỉ xoá token khi server thật sự từ chối (401/403 — hết hạn/bị khoá).
          // Lỗi mạng (không có status) thì giữ token để lần mở app sau còn dùng được.
          if (err.status === 401 || err.status === 403) {
            await AsyncStorage.removeItem(STORAGE_KEY);
          }
          setAuthToken(null);
          tokenRef.current = null;
        }
      }
      setLoading(false);
    })();
  }, []);

  // Trả kết quả trực tiếp ({ ok, error }) để màn hình login hiện đúng lý do ngay lần đầu,
  // không đọc qua state (state cập nhật sau render nên lần đầu luôn bị trễ 1 nhịp)
  const login = useCallback(async (phone, password) => {
    try {
      const { token, user, config } = await api.post("/auth/login", { phone, password });
      // Đổi tài khoản trên cùng máy: xoá nhắc của người trước — không nhắc lịch "ma" (review B1)
      cancelAllReminders();
      await AsyncStorage.setItem(STORAGE_KEY, token);
      setAuthToken(token);
      tokenRef.current = token;
      setToken(token);
      setUser(user);
      setConfig(config || null);
      registerPush(user); // her-57: không chờ — lỗi push không được chặn đăng nhập
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }, []);

  const logout = useCallback(async () => {
    cancelAllReminders(); // máy không được tiếp tục nhắc lịch của người đã đăng xuất (B1)
    await unregisterPush(); // her-57: gỡ token TRƯỚC khi xoá phiên (cần token để gọi API)
    await AsyncStorage.removeItem(STORAGE_KEY);
    setAuthToken(null);
    tokenRef.current = null;
    setToken(null);
    setUser(null);
    setConfig(null); // không để config của phiên trước dính sang phiên sau
  }, []);

  const refreshMe = useCallback(async () => {
    const { user, config, token: renewed } = await api.get("/me");
    if (!tokenRef.current) return null; // đã logout trong lúc fetch — bỏ kết quả, không "hồi sinh" user
    // Gia hạn trượt cũng áp ở đây (her-45) — nhưng chỉ khi phiên còn sống, không cứu phiên đã logout
    if (renewed) {
      await AsyncStorage.setItem(STORAGE_KEY, renewed);
      setAuthToken(renewed);
      tokenRef.current = renewed;
      setToken(renewed);
    }
    setUser(user);
    if (config) setConfig(config);
    return user;
  }, []);

  // her-47: admin lưu cài đặt (số giờ hủy) xong -> cập nhật config trong app ngay, không chờ /me
  const updateConfig = useCallback((patch) => setConfig((prev) => ({ ...(prev || {}), ...patch })), []);

  // Phiên chết giữa chừng (token hết hạn / tài khoản bị khoá) -> tự đăng xuất về màn login
  useEffect(() => {
    setSessionInvalidHandler(() => logout());
    return () => setSessionInvalidHandler(null);
  }, [logout]);

  return (
    <AuthContext.Provider value={{ token, user, config, loading, login, logout, refreshMe, updateConfig }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
