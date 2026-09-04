import { useState, useCallback, useEffect } from "react";
import { useFocusEffect } from "@react-navigation/native";
import NotificationBell from "./NotificationBell";
import NotificationsModal from "../screens/NotificationsModal";
import { onPushReceived } from "../utils/push";
import { useAuth } from "../context/AuthContext";
import { api } from "../api/client";

// Chuông thông báo TỰ LO (góp ý 04/09: chuông phải có ở MỌI màn hình như một phần header, không chỉ Tổng quan):
// tự tải số chưa đọc khi màn được focus / khi có push tới, tự mở danh sách thông báo. Chỉ hiện cho
// admin / lễ tân / HLV — khách không nhận loại thông báo này nên trả null. TopBar & HeaderBlock gắn sẵn.
const STAFF = ["admin", "reception", "trainer"];

export default function HeaderBell({ light = false }) {
  const { user } = useAuth();
  const isStaff = STAFF.includes(user?.role);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const loadUnread = useCallback(async () => {
    if (!isStaff) return;
    try {
      const r = await api.get("/notifications/unread-count");
      setUnread(r.unread || 0);
    } catch {
      // Không có mạng thì giữ số cũ — chuông không phải chỗ hiện lỗi mạng
    }
  }, [isStaff]);
  useEffect(() => onPushReceived(() => loadUnread()), [loadUnread]);
  useFocusEffect(useCallback(() => { loadUnread(); }, [loadUnread]));
  if (!isStaff) return null;
  return (
    <>
      <NotificationBell light={light} unread={unread} onPress={() => setOpen(true)} />
      {open && <NotificationsModal onClose={() => { setOpen(false); loadUnread(); }} />}
    </>
  );
}
