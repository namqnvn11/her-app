import { useState, useCallback } from "react";
import { RefreshControl } from "react-native";
import { useTheme } from "../theme";

// Kéo-làm-mới dùng chung (her-51, 28/08/2026). Trước đây các màn truyền `refreshing={loading}`:
// lúc mở màn `loading` đã true → iOS bung vòng xoay khi chưa ai kéo, tải xong không thu nội dung
// về → chừa khoảng trắng trên đầu danh sách tới khi cuộn/bấm (lỗi iOS, Android không bị).
// Ở đây chỉ xoay khi NGƯỜI DÙNG kéo, tự tắt khi hàm onRefresh (async) xong.
export default function PullRefresh({ onRefresh }) {
  const [refreshing, setRefreshing] = useState(false);
  const { c } = useTheme();
  const handle = useCallback(async () => {
    setRefreshing(true);
    try { await onRefresh(); } finally { setRefreshing(false); }
  }, [onRefresh]);
  return <RefreshControl refreshing={refreshing} onRefresh={handle} tintColor={c.accent} />;
}
