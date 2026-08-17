// Lưu lựa chọn giao diện của người dùng: "light" | "dark" | "system"
import { createContext, useEffect, useState, useCallback } from "react";
import { useColorScheme } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "her.themeMode";

export const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const system = useColorScheme(); // "light" | "dark"
  const [mode, setMode] = useState("light");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(KEY);
        if (saved === "light" || saved === "dark" || saved === "system") setMode(saved);
      } catch (err) {
        // đọc lỗi thì dùng mặc định sáng — không chặn app khởi động
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const changeMode = useCallback(async (next) => {
    setMode(next);
    try {
      await AsyncStorage.setItem(KEY, next);
    } catch (err) {
      // không lưu được thì vẫn đổi trong phiên hiện tại
    }
  }, []);

  const isDark = mode === "system" ? system === "dark" : mode === "dark";

  return (
    <ThemeContext.Provider value={{ mode, isDark, ready, setMode: changeMode }}>
      {children}
    </ThemeContext.Provider>
  );
}
