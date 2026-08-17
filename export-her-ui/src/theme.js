// Bảng màu HER — bản chốt: nền be, nút terracotta; kèm bản tối cho Dark mode.
import { useContext } from "react";
import { ThemeContext } from "./context/ThemeContext";

export const LIGHT = {
  bg: "#F3EEE3",
  card: "#FFFFFF",
  ink: "#2A2622",
  inkSoft: "#857C6E",
  line: "#E6DFCF",
  hairline: "#E9E2D4",
  primary: "#B4553C",
  primaryOn: "#FFFFFF",
  primaryTint: "#F3E3DC",
  primarySoft: "#FBF1ED",
  success: "#5C7A63",
  tabInactive: "#B9B0A0",
  overlay: "rgba(26,22,19,0.35)",
};

export const DARK = {
  bg: "#191512",
  card: "#221D19",
  ink: "#F5F0E8",
  inkSoft: "#9A9086",
  line: "#2E2823",
  hairline: "#2A241F",
  primary: "#D9714F",
  primaryOn: "#191512",
  primaryTint: "#3A2A24",
  primarySoft: "#241C18",
  success: "#7FA286",
  tabInactive: "#6B6259",
  overlay: "rgba(0,0,0,0.55)",
};

// Giữ COLORS cho code cũ chưa chuyển sang useTheme (luôn là bản sáng)
export const COLORS = LIGHT;

export function useTheme() {
  const ctx = useContext(ThemeContext);
  const isDark = ctx?.isDark ?? false;
  return { c: isDark ? DARK : LIGHT, isDark, ...ctx };
}
