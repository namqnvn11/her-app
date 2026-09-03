import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { api } from "../api/client";

// her-57 (03/09/2026): PUSH thật từ server — khác với nhắc lịch local (reminders.js, app tự hẹn giờ).
// App đăng ký token Expo Push của máy với server sau khi đăng nhập; server gửi "khách đã đặt/hủy lịch"
// tới mọi máy đang đăng nhập tài khoản admin/lễ tân/HLV. MỌI vai trò đều đăng ký (kể cả khách — khách
// không có thông báo nào để nhận) để token luôn được "giành" về tài khoản ĐANG đăng nhập trên máy:
// người trước đăng xuất hụt (mất mạng/phiên hết hạn) thì người sau đăng nhập là máy đổi chủ ngay
// (review her-57 #2). Đăng xuất thì gỡ token (có giới hạn thời gian, không treo nút Đăng xuất).
// Web không có expo-notifications -> mọi hàm no-op. Expo Go không nhận push từ SDK 53 — app báo warn, bỏ qua.

const CHANNEL_ID = "default"; // server gửi channelId này — Android 8+ bắt buộc có kênh
const TOKEN_KEY = "her_push_token"; // nhớ token cuối để còn gỡ được sau khi app bị kill

let Notifications = null;
let Constants = null;
if (Platform.OS !== "web") {
  // eslint-disable-next-line global-require
  Notifications = require("expo-notifications");
  // eslint-disable-next-line global-require
  Constants = require("expo-constants").default;
  // Thông báo vẫn hiện khi app đang mở (reminders.js cũng đặt — đặt lại ở đây để không phụ thuộc thứ tự import)
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
  });
}

const listeners = new Set();
let receivedSub = null;

// Màn nào muốn biết "vừa có push tới khi app đang mở" (để tải lại chấm đỏ) thì đăng ký ở đây
export function onPushReceived(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);

export async function registerPush(user) {
  if (!Notifications || !user) return false;
  try {
    const perm = await Notifications.getPermissionsAsync();
    const granted = perm.granted || (await Notifications.requestPermissionsAsync()).granted;
    if (!granted) return false;
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
        name: "Đặt / hủy lịch",
        importance: Notifications.AndroidImportance.HIGH,
        sound: "default",
      });
    }
    const projectId = Constants?.expoConfig?.extra?.eas?.projectId || Constants?.easConfig?.projectId;
    const { data: token } = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    if (!token) return false;
    await api.post("/me/push-token", { token, platform: Platform.OS });
    await AsyncStorage.setItem(TOKEN_KEY, token);
    if (!receivedSub) {
      receivedSub = Notifications.addNotificationReceivedListener((n) => listeners.forEach((fn) => fn(n)));
    }
    return true;
  } catch (err) {
    // Expo Go / máy ảo / chưa cấu hình FCM: không có token — app vẫn dùng chuông trong app bình thường
    console.warn("[push] không đăng ký được thông báo đẩy:", err.message);
    return false;
  }
}

// Gọi TRƯỚC khi xoá token đăng nhập (cần token để gọi API). Tối đa 3 giây — mạng chập chờn không được
// giữ người dùng kẹt ở nút Đăng xuất (review #7). Gỡ hụt thì lần đăng nhập kế tiếp trên máy này sẽ
// giành lại token cho tài khoản mới; máy bỏ không thì token chết dần theo ticket của Expo.
export async function unregisterPush() {
  if (!Notifications) return;
  let token = null;
  try {
    token = await AsyncStorage.getItem(TOKEN_KEY);
  } catch (err) {
    console.warn("[push] không đọc được token đã lưu:", err.message);
  }
  if (!token) return;
  try {
    await withTimeout(api.delete("/me/push-token", { token }), 3000);
    await AsyncStorage.removeItem(TOKEN_KEY);
  } catch (err) {
    console.warn("[push] không gỡ được token khi đăng xuất (sẽ giành lại ở lần đăng nhập sau):", err.message);
  }
}
