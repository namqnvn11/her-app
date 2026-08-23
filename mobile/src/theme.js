// Bảng màu HER — bản chốt giao diện mới: nền be, điểm nhấn terracotta.
// Chỉ có bản SÁNG — quyết định 16/08/2026: KHÔNG làm Dark mode.
// Màu primary đã làm dịu so với bản thiết kế gốc (#B4553C -> #A96A52) theo yêu cầu
// chủ dự án: nút/header nhẹ nhàng tinh tế hơn nhưng vẫn đủ đậm để không bị chìm.
// 23/08/2026 (her-47): khách CHỐT kiểu K1 (docs-her/mau-mau-sac-2026-08-23): nền be rất sáng,
// nút nâu nhạt #CFAF86 với CHỮ ĐEN (7.2:1), chữ/số màu nâu tách riêng token `accent` #A8825A (3.3:1
// trên nền) — nhờ tách nên nút nhạt mà chữ không chìm. Các kiểu K0/K2/K3 ghi trong README thư mục đó.
export const COLORS = {
  bg: "#FAF7F1",           // nền be rất sáng (K1 23/08; trước #F3EEE3)
  card: "#FFFFFF",         // nền thẻ/card
  ink: "#2A2622",          // chữ chính
  inkSoft: "#857C6E",      // chữ phụ/mô tả
  line: "#E6DFCF",         // viền input/card
  hairline: "#E9E2D4",     // kẻ phân dòng mảnh
  primary: "#CFAF86",      // nâu nhạt K1 — NỀN nút chính, header dashboard, chip đang chọn, công tắc
  accent: "#A8825A",       // nâu dùng cho CHỮ/icon/viền/thanh tỉ lệ/toast — tách khỏi primary (her-47) để
                           // nền nút có thể nhạt mà chữ màu nâu vẫn đủ tương phản trên nền be
  primaryOn: "#2A2622",    // chữ trên nền primary — ĐEN (nền nhạt, chữ trắng không đủ tương phản)
  primaryOnSoft: "#5C4A36",// chữ phụ trên nền primary
  primaryTint: "#F1E7D8",  // nền badge/track nhạt theo primary
  primarySoft: "#FBF6EE",  // nền ghi chú nhạt
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
