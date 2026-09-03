const Package = require("../models/Package");
const { labelOfSync } = require("./disciplines");

// Điều kiện "còn buổi": totalSessions null = không giới hạn buổi (Q3)
const HAS_SESSIONS_LEFT = {
  $expr: {
    $or: [{ $eq: ["$totalSessions", null] }, { $lt: ["$usedSessions", "$totalSessions"] }],
  },
};

// Số buổi còn lại để xếp thứ tự trừ — gói không giới hạn buổi coi như vô hạn (xếp cuối)
const remainingOf = (p) => (p.totalSessions == null ? Infinity : p.totalSessions - p.usedSessions);

// So sánh gói KHÔNG thời hạn (her-54, chủ dự án chốt 03/09): ÍT buổi còn lại hơn trừ trước
// (dọn gói lẻ trước), bằng nhau thì gói kích hoạt trước, cuối cùng theo id cho tất định.
// Dùng chung cho chargeSession và thứ tự hiển thị ở /me/packages (1 nguồn).
function byRemainingThenActivation(a, b) {
  const ra = remainingOf(a);
  const rb = remainingOf(b);
  if (ra !== rb) return ra - rb;
  const aa = new Date(a.activatedAt).getTime();
  const ba = new Date(b.activatedAt).getTime();
  if (aa !== ba) return aa - ba;
  return String(a._id || a.id).localeCompare(String(b._id || b.id));
}

// Trừ 1 buổi ATOMIC theo H7 mới (her-35): gói khớp = CHỨA bộ môn của lớp (mảng
// serviceTypes, match phần tử) + ĐÚNG loại hình. Thứ tự Q4 (12/08/2026, sửa 03/09 her-54):
// 1) gói CÓ thời hạn còn phủ ngày tập — gói sắp hết hạn trừ TRƯỚC
// 2) hết mới tới gói KHÔNG thời hạn — gói ÍT BUỔI CÒN LẠI hơn trừ trước (trước 03/09: kích hoạt trước)
// Mỗi lệnh ghi là findOneAndUpdate có điều kiện "còn buổi" nên tự chống race (C3) — không
// read-modify-write. Bước 2 không sort được theo hiệu totalSessions-usedSessions trong Mongo nên
// đọc danh sách ứng viên, xếp ở đây, rồi thử ghi có điều kiện TỪNG gói theo thứ tự: gói vừa bị
// request khác trừ hết trong khe đọc-ghi thì lệnh ghi không khớp -> chuyển sang gói kế tiếp.
// Gói không giới hạn buổi vẫn +1 usedSessions (thống kê + hoàn buổi đối xứng khi hủy — C2).
// Gói đang BẢO LƯU (pausedAt != null) không được trừ (Q11 16/08).
async function chargeSession(userId, { serviceType, format }, startAt) {
  // her-55: gói đã xoá mềm không bao giờ được chọn
  const match = { userId, serviceTypes: serviceType, format, pausedAt: null, deletedAt: null };
  const dated = await Package.findOneAndUpdate(
    // $gte với Date không match expiresAt null (type bracketing của MongoDB)
    { ...match, expiresAt: { $gte: startAt }, ...HAS_SESSIONS_LEFT },
    { $inc: { usedSessions: 1 } },
    // Khoá phụ để tất định khi 2 gói trùng hạn — khớp thứ tự hiển thị ở /me/packages
    { sort: { expiresAt: 1, activatedAt: 1, _id: 1 }, new: true }
  );
  if (dated) return dated;

  const candidates = await Package.find({ ...match, expiresAt: null, ...HAS_SESSIONS_LEFT })
    .select("totalSessions usedSessions activatedAt");
  candidates.sort(byRemainingThenActivation);
  for (const c of candidates) {
    const charged = await Package.findOneAndUpdate(
      { _id: c._id, pausedAt: null, expiresAt: null, ...HAS_SESSIONS_LEFT },
      { $inc: { usedSessions: 1 } },
      { new: true }
    );
    if (charged) return charged;
  }
  return null;
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
  const anyOfType = await Package.findOne({ userId, serviceTypes: serviceType, deletedAt: null }); // her-55: bỏ gói đã xoá
  if (!anyOfType) return `Buổi này cần gói có bộ môn ${label} — ${who} chưa có gói ${label}`;
  const rightFormat = await Package.findOne({ userId, serviceTypes: serviceType, format, deletedAt: null });
  if (!rightFormat) {
    return `Buổi này là loại hình ${format} — ${who} chưa có gói ${label} ${format}`;
  }
  const base = { userId, serviceTypes: serviceType, format, deletedAt: null };
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

// her-53 (D9): gói đã có lần THU NỢ sau khi bán? Dòng thu lúc bán mang đúng thời điểm activatedAt
// (route bán gói dùng chung 1 biến), dòng /pay mang thời điểm thu -> muộn hơn. Không đếm số dòng
// vì gói bán chưa thu đồng nào rồi thu nợ 1 lần cũng chỉ có 1 dòng.
function hasDebtPayment(p) {
  const soldAt = p.activatedAt ? p.activatedAt.getTime() : 0;
  return (p.payments || []).some((x) => x.at && x.at.getTime() > soldAt);
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
    // her-53: số dòng trong sổ thu — app dựa vào đây để biết còn sửa tay "số đã thu" được không (D9)
    paymentCount: Array.isArray(p.payments) ? p.payments.length : 0,
    // true = đã có lần thu nợ -> app khoá khối "Thu đủ/Còn thiếu" khi sửa gói (cùng luật với server)
    paidLocked: hasDebtPayment(p),
    status: paused ? "paused" : expired ? "expired" : usedUp ? "used_up" : "active",
  };
}

module.exports = { chargeSession, packageErrorMessage, serializePackage, hasDebtPayment, byRemainingThenActivation, HAS_SESSIONS_LEFT };
