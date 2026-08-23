const Setting = require("../models/Setting");

// Giá trị MẶC ĐỊNH khi admin chưa cài trong app (her-47) — vẫn đọc từ env để môi trường
// test/seed giữ nguyên hành vi cũ.
const MIN_CANCEL_HOURS = Number(process.env.MIN_CANCEL_HOURS || 3);
const MAX_CANCEL_HOURS = Setting.MAX_CANCEL_HOURS;

// Cache trong RAM có HẠN NGẮN: luật hủy được hỏi ở mọi lần login//me/hủy lịch, không nên
// query DB mỗi lần; nhưng cache phải tự hết hạn để (a) nhiều instance server cùng DB vẫn
// đồng bộ sau vài giây, (b) seed/sửa tay trên DB không bị "đóng băng" số cũ (review her-47 #1,#3).
// Admin lưu trên instance này thì ghi thẳng vào cache → hiệu lực ngay tại chỗ.
const CACHE_MS = Number(process.env.SETTINGS_CACHE_MS || 15_000);
let cached = null;
let cachedAt = 0;
let generation = 0; // tăng mỗi lần cache bị thay — request đọc chậm không được ghi đè số mới (#2)

async function getMinCancelHours() {
  if (cached !== null && Date.now() - cachedAt < CACHE_MS) return cached;
  const gen = generation;
  let value;
  try {
    const doc = await Setting.findOne({ key: "studio" }).lean();
    value = typeof doc?.minCancelHours === "number" ? doc.minCancelHours : MIN_CANCEL_HOURS;
  } catch (err) {
    // DB lỗi khi đọc 1 field cấu hình phụ thì KHÔNG được làm hỏng đăng nhập/hủy lịch (#6):
    // log rõ rồi dùng số gần nhất còn nhớ, chưa có thì dùng mặc định env.
    console.error("[settings] không đọc được minCancelHours, dùng tạm giá trị gần nhất:", err.message);
    return cached !== null ? cached : MIN_CANCEL_HOURS;
  }
  if (gen === generation) { cached = value; cachedAt = Date.now(); }
  return gen === generation ? value : cached;
}

// Admin vừa lưu: ghi thẳng giá trị mới vào cache (không chờ đọc lại DB, không để request
// đọc chậm đang dở ghi đè). Gọi không tham số = chỉ xoá cache (đọc lại DB lần kế).
function setCachedMinCancelHours(value) {
  generation += 1;
  cached = typeof value === "number" ? value : null;
  cachedAt = Date.now();
}

// Khách chỉ được tự hủy nếu còn >= minHours trước giờ tập.
// Nhân viên/lễ tân (role staff|admin) không bị giới hạn này.
function canCustomerCancel(startAt, minHours = MIN_CANCEL_HOURS) {
  const hoursLeft = (new Date(startAt).getTime() - Date.now()) / 3_600_000;
  return hoursLeft >= minHours;
}

module.exports = { canCustomerCancel, getMinCancelHours, setCachedMinCancelHours, MIN_CANCEL_HOURS, MAX_CANCEL_HOURS };
