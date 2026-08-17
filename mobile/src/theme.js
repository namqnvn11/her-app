// Bảng màu HER — bản chốt giao diện mới: nền be, điểm nhấn terracotta.
// Chỉ có bản SÁNG — quyết định 16/08/2026: KHÔNG làm Dark mode.
// Màu primary đã làm dịu so với bản thiết kế gốc (#B4553C -> #A96A52) theo yêu cầu
// chủ dự án: nút/header nhẹ nhàng tinh tế hơn nhưng vẫn đủ đậm để không bị chìm.
export const COLORS = {
  bg: "#F3EEE3",           // nền be sáng
  card: "#FFFFFF",         // nền thẻ/card
  ink: "#2A2622",          // chữ chính
  inkSoft: "#857C6E",      // chữ phụ/mô tả
  line: "#E6DFCF",         // viền input/card
  hairline: "#E9E2D4",     // kẻ phân dòng mảnh
  primary: "#A96A52",      // terracotta dịu — nút chính, header dashboard, điểm nhấn
  primaryOn: "#FFFFFF",    // chữ trên nền primary
  primaryOnSoft: "#F2DFD5",// chữ phụ trên nền primary
  primaryTint: "#F1E4DC",  // nền badge/track nhạt theo primary
  primarySoft: "#FAF2EE",  // nền ghi chú nhạt
  success: "#5C7A63",      // trạng thái tốt (đã tập...)
  danger: "#8C3A3A",       // toast lỗi
  tabInactive: "#B9B0A0",
  overlay: "rgba(26,22,19,0.35)",
  // Giữ cho logo HER + màn cũ còn dùng tông be
  beige: "#D8CBB0",
  beigeDark: "#9C8A6B",
};

// Giữ chữ ký useTheme() như bộ giao diện chốt để component dùng chung không phải sửa,
// nhưng luôn trả bản sáng (không có Dark mode).
export function useTheme() {
  return { c: COLORS, isDark: false };
}
