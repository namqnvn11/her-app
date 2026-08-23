const express = require("express");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const Trainer = require("../models/Trainer");
const Package = require("../models/Package");
const Booking = require("../models/Booking");
const AutoScheduleRule = require("../models/AutoScheduleRule");
const { requireAuth } = require("../middleware/auth");
const { getMinCancelHours } = require("../utils/cancelRule");
const { ATTENDANCE_OPEN_BEFORE_MINUTES } = require("../utils/attendanceRule");
const wrap = require("../utils/asyncHandler");
const { serializePackage } = require("../utils/packages");
const { isValidPassword, MIN_PASSWORD_LENGTH } = require("../utils/validators");
const { isValidClassType, labelOf } = require("../utils/disciplines");
const { blockedMinutes, recordFailure, resetAttempts } = require("../utils/loginRateLimit");
const { renewedToken } = require("../utils/token");

const router = express.Router();
router.use(requireAuth);

// GET /api/me — kèm config để app đồng bộ quy tắc với server (vd số giờ tự hủy).
// her-45: đây cũng là chỗ GIA HẠN TRƯỢT — app gọi /me mỗi lần mở, token đã cũ thì trả về
// `token` mới để app lưu đè. Chưa tới lúc gia hạn thì KHÔNG có field `token` (app giữ nguyên).
router.get("/", wrap(async (req, res) => {
  const token = renewedToken(req.user, req.tokenPayload);
  res.json({
    user: req.user.toPublicJSON(),
    config: { minCancelHours: await getMinCancelHours(), attendanceOpenBeforeMinutes: ATTENDANCE_OPEN_BEFORE_MINUTES, minPasswordLength: MIN_PASSWORD_LENGTH },
    ...(token ? { token } : {}),
  });
}));

// PATCH /api/me  { name?, avatarUrl? }  -- đổi số điện thoại nên xử lý riêng vì cần unique-check
router.patch("/", wrap(async (req, res) => {
  const { name, avatarUrl } = req.body;
  if (name !== undefined) req.user.name = name;
  if (avatarUrl !== undefined) req.user.avatarUrl = avatarUrl;
  await req.user.save();

  // Tài khoản có hồ sơ HLV (role trainer HOẶC admin kiêm HLV — review her-11 N4) tự đổi tên
  // -> đồng bộ hồ sơ Trainer (tên hiện ở lịch lớp, danh sách đặt của khách)
  if (name !== undefined && req.user.trainerId) {
    await Trainer.updateOne({ _id: req.user.trainerId }, { $set: { name: req.user.name } });
  }

  res.json({ user: req.user.toPublicJSON() });
}));

// POST /api/me/change-password { currentPassword, newPassword } — mục 10 (her-14):
// MỌI vai trò tự đổi mật khẩu của chính mình. Phải nhập đúng mật khẩu hiện tại;
// mật khẩu mới dùng chung luật với lúc tạo tài khoản (validators). Token đang dùng
// vẫn hợp lệ sau khi đổi — không bắt đăng nhập lại.
router.post("/change-password", wrap(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (typeof currentPassword !== "string" || !currentPassword) {
    return res.status(400).json({ error: "Vui lòng nhập mật khẩu hiện tại" });
  }
  if (typeof newPassword !== "string" || !isValidPassword(newPassword)) {
    return res.status(400).json({ error: `Mật khẩu mới tối thiểu ${MIN_PASSWORD_LENGTH} ký tự` });
  }
  // Rate-limit như đăng nhập (review her-14 A1): kẻ cầm máy đang mở app không được dùng
  // endpoint này dò mật khẩu không giới hạn. Key riêng theo user, chung hạ tầng loginRateLimit.
  const rlKey = `pw:${req.user._id}`;
  const blocked = blockedMinutes(rlKey);
  if (blocked) {
    return res.status(429).json({ error: `Sai mật khẩu quá nhiều lần — thử lại sau ${blocked} phút` });
  }
  const ok = await bcrypt.compare(currentPassword, req.user.passwordHash);
  if (!ok) {
    recordFailure(rlKey);
    return res.status(400).json({ error: "Mật khẩu hiện tại không đúng" });
  }
  resetAttempts(rlKey);
  req.user.passwordHash = await bcrypt.hash(newPassword, 10);
  // Đá mọi phiên cũ (A2) — app tự đăng nhập lại ngay bằng mật khẩu mới nên người đổi không gián đoạn
  req.user.passwordChangedAt = new Date();
  await req.user.save();
  res.json({ ok: true });
}));

// POST /api/me/trainer-profile { name, specialties? } — admin KIÊM HLV (mục 6; chuyên môn CHỌN từ danh mục — her-19):
// admin bật 1 lần trong màn Cá nhân → tạo hồ sơ Trainer gắn vào tài khoản; từ đó xuất hiện
// trong danh sách HLV, tự mở buổi 1:1/1:2, khách đặt như HLV thường. CHỈ admin (H5) — tài khoản
// HLV thường đã có hồ sơ từ lúc quầy tạo; không mở đường tự phong HLV cho role khác.
router.post("/trainer-profile", wrap(async (req, res) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ error: "Chỉ admin mới mở được hồ sơ HLV cho chính mình" });
  }
  if (req.user.trainerId) {
    return res.status(400).json({ error: "Tài khoản này đã có hồ sơ HLV" });
  }
  const { name, specialty, specialties } = req.body;
  if (typeof name !== "string" || !name.trim() || name.trim().length > 100) {
    return res.status(400).json({ error: "Vui lòng nhập tên hiển thị của HLV (tối đa 100 ký tự)" });
  }
  const keys = [...new Set(Array.isArray(specialties) ? specialties : [])];
  if (keys.length === 0) {
    return res.status(400).json({ error: "Chọn ít nhất 1 chuyên môn (từ danh mục bộ môn)" });
  }
  for (const k of keys) {
    if (typeof k !== "string" || !(await isValidClassType(k))) {
      return res.status(400).json({ error: "Chuyên môn không hợp lệ — chọn từ danh mục bộ môn" });
    }
  }
  const specialtyLabel = keys.length
    ? (await Promise.all(keys.map((k) => labelOf(k)))).join(" · ")
    : (typeof specialty === "string" ? specialty.trim().slice(0, 200) : "");
  const trainer = await Trainer.create({
    name: name.trim(),
    specialty: specialtyLabel,
    specialties: keys,
  });
  // Gán atomic với điều kiện CHƯA có trainerId — 2 request song song thì chỉ 1 gán được
  const updated = await User.findOneAndUpdate(
    { _id: req.user._id, trainerId: null },
    { $set: { trainerId: trainer._id } },
    { new: true }
  );
  if (!updated) {
    await Trainer.deleteOne({ _id: trainer._id }); // dọn hồ sơ thừa của request thua
    return res.status(400).json({ error: "Tài khoản này đã có hồ sơ HLV" });
  }
  res.status(201).json({ user: updated.toPublicJSON(), trainer: { id: trainer._id, name: trainer.name } });
}));

// her-34: admin sửa hồ sơ HLV của CHÍNH MÌNH (tên hiển thị + chuyên môn) — màn Cá nhân.
// CHỈ admin (H5): HLV thường không tự đổi chuyên môn (chuyên môn do quản lý đặt lúc tạo).
function requireOwnTrainerProfile(req, res) {
  if (req.user.role !== "admin") {
    res.status(403).json({ error: "Chỉ admin mới xem/sửa được hồ sơ HLV của chính mình" });
    return false;
  }
  if (!req.user.trainerId) {
    res.status(400).json({ error: "Tài khoản này chưa có hồ sơ HLV — hãy bấm Mở hồ sơ HLV trước" });
    return false;
  }
  return true;
}

// GET /api/me/trainer-profile — đọc để điền sẵn form sửa
router.get("/trainer-profile", wrap(async (req, res) => {
  if (!requireOwnTrainerProfile(req, res)) return;
  const trainer = await Trainer.findById(req.user.trainerId);
  if (!trainer) return res.status(404).json({ error: "Không tìm thấy hồ sơ HLV" });
  res.json({ trainer: { id: trainer._id, name: trainer.name, specialties: trainer.specialties } });
}));

// PATCH /api/me/trainer-profile { name?, specialties? } — validate y hệt lúc tạo (POST trên)
router.patch("/trainer-profile", wrap(async (req, res) => {
  if (!requireOwnTrainerProfile(req, res)) return;
  const { name, specialties } = req.body;
  if (name === undefined && specialties === undefined) {
    return res.status(400).json({ error: "Không có gì để sửa" });
  }

  const set = {};
  if (name !== undefined) {
    if (typeof name !== "string" || !name.trim() || name.trim().length > 100) {
      return res.status(400).json({ error: "Vui lòng nhập tên hiển thị của HLV (tối đa 100 ký tự)" });
    }
    set.name = name.trim();
  }
  if (specialties !== undefined) {
    const keys = [...new Set(Array.isArray(specialties) ? specialties : [])];
    if (keys.length === 0) {
      return res.status(400).json({ error: "Chọn ít nhất 1 chuyên môn (từ danh mục bộ môn)" });
    }
    for (const k of keys) {
      if (typeof k !== "string" || !(await isValidClassType(k))) {
        return res.status(400).json({ error: "Chuyên môn không hợp lệ — chọn từ danh mục bộ môn" });
      }
    }
    // Review her-34 #1: generator Lịch tự động KHÔNG re-check chuyên môn — bỏ môn đang có
    // luật gán cho chính mình sẽ sinh lớp trái chuyên môn vô hạn. Chặn cả luật đang TẮT
    // (bật lại là sinh ngay, PATCH active không re-check).
    const conflictRule = await AutoScheduleRule.findOne({
      coachId: req.user.trainerId,
      serviceType: { $nin: keys },
    });
    if (conflictRule) {
      const label = await labelOf(conflictRule.serviceType);
      return res.status(400).json({
        error: `Bạn đang có luật Lịch tự động môn ${label} — xoá luật đó trước khi bỏ chuyên môn này`,
      });
    }
    set.specialties = keys;
    set.specialty = (await Promise.all(keys.map((k) => labelOf(k)))).join(" · ");
  }

  const trainer = await Trainer.findByIdAndUpdate(req.user.trainerId, { $set: set }, { new: true });
  if (!trainer) return res.status(404).json({ error: "Không tìm thấy hồ sơ HLV" });
  res.json({ trainer: { id: trainer._id, name: trainer.name, specialties: trainer.specialties } });
}));

// So sánh tất định cho danh sách gói: hạn gần trước (không hạn cuối), hạn bằng nhau thì
// gói kích hoạt trước đứng trước, cuối cùng theo id — không phụ thuộc thứ tự Mongo trả về
function byExpiryThenActivation(a, b) {
  const ax = a.expiresAt ? new Date(a.expiresAt).getTime() : Infinity;
  const bx = b.expiresAt ? new Date(b.expiresAt).getTime() : Infinity;
  if (ax !== bx) return ax - bx;
  const aa = new Date(a.activatedAt).getTime();
  const ba = new Date(b.activatedAt).getTime();
  if (aa !== ba) return aa - ba;
  return String(a.id).localeCompare(String(b.id));
}

// GET /api/me/package -- gói "nổi bật" cho card trang chủ (giữ tương thích app cũ):
// gói đang active có hạn gần nhất; không có gói có hạn thì lấy gói không thời hạn
router.get("/package", wrap(async (req, res) => {
  const all = await Package.find({ userId: req.user._id });
  const active = all.map(serializePackage).filter((p) => p.status === "active");
  active.sort(byExpiryThenActivation);
  if (active[0]) return res.json({ package: active[0] });
  // Không có gói active nhưng CÓ gói đang bảo lưu -> trả gói đó (status "paused") để app
  // nói đúng "gói đang bảo lưu" thay vì "chưa có gói, liên hệ mua" (C6)
  const paused = all.map(serializePackage).filter((p) => p.status === "paused");
  paused.sort(byExpiryThenActivation);
  res.json({ package: paused[0] || null });
}));

// GET /api/me/packages -- toàn bộ gói của tôi: đang dùng trước (hạn gần lên đầu, không hạn
// cuối nhóm), gói bảo lưu/hết buổi/hết hạn xếp sau — học viên tự tra cứu (quyết định 12/08/2026)
router.get("/packages", wrap(async (req, res) => {
  const all = await Package.find({ userId: req.user._id });
  const items = all.map(serializePackage);
  const order = { active: 0, paused: 1, used_up: 2, expired: 3 };
  items.sort((a, b) => {
    if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
    return byExpiryThenActivation(a, b);
  });
  res.json({ packages: items });
}));

// GET /api/me/bookings -- lịch sắp tới VÀ đang diễn ra (status booked, chưa qua giờ KẾT THÚC —
// buổi 7:00-8:00 lúc 7:15 vẫn phải hiện ở đây, không "biến mất" trước khi sweep chạy)
router.get("/bookings", wrap(async (req, res) => {
  const bookings = await Booking.find({
    userId: req.user._id,
    // $ne cancelled: buổi được điểm danh sớm (trước giờ) vẫn là buổi SẮP diễn ra của khách
    status: { $ne: "cancelled" },
    endAt: { $gte: new Date() },
  })
    .sort({ startAt: 1 })
    .populate("trainerId", "name");
  res.json({ bookings: bookings.map(serializeBooking) });
}));

// GET /api/me/history?page=&limit= -- đã tập/đã hủy hoặc đã qua giờ kết thúc.
// her-28: phân trang (mới nhất trước, app cuộn cuối tự nạp tiếp) — không truyền gì thì
// mặc định 50 như cũ để client cũ không vỡ. _id làm khoá phụ chống lặp giữa 2 trang.
router.get("/history", wrap(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
  // Lịch sử = buổi ĐÃ KẾT THÚC hoặc ĐÃ HỦY (chốt 16/08) — buổi điểm danh sớm còn đang
  // diễn ra vẫn nằm ở "Sắp tới" với nhãn trạng thái, kết thúc xong mới chuyển vào đây
  const bookings = await Booking.find({
    userId: req.user._id,
    $or: [{ status: "cancelled" }, { endAt: { $lt: new Date() } }],
  })
    .sort({ startAt: -1, _id: -1 })
    .skip((page - 1) * limit)
    .limit(limit + 1) // lấy dư 1 để biết còn trang sau
    .populate("trainerId", "name");
  const hasMore = bookings.length > limit;
  if (hasMore) bookings.pop();
  res.json({ hasMore, bookings: bookings.map(serializeBooking) });
}));

function serializeBooking(b) {
  return {
    id: b._id,
    // her-35: bộ môn + loại hình là SNAPSHOT lúc đặt — app hiện nhãn buổi không cần join lớp
    serviceType: b.serviceType,
    format: b.format,
    // id lớp để màn Đặt lịch đánh dấu "Đã đặt" ngay trên danh sách (góp ý 16/08)
    classId: b.classId,
    title: b.title,
    coach: b.trainerId?.name || "",
    startAt: b.startAt,
    endAt: b.endAt,
    status: b.status,
  };
}

module.exports = router;
