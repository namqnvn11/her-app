const express = require("express");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const Trainer = require("../models/Trainer");
const { requireAuth, requireManagement } = require("../middleware/auth");
const { isValidPhone, isValidPassword, MIN_PASSWORD_LENGTH } = require("../utils/validators");
const wrap = require("../utils/asyncHandler");
const { isValidClassType, labelOf } = require("../utils/disciplines");

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

// GET /api/accounts?role=trainer|customer|reception
router.get("/", wrap(async (req, res) => {
  const allowed = ALLOWED_TO_MANAGE[req.user.role] || [];
  const { role } = req.query;
  const query = { role: role && allowed.includes(role) ? role : { $in: allowed } };
  const users = await User.find(query).sort({ createdAt: -1 });
  res.json({ accounts: users.map((u) => u.toPublicJSON()) });
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
  const existing = await User.findOne({ phone: phone.trim() });
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
  if (!target) return res.status(404).json({ error: "Không tìm thấy tài khoản" });
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

// DELETE /api/accounts/:id -- ĐÃ GỠ theo quyết định 07/08/2026 (L5): xoá thật để lại
// dữ liệu mồ côi (booking giữ chỗ lớp, hồ sơ HLV lơ lửng). Thay bằng khoá tài khoản
// (PATCH isActive=false) — dữ liệu lịch sử giữ nguyên vẹn.
router.delete("/:id", (req, res) => {
  res.status(410).json({
    error: "Chức năng xoá tài khoản đã được thay bằng khoá tài khoản. Hãy dùng nút Khoá.",
  });
});

module.exports = router;
