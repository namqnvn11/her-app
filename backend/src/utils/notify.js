const User = require("../models/User");
const Notification = require("../models/Notification");

// her-57 (03/09/2026): thông báo "khách đặt / hủy lịch" cho admin, lễ tân và HLV của buổi.
// Quy tắc chủ dự án chốt: HLV chỉ nhận buổi MÌNH dạy; quầy đặt/hủy hộ vẫn báo cho những
// người KHÔNG phải người bấm (kèm chữ "(quầy đặt hộ)"); người bấm không tự nhận.
// Thứ tự: ghi DB (nguồn sự thật cho chuông trong app) -> đẩy push (Expo Push API) không chờ.
// Lỗi ở đây KHÔNG được làm hỏng đặt/hủy lịch đã thành công — log rõ, không nuốt im lặng (C4).

const EXPO_PUSH_URL = () => process.env.EXPO_PUSH_URL || "https://exp.host/--/api/v2/push/send";
const PUSH_CHUNK = 100; // giới hạn của Expo Push API

const pad = (n) => String(n).padStart(2, "0");
const DAY_LABEL = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
// "T5 05/09 · 18:00" — giờ máy (VN) theo quy ước dự án
const fmtWhen = (d) => `${DAY_LABEL[d.getDay()]} ${pad(d.getDate())}/${pad(d.getMonth() + 1)} · ${pad(d.getHours())}:${pad(d.getMinutes())}`;

// Người nhận: mọi admin + lễ tân đang hoạt động, HLV có hồ sơ = HLV của buổi; trừ người bấm.
// coachId lấy từ BOOKING (đã đồng bộ khi quầy đổi HLV — her-09) chứ không từ bản lớp đọc trước đó
// (review #4). Không có coachId (dữ liệu cũ) thì KHÔNG thêm nhánh HLV — Mongoose bỏ key undefined
// khỏi filter, `{ role: "trainer" }` trần sẽ báo cho MỌI HLV (review #3).
async function recipientsFor(coachId, actorId) {
  const or = [{ role: { $in: ["admin", "reception"] } }];
  if (coachId) or.push({ role: "trainer", trainerId: coachId });
  const users = await User.find({ deletedAt: null, isActive: { $ne: false }, $or: or }).select("_id pushTokens");
  return users.filter((u) => String(u._id) !== String(actorId));
}

function buildMessage(kind, { booking, gymClass, customer, byStaff }) {
  const when = fmtWhen(new Date(booking.startAt));
  const cls = gymClass.name || booking.title;
  if (kind === "created") {
    return {
      type: "booking_created",
      title: "Đặt lịch mới",
      body: `${customer.name} đã đặt lịch ${cls} · ${when}${byStaff ? " (quầy đặt hộ)" : ""}`,
    };
  }
  return {
    type: "booking_cancelled",
    title: "Hủy lịch",
    body: `${customer.name} đã hủy lịch ${cls} · ${when}${byStaff ? " (quầy hủy hộ)" : ""}`,
  };
}

// Gửi 1 lô message tới Expo Push API bằng fetch có sẵn của Node (không thêm dependency).
// Token bị Expo báo DeviceNotRegistered (gỡ app, đổi máy) -> rút khỏi user để không gửi mãi.
async function sendExpoPush(messages) {
  for (let i = 0; i < messages.length; i += PUSH_CHUNK) {
    const chunk = messages.slice(i, i + PUSH_CHUNK);
    const res = await fetch(EXPO_PUSH_URL(), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(chunk.map(({ userId, ...m }) => m)),
    });
    if (!res.ok) {
      console.error("[push] Expo Push API trả lỗi HTTP", res.status, await res.text().catch(() => ""));
      continue;
    }
    const json = await res.json().catch(() => null);
    const tickets = Array.isArray(json?.data) ? json.data : [];
    const dead = [];
    tickets.forEach((t, idx) => {
      if (t?.status === "error") {
        const m = chunk[idx];
        if (t.details?.error === "DeviceNotRegistered") dead.push(m);
        else console.error("[push] ticket lỗi:", t.message, t.details, "token", m?.to);
      }
    });
    for (const m of dead) {
      await User.updateOne({ _id: m.userId }, { $pull: { pushTokens: { token: m.to } } });
    }
  }
}

// Điểm vào duy nhất — gọi sau khi đặt/hủy đã THÀNH CÔNG. Trả về số thông báo đã ghi (để test).
async function notifyBooking(kind, { booking, gymClass, customer, actor }) {
  try {
    const byStaff = String(actor._id) !== String(customer._id);
    const recipients = await recipientsFor(booking.trainerId || gymClass.coachId, actor._id);
    if (recipients.length === 0) return 0;
    const msg = buildMessage(kind, { booking, gymClass, customer, byStaff });
    const data = { bookingId: booking._id, classId: gymClass._id, customerId: customer._id };
    const docs = recipients.map((u) => ({ userId: u._id, ...msg, data, actorId: actor._id }));
    await Notification.insertMany(docs, { ordered: false });

    // channelId "default" = kênh app tạo trên Android (bắt buộc từ Android 8, review #1); priority high
    // để hiện banner. Khử token trùng (phòng dữ liệu cũ) — 1 máy chỉ 1 banner.
    const pushes = [];
    const seen = new Set();
    for (const u of recipients) {
      for (const t of u.pushTokens || []) {
        if (seen.has(t.token)) continue;
        seen.add(t.token);
        pushes.push({
          userId: u._id, to: t.token, title: msg.title, body: msg.body, sound: "default",
          channelId: "default", priority: "high", data: { type: msg.type, ...data },
        });
      }
    }
    if (pushes.length) {
      // Không chờ mạng ngoài trong request của khách — nhưng lỗi vẫn phải lên log
      sendExpoPush(pushes).catch((err) => console.error("[push] gửi thất bại:", err.message));
    }
    return docs.length;
  } catch (err) {
    console.error("[notify] không ghi được thông báo (đặt/hủy vẫn thành công):", err.message);
    return 0;
  }
}

// Định dạng token của Expo: ExponentPushToken[xxx] hoặc ExpoPushToken[xxx]
const isExpoPushToken = (t) => typeof t === "string" && /^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$/.test(t);

module.exports = { notifyBooking, sendExpoPush, isExpoPushToken, fmtWhen };
