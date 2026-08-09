import { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { api, setAuthToken, setSessionInvalidHandler } from "../api/client";

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
          const { user, config } = await api.get("/me");
          setToken(saved);
          setUser(user);
          setConfig(config || null);
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
      await AsyncStorage.setItem(STORAGE_KEY, token);
      setAuthToken(token);
      tokenRef.current = token;
      setToken(token);
      setUser(user);
      setConfig(config || null);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }, []);

  const logout = useCallback(async () => {
    await AsyncStorage.removeItem(STORAGE_KEY);
    setAuthToken(null);
    tokenRef.current = null;
    setToken(null);
    setUser(null);
    setConfig(null); // không để config của phiên trước dính sang phiên sau
  }, []);

  const refreshMe = useCallback(async () => {
    const { user, config } = await api.get("/me");
    if (!tokenRef.current) return null; // đã logout trong lúc fetch — bỏ kết quả, không "hồi sinh" user
    setUser(user);
    if (config) setConfig(config);
    return user;
  }, []);

  // Phiên chết giữa chừng (token hết hạn / tài khoản bị khoá) -> tự đăng xuất về màn login
  useEffect(() => {
    setSessionInvalidHandler(() => logout());
    return () => setSessionInvalidHandler(null);
  }, [logout]);

  return (
    <AuthContext.Provider value={{ token, user, config, loading, login, logout, refreshMe }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
