const express = require("express");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const { getMinCancelHours } = require("../utils/cancelRule");
const { ATTENDANCE_OPEN_BEFORE_MINUTES } = require("../utils/attendanceRule");
const { isValidPhone, isValidPassword, MIN_PASSWORD_LENGTH } = require("../utils/validators");
const { blockedMinutes, recordFailure, resetAttempts } = require("../utils/loginRateLimit");
const wrap = require("../utils/asyncHandler");
const { signToken } = require("../utils/token");

const router = express.Router();

// Cấu hình app cần biết (vd số giờ tối thiểu để tự hủy lịch) — gửi kèm khi login và /me
// để mobile không phải ghi cứng con số nào. her-47: số giờ hủy do admin cài trong app (DB).
async function publicConfig() {
  return { minCancelHours: await getMinCancelHours(), attendanceOpenBeforeMinutes: ATTENDANCE_OPEN_BEFORE_MINUTES, minPasswordLength: MIN_PASSWORD_LENGTH };
}

// POST /api/auth/login  { phone, password }
router.post("/login", wrap(async (req, res) => {
  const { phone, password } = req.body;
  // Kiểm tra kiểu trước khi .trim() — body có thể là bất kỳ JSON nào từ bên ngoài
  if (typeof phone !== "string" || typeof password !== "string" || !phone || !password) {
    return res.status(400).json({ error: "Vui lòng nhập số điện thoại và mật khẩu" });
  }
  const phoneKey = phone.trim();

  // SĐT sai định dạng chắc chắn không phải tài khoản thật -> trả lời chung luôn,
  // không ghi vào bộ đếm rate-limit (tránh kẻ xấu spam chuỗi rác làm phình bộ nhớ)
  if (!/^0\d{9}$/.test(phoneKey)) {
    return res.status(401).json({ error: "Sai số điện thoại hoặc mật khẩu" });
  }

  const blocked = blockedMinutes(phoneKey);
  if (blocked) {
    return res.status(429).json({
      error: `Bạn đã nhập sai quá nhiều lần. Vui lòng thử lại sau ${blocked} phút.`,
    });
  }

  // her-53: chỉ tài khoản CHƯA xoá đăng nhập được. SĐT đã xoá có thể được cấp lại cho tài khoản
  // mới -> luôn tìm bản chưa xoá trước.
  const user = await User.findOne({ phone: phoneKey, deletedAt: null });
  if (!user) {
    // Không có tài khoản đang dùng: nếu có tài khoản ĐÃ XOÁ cùng SĐT và mật khẩu đúng thì nói rõ
    // "đã bị xoá" (cùng nguyên tắc với "bị khoá": chỉ lộ tình trạng khi có mật khẩu — H6/L9)
    const deleted = await User.findOne({ phone: phoneKey, deletedAt: { $ne: null } }).sort({ deletedAt: -1 });
    if (deleted && (await bcrypt.compare(password, deleted.passwordHash))) {
      return res.status(403).json({ error: "Tài khoản đã bị xoá, vui lòng liên hệ quầy lễ tân" });
    }
    if (!deleted) {
      // So sánh với hash giả để thời gian trả lời không tiết lộ "SĐT này có tài khoản hay không"
      await bcrypt.compare(password, "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy");
    }
    recordFailure(phoneKey);
    return res.status(401).json({ error: "Sai số điện thoại hoặc mật khẩu" });
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    recordFailure(phoneKey);
    return res.status(401).json({ error: "Sai số điện thoại hoặc mật khẩu" });
  }

  // Chỉ báo "bị khoá" khi mật khẩu đúng — người không có mật khẩu không dò được tình trạng tài khoản
  if (user.isActive === false) {
    return res.status(403).json({ error: "Tài khoản đã bị khoá, vui lòng liên hệ quản trị" });
  }

  resetAttempts(phoneKey);
  const token = signToken(user);
  res.json({ token, user: user.toPublicJSON(), config: await publicConfig() });
}));

// POST /api/auth/register  { name, phone, password }
// App hiện không có màn hình đăng ký — đường này mặc định ĐÓNG, chỉ mở khi đặt
// ALLOW_SELF_REGISTER=true trong .env (dành cho giai đoạn làm màn hình đăng ký sau này).
router.post("/register", wrap(async (req, res) => {
  if (process.env.ALLOW_SELF_REGISTER !== "true") {
    return res.status(403).json({
      error: "Hệ thống không mở đăng ký trực tiếp. Vui lòng liên hệ lễ tân để được tạo tài khoản.",
    });
  }

  const { name, phone, password, email } = req.body;
  if (!name || !phone || !password) {
    return res.status(400).json({ error: "Thiếu thông tin bắt buộc" });
  }
  if (!isValidPhone(phone)) {
    return res.status(400).json({ error: "Số điện thoại không hợp lệ (10 chữ số, bắt đầu bằng 0)" });
  }
  if (!isValidPassword(password)) {
    return res.status(400).json({ error: `Mật khẩu tối thiểu ${MIN_PASSWORD_LENGTH} ký tự` });
  }
  const existing = await User.findOne({ phone: phone.trim(), deletedAt: null }); // SĐT đã xoá dùng lại được (her-53)
  if (existing) return res.status(409).json({ error: "Số điện thoại đã được đăng ký" });

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await User.create({ name, phone: phone.trim(), email, passwordHash, role: "customer" });

  const token = signToken(user);
  res.status(201).json({ token, user: user.toPublicJSON(), config: await publicConfig() });
}));

module.exports = router;
