import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

// Mục 9 (her-16) — NHẮC LỊCH TRƯỚC 1 TIẾNG, bản chạy TRÊN MÁY (local notification):
// mỗi lần app tải lịch (khách: lịch đã đặt; HLV: lịch dạy) thì đặt lại toàn bộ thông báo
// "còn 1 tiếng nữa" cho các buổi sắp tới. Ưu điểm: chạy ngay với Expo Go trên điện thoại,
// KHÔNG cần server internet. Giới hạn đã chấp nhận (ghi bản gửi khách): nếu lịch thay đổi
// sau đó (quầy hủy hộ, đổi HLV...) mà người dùng KHÔNG mở lại app thì máy vẫn nhắc theo
// lịch cũ — phần server-push realtime làm ở bước deploy/lên store như kế hoạch.
//
// Web không hỗ trợ expo-notifications -> mọi hàm tự thành no-op (bản web chỉ để test tạm).

const REMIND_KEY = "her_remind_before_class"; // "off" = người dùng tắt trong Cài đặt
const REMIND_BEFORE_MINUTES = 60;

let Notifications = null;
if (Platform.OS !== "web") {
  // require trong điều kiện — bundle web không kéo native module vào
  // eslint-disable-next-line global-require
  Notifications = require("expo-notifications");
  // Thông báo vẫn hiện khi app đang mở
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

// Epoch + hàng đợi: mỗi lượt sync mới vô hiệu lượt đang chạy dở (chống race tắt-công-tắc/
// 2 màn cùng sync gây thông báo trùng — review her-16 B2/B3); chữ ký danh sách để đổi tab
// qua lại không cancel/đặt lại vô ích (B6).
let syncEpoch = 0;
let syncChain = Promise.resolve();
let lastSignature = null;

export async function cancelAllReminders() {
  syncEpoch += 1; // vô hiệu mọi lượt sync đang chạy dở
  lastSignature = null;
  if (Notifications) {
    await Notifications.cancelAllScheduledNotificationsAsync().catch(() => {});
  }
}

export async function remindersEnabled() {
  return (await AsyncStorage.getItem(REMIND_KEY)) !== "off";
}

export async function setRemindersEnabled(on) {
  await AsyncStorage.setItem(REMIND_KEY, on ? "on" : "off");
  if (!on) await cancelAllReminders();
}

async function ensurePermission() {
  const settings = await Notifications.getPermissionsAsync();
  if (settings.granted) return true;
  const asked = await Notifications.requestPermissionsAsync();
  return asked.granted;
}

const fmtTime = (d) =>
  `${String(new Date(d).getHours()).padStart(2, "0")}:${String(new Date(d).getMinutes()).padStart(2, "0")}`;

// Đặt lại TOÀN BỘ nhắc lịch theo danh sách buổi hiện tại.
// items: [{ title, startAt }] — chỉ buổi tương lai được đặt nhắc (điểm nhắc = startAt - 60').
// Không throw ra ngoài: nhắc lịch là tiện ích, lỗi (chưa cấp quyền...) không được làm vỡ màn hình.
export function syncReminders(items) {
  if (!Notifications) return Promise.resolve(); // web
  const epoch = ++syncEpoch;
  syncChain = syncChain.then(() => doSync(items, epoch)).catch(() => {});
  return syncChain;
}

async function doSync(items, epoch) {
  try {
    if (epoch !== syncEpoch) return; // đã có lượt mới hơn — nhường
    if (!(await remindersEnabled())) return;
    if (!(await ensurePermission())) return;

    // Danh sách y hệt lần đặt gần nhất -> khỏi cancel/đặt lại (đổi tab qua lại không tốn gì)
    const signature = JSON.stringify((items || []).map((it) => `${it?.title}|${it?.startAt}`).sort());
    if (signature === lastSignature) return;

    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("reminders", {
        name: "Nhắc lịch tập",
        importance: Notifications.AndroidImportance.HIGH,
      });
    }

    // App chỉ đặt đúng 1 loại thông báo -> xoá sạch rồi đặt lại là an toàn và không trùng lặp
    await Notifications.cancelAllScheduledNotificationsAsync();

    const now = Date.now();
    // 2 booking cùng lớp/khung (HLV nhìn theo khách) -> chỉ 1 lời nhắc
    const seen = new Set();
    const deduped = (items || []).filter((it) => {
      const k = `${it?.title}|${it?.startAt}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    const upcoming = deduped
      .filter((it) => it && it.startAt && new Date(it.startAt).getTime() - REMIND_BEFORE_MINUTES * 60000 > now)
      .sort((a, b) => new Date(a.startAt) - new Date(b.startAt))
      .slice(0, 20); // iOS giới hạn 64 thông báo chờ — 20 buổi gần nhất là quá đủ

    for (const it of upcoming) {
      // Giữa chừng có lượt mới/tắt công tắc -> dừng, KHÔNG đặt thêm (review B2)
      if (epoch !== syncEpoch || !(await remindersEnabled())) return;
      const at = new Date(new Date(it.startAt).getTime() - REMIND_BEFORE_MINUTES * 60000);
      await Notifications.scheduleNotificationAsync({
        content: {
          title: "Còn 1 tiếng nữa tới giờ tập",
          body: `${it.title} lúc ${fmtTime(it.startAt)} — chuẩn bị nhé!`,
          sound: true,
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at, channelId: "reminders" },
      });
    }
    if (epoch === syncEpoch) lastSignature = signature;
  } catch (err) {
    // Không vỡ UI vì nhắc lịch — chỉ log cho dev
    console.warn("[reminders] không đặt được nhắc lịch:", err?.message);
  }
}

// Trạng thái quyền thông báo của máy (cho màn Cài đặt cảnh báo khi bị chặn — review B8)
export async function notificationsPermitted() {
  if (!Notifications) return true;
  try {
    return (await Notifications.getPermissionsAsync()).granted;
  } catch {
    return true;
  }
}
