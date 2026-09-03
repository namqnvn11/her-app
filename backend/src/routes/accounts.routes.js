const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const Trainer = require("../models/Trainer");
const Booking = require("../models/Booking");
const GymClass = require("../models/GymClass");
const { requireAuth, requireManagement, requireRole } = require("../middleware/auth");
const { isValidPhone, isValidPassword, MIN_PASSWORD_LENGTH } = require("../utils/validators");
const wrap = require("../utils/asyncHandler");
const { isValidClassType, labelOf } = require("../utils/disciplines");
const { debtCustomers, expiringPackages } = require("../utils/customerFlags");

const router = express.Router();
// Phân quyền 3 tầng:
//   admin      -> tạo & quản trị tài khoản reception (lễ tân) VÀ trainer (nhân viên/HLV)
//   reception  -> tạo & quản trị tài khoản customer (học viên), và sắp xếp lịch cho nhân viên
// Chỉ cần vài tài khoản reception ban đầu (tạo bằng seed/admin); tài khoản nhân viên do admin
// tạo, tài khoản học viên do lễ tân tạo.
router.use(requireAuth, requireManagement);

// Vai trò mà mỗi tầng được phép tạo/quản lý.
// Quyết định 07/08/2026 (L4): admin là chủ phòng tập — quản lý được MỌI loại tài khoản,
// gồm cả học viên (khớp tài liệu gốc). Lễ tân giữ nguyên: chỉ quản lý học viên.
const ALLOWED_TO_MANAGE = {
  admin: ["reception", "trainer", "customer"],
  reception: ["customer"],
};

function assertCanManage(req, role) {
  const allowed = ALLOWED_TO_MANAGE[req.user.role] || [];
  return allowed.includes(role);
}

// GET /api/accounts?role=trainer|customer|reception&flag=debt|expiring
// her-43: `flag` là đường đi từ khối "Cần xử lý" của màn Tổng quan — lọc đúng nhóm khách
// mà con số trên dashboard đang nói tới (dùng chung util nên không lệch số).
// Chỉ áp cho HỌC VIÊN; vai trò nào không quản lý được học viên thì 403 (H5).
const FLAGS = ["debt", "expiring"];

router.get("/", wrap(async (req, res) => {
  const allowed = ALLOWED_TO_MANAGE[req.user.role] || [];
  const { role, flag } = req.query;
  // her-53: tài khoản đã xoá mềm không hiện ở bất kỳ tab nào
  const query = { role: role && allowed.includes(role) ? role : { $in: allowed }, deletedAt: null };

  let extraByUser = null; // { [userId]: { debt } | { expiringAt } } — gắn thêm vào từng dòng
  if (flag !== undefined) {
    if (!FLAGS.includes(flag)) {
      return res.status(400).json({ error: "Bộ lọc không hợp lệ (chỉ nhận debt hoặc expiring)" });
    }
    if (!allowed.includes("customer")) {
      return res.status(403).json({ error: "Bạn không có quyền xem danh sách học viên" });
    }
    if (role && role !== "customer") {
      return res.status(400).json({ error: "Bộ lọc này chỉ áp dụng cho danh sách học viên" });
    }
    query.role = "customer";
    if (flag === "debt") {
      const { ids, amountByUser } = await debtCustomers();
      query._id = { $in: ids };
      extraByUser = Object.fromEntries(ids.map((id) => [id, { debt: amountByUser[id] }]));
    } else {
      const { ids, soonestByUser } = await expiringPackages();
      query._id = { $in: ids };
      extraByUser = Object.fromEntries(ids.map((id) => [id, { expiringAt: soonestByUser[id] }]));
    }
  }

  const users = await User.find(query).sort({ createdAt: -1 });
  res.json({
    accounts: users.map((u) => ({
      ...u.toPublicJSON(),
      ...(extraByUser ? extraByUser[u._id.toString()] || {} : {}),
    })),
  });
}));

// POST /api/accounts  { name, phone, password, role, specialties? } — chuyên môn HLV CHỌN từ danh mục (her-19)
// role="trainer" -> tự tạo kèm hồ sơ Trainer (để xuất hiện trong danh sách xếp lịch/đặt PT).
router.post("/", wrap(async (req, res) => {
  const { name, phone, password, role, specialty, specialties } = req.body;
  if (!name || !phone || !password || !role) {
    return res.status(400).json({ error: "Thiếu thông tin bắt buộc" });
  }
  if (!assertCanManage(req, role)) {
    return res.status(403).json({ error: "Bạn không có quyền tạo tài khoản vai trò này" });
  }
  if (!isValidPhone(phone)) {
    return res.status(400).json({ error: "Số điện thoại không hợp lệ (10 chữ số, bắt đầu bằng 0)" });
  }
  if (!isValidPassword(password)) {
    return res.status(400).json({ error: `Mật khẩu tối thiểu ${MIN_PASSWORD_LENGTH} ký tự` });
  }
  // SĐT của tài khoản ĐÃ XOÁ được dùng lại (her-53) — index unique cũng chỉ áp cho bản chưa xoá
  const existing = await User.findOne({ phone: phone.trim(), deletedAt: null });
  if (existing) return res.status(409).json({ error: "Số điện thoại đã được đăng ký" });

  const passwordHash = await bcrypt.hash(password, 10);
  let trainerId = null;
  if (role === "trainer") {
    // Chuyên môn phải là các KEY có trong danh mục bộ môn (không nhập tay — her-19).
    // BẮT BUỘC >=1 (review V2): không có đường tạo HLV "wildcard" mới qua API thẳng.
    const keys = [...new Set(Array.isArray(specialties) ? specialties : [])];
    if (keys.length === 0) {
      return res.status(400).json({ error: "Chọn ít nhất 1 chuyên môn cho HLV (từ danh mục bộ môn)" });
    }
    for (const k of keys) {
      if (typeof k !== "string" || !(await isValidClassType(k))) {
        return res.status(400).json({ error: "Chuyên môn không hợp lệ — chọn từ danh mục bộ môn" });
      }
    }
    const specialtyLabel = keys.length
      ? (await Promise.all(keys.map((k) => labelOf(k)))).join(" · ")
      : (typeof specialty === "string" ? specialty : "");
    const trainer = await Trainer.create({ name, specialty: specialtyLabel, specialties: keys });
    trainerId = trainer._id;
  }

  let user;
  try {
    user = await User.create({
      name,
      phone: phone.trim(),
      passwordHash,
      role,
      trainerId,
      createdBy: req.user._id,
    });
  } catch (err) {
    // Tạo user thất bại (vd 2 request song song trùng SĐT) -> dọn hồ sơ Trainer vừa tạo,
    // không để "HLV ma" không có tài khoản lơ lửng trong danh sách xếp lịch
    if (trainerId) await Trainer.deleteOne({ _id: trainerId }).catch(() => {});
    if (err.code === 11000) return res.status(409).json({ error: "Số điện thoại đã được đăng ký" });
    throw err;
  }

  res.status(201).json({ account: user.toPublicJSON() });
}));

// PATCH /api/accounts/:id  { name?, isActive?, password? }
router.patch("/:id", wrap(async (req, res) => {
  const target = await User.findById(req.params.id);
  // Đã xoá mềm = coi như không còn (her-53) — không khoá/mở/cấp mật khẩu cho tài khoản đã xoá
  if (!target || target.deletedAt) return res.status(404).json({ error: "Không tìm thấy tài khoản" });
  if (!assertCanManage(req, target.role)) {
    return res.status(403).json({ error: "Bạn không có quyền sửa tài khoản này" });
  }

  const { name, isActive, password } = req.body;
  // password null/undefined = không đổi mật khẩu (form hay gửi null) — chỉ validate khi có giá trị
  if (password != null && !isValidPassword(password)) {
    return res.status(400).json({ error: `Mật khẩu tối thiểu ${MIN_PASSWORD_LENGTH} ký tự` });
  }
  if (name !== undefined) target.name = name;
  if (isActive !== undefined) target.isActive = isActive;
  if (password) {
    target.passwordHash = await bcrypt.hash(password, 10);
    // Quầy cấp lại mật khẩu -> đá mọi phiên cũ của tài khoản (her-14 A2 — kịch bản mất máy)
    target.passwordChangedAt = new Date();
  }
  await target.save();

  // Đổi tên tài khoản HLV thì đồng bộ luôn hồ sơ Trainer — tên này hiện ở lịch lớp,
  // danh sách đặt PT và title booking mới
  if (name !== undefined && target.role === "trainer" && target.trainerId) {
    await Trainer.updateOne({ _id: target.trainerId }, { $set: { name } });
  }

  res.json({ account: target.toPublicJSON() });
}));

// DELETE /api/accounts/:id -- XOÁ MỀM (her-53, 03/09/2026). Lịch sử 07/08 (L5): xoá thật bị gỡ vì
// để lại dữ liệu mồ côi. Nay chủ dự án cần xoá tài khoản TẠO NHẦM -> xoá mềm: chỉ đặt deletedAt
// (+ isActive=false), booking/gói/lịch sử giữ nguyên, tài khoản ẩn khỏi mọi danh sách và không
// đăng nhập được; SĐT dùng lại được cho tài khoản mới.
// Tài khoản còn LỊCH TƯƠNG LAI thì chặn (D1): khách phải được huỷ lịch, lớp của HLV phải đổi
// người dạy/xoá trước — xoá không được âm thầm làm hỏng buổi của người khác.
// her-56 (03/09): CHỈ ADMIN được xoá — lễ tân 403 (chủ dự án chốt: các chức năng sửa/xoá mới chỉ admin).
router.delete("/:id", requireRole("admin"), wrap(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ error: "Mã (ID) không hợp lệ" });
  }
  const target = await User.findById(req.params.id);
  if (!target || target.deletedAt) return res.status(404).json({ error: "Không tìm thấy tài khoản" });
  if (String(target._id) === String(req.user._id)) {
    return res.status(403).json({ error: "Không thể tự xoá tài khoản của chính mình" });
  }
  if (!assertCanManage(req, target.role)) {
    return res.status(403).json({ error: "Bạn không có quyền xoá tài khoản này" });
  }

  // Lịch TƯƠNG LAI còn giữ chỗ (D1). Booking: mọi trạng thái trừ "cancelled" — buổi được điểm
  // danh sớm đã là completed/no_show nhưng chưa diễn ra xong vẫn tính (review #5, cùng quy ước
  // với bookings.routes). HLV: mọi lớp chưa kết thúc.
  const upcomingError = async (now) => {
    if (target.role === "customer") {
      const n = await Booking.countDocuments({ userId: target._id, status: { $ne: "cancelled" }, endAt: { $gt: now } });
      if (n > 0) return `Học viên còn ${n} buổi sắp tới — huỷ lịch trước khi xoá tài khoản`;
    }
    if (target.role === "trainer" && target.trainerId) {
      const n = await GymClass.countDocuments({ coachId: target.trainerId, endAt: { $gt: now } });
      if (n > 0) return `HLV còn ${n} buổi dạy sắp tới — đổi HLV hoặc xoá buổi trước khi xoá tài khoản`;
    }
    return null;
  };

  const now = new Date();
  let blocked = await upcomingError(now);
  if (blocked) return res.status(400).json({ error: blocked });

  // Điều kiện deletedAt: null -> 2 người bấm xoá cùng lúc thì chỉ 1 request ghi được
  const deleted = await User.findOneAndUpdate(
    { _id: target._id, deletedAt: null },
    { $set: { deletedAt: now, deletedBy: req.user._id, isActive: false } },
    { new: true }
  );
  if (!deleted) return res.status(404).json({ error: "Không tìm thấy tài khoản" });

  // Kiểm LẠI sau khi ghi (review #3): khách/HLV có thể vừa đặt lịch/vừa được xếp lớp trong khe
  // giữa lần đếm trên và lệnh ghi. Phía đặt lịch cũng kiểm lại deletedAt sau khi ghi booking —
  // hai bên cùng "ghi rồi kiểm" nên không còn thứ tự nào để lọt. Có lịch thì hoàn tác xoá.
  blocked = await upcomingError(now);
  if (blocked) {
    await User.updateOne(
      { _id: target._id },
      { $set: { deletedAt: null, deletedBy: null, isActive: target.isActive } }
    );
    return res.status(400).json({ error: blocked });
  }
  res.json({ ok: true, id: deleted._id });
}));

module.exports = router;
