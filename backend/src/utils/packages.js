const Package = require("../models/Package");
const { labelOfSync } = require("./disciplines");

// Điều kiện "còn buổi": totalSessions null = không giới hạn buổi (Q3)
const HAS_SESSIONS_LEFT = {
  $expr: {
    $or: [{ $eq: ["$totalSessions", null] }, { $lt: ["$usedSessions", "$totalSessions"] }],
  },
};

// Trừ 1 buổi ATOMIC theo H7 mới (her-35): gói khớp = CHỨA bộ môn của lớp (mảng
// serviceTypes, match phần tử) + ĐÚNG loại hình. Thứ tự Q4 (12/08/2026) giữ nguyên:
// 1) gói CÓ thời hạn còn phủ ngày tập — gói sắp hết hạn trừ TRƯỚC
// 2) hết mới tới gói KHÔNG thời hạn — gói kích hoạt trước trừ trước
// 2 lệnh findOneAndUpdate nối tiếp, mỗi lệnh tự chống race (C3) — không read-modify-write.
// Gói không giới hạn buổi vẫn +1 usedSessions (thống kê + hoàn buổi đối xứng khi hủy — C2).
// Gói đang BẢO LƯU (pausedAt != null) không được trừ (Q11 16/08).
async function chargeSession(userId, { serviceType, format }, startAt) {
  const match = { userId, serviceTypes: serviceType, format, pausedAt: null };
  const dated = await Package.findOneAndUpdate(
    // $gte với Date không match expiresAt null (type bracketing của MongoDB)
    { ...match, expiresAt: { $gte: startAt }, ...HAS_SESSIONS_LEFT },
    { $inc: { usedSessions: 1 } },
    // Khoá phụ để tất định khi 2 gói trùng hạn — khớp thứ tự hiển thị ở /me/packages
    { sort: { expiresAt: 1, activatedAt: 1, _id: 1 }, new: true }
  );
  if (dated) return dated;
  return Package.findOneAndUpdate(
    { ...match, expiresAt: null, ...HAS_SESSIONS_LEFT },
    { $inc: { usedSessions: 1 } },
    { sort: { activatedAt: 1, _id: 1 }, new: true }
  );
}

// Chẩn đoán lý do không trừ được buổi — chỉ đọc, trả message tiếng Việt nói rõ
// thiếu BỘ MÔN hay sai LOẠI HÌNH (C6).
// her-39: forStaff = true khi QUẦY ĐẶT HỘ — người đọc message là lễ tân/admin, không phải
// chủ gói. Đổi ngôi ("bạn" -> "học viên này") và bỏ vế "liên hệ quầy lễ tân" (họ ĐANG là quầy),
// thay bằng việc quầy cần làm.
async function packageErrorMessage(userId, { serviceType, format }, startAt, { forStaff = false } = {}) {
  const label = labelOfSync(serviceType);
  const who = forStaff ? "học viên này" : "bạn";
  const owner = forStaff ? "của học viên" : "của bạn";
  const anyOfType = await Package.findOne({ userId, serviceTypes: serviceType });
  if (!anyOfType) return `Buổi này cần gói có bộ môn ${label} — ${who} chưa có gói ${label}`;
  const rightFormat = await Package.findOne({ userId, serviceTypes: serviceType, format });
  if (!rightFormat) {
    return `Buổi này là loại hình ${format} — ${who} chưa có gói ${label} ${format}`;
  }
  const base = { userId, serviceTypes: serviceType, format };
  const notPaused = await Package.findOne({ ...base, pausedAt: null });
  if (!notPaused) {
    return forStaff
      ? `Gói ${label} ${format} của học viên đang bảo lưu — mở bảo lưu trước khi đặt`
      : `Gói ${label} ${format} của bạn đang bảo lưu — liên hệ quầy lễ tân để mở lại`;
  }
  const validNow = await Package.findOne({
    ...base, pausedAt: null,
    $or: [{ expiresAt: null }, { expiresAt: { $gte: new Date() } }],
  });
  if (!validNow) {
    return forStaff
      ? `Gói ${label} ${format} của học viên đã hết hạn — gia hạn trước khi đặt`
      : `Gói ${label} ${format} của bạn đã hết hạn, vui lòng gia hạn`;
  }
  const coversDate = await Package.findOne({
    ...base, pausedAt: null,
    $or: [{ expiresAt: null }, { expiresAt: { $gte: startAt } }],
  });
  if (!coversDate) {
    return forStaff
      ? `Gói ${label} ${format} ${owner} hết hạn trước ngày diễn ra buổi này — gia hạn hoặc chọn buổi khác`
      : `Gói ${label} ${format} của bạn hết hạn trước ngày diễn ra buổi này — vui lòng gia hạn hoặc chọn buổi sớm hơn`;
  }
  return forStaff
    ? `Gói ${label} ${format} của học viên đã hết buổi — cần gói mới trước khi đặt`
    : `Gói ${label} ${format} đã hết buổi, vui lòng gia hạn`;
}

// Chuẩn hoá gói trả cho app (cả app khách lẫn nội bộ) — null = không giới hạn.
// paidAmount null = gói cũ trước đợt thanh toán, coi như đã thu đủ (quyết định 16/08).
function serializePackage(p) {
  const now = new Date();
  const paused = p.pausedAt != null;
  const expired = !paused && p.expiresAt != null && p.expiresAt < now;
  const usedUp = p.totalSessions != null && p.usedSessions >= p.totalSessions;
  const paidAmount = p.paidAmount == null ? p.price : p.paidAmount;
  return {
    id: p._id,
    name: p.name,
    serviceTypes: p.serviceTypes,
    serviceLabels: p.serviceTypes.map(labelOfSync),
    format: p.format,
    price: p.price,
    totalSessions: p.totalSessions,
    usedSessions: p.usedSessions,
    remainingSessions: p.totalSessions == null ? null : Math.max(p.totalSessions - p.usedSessions, 0),
    activatedAt: p.activatedAt,
    expiresAt: p.expiresAt,
    paymentMethod: p.paymentMethod || "cash",
    paidAmount,
    debt: Math.max(p.price - paidAmount, 0),
    isPaid: paidAmount >= p.price,
    pausedAt: p.pausedAt || null,
    status: paused ? "paused" : expired ? "expired" : usedUp ? "used_up" : "active",
  };
}

module.exports = { chargeSession, packageErrorMessage, serializePackage, HAS_SESSIONS_LEFT };
