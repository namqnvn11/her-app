import { useState, useCallback } from "react";
import { RefreshControl } from "react-native";
import { useTheme } from "../theme";

// Kéo-làm-mới dùng chung (her-51, 28/08/2026). Trước đây các màn truyền `refreshing={loading}`:
// lúc mở màn `loading` đã true → iOS bung vòng xoay khi chưa ai kéo, tải xong không thu nội dung
// về → chừa khoảng trắng trên đầu danh sách tới khi cuộn/bấm (lỗi iOS, Android không bị).
// Ở đây chỉ xoay khi NGƯỜI DÙNG kéo, tự tắt khi hàm onRefresh (async) xong.
// her-52 (28/08/2026): trên ANDROID, ScrollView/FlatList bọc CHÍNH NÓ vào trong RefreshControl
// (truyền qua children + style) — iOS thì không. Phải chuyển tiếp ...rest, không thì toàn bộ
// danh sách không được vẽ (Tổng quan/Lịch tập/Tài khoản trắng trên bản Play — ảnh chụp 17:35).
export default function PullRefresh({ onRefresh, ...rest }) {
  const [refreshing, setRefreshing] = useState(false);
  const { c } = useTheme();
  const handle = useCallback(async () => {
    setRefreshing(true);
    try { await onRefresh(); } finally { setRefreshing(false); }
  }, [onRefresh]);
  return <RefreshControl {...rest} refreshing={refreshing} onRefresh={handle} tintColor={c.accent} colors={[c.accent]} />;
}
