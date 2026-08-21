const jwt = require("jsonwebtoken");

// her-45 (chốt 21/08): phiên đăng nhập 30 ngày + GIA HẠN TRƯỢT.
// Hạn tính từ LẦN MỞ APP gần nhất, không phải từ lần đăng nhập: mỗi lần app gọi GET /me
// (đúng lúc mở app), token nào đã cũ hơn RENEW_AFTER_MS thì server cấp token mới.
// -> dùng app đều đặn thì không bao giờ bị đá ra; bỏ app quá 30 ngày mới phải đăng nhập lại.
//
// C5: hạn phiên chỉ có MỘT nguồn là biến môi trường JWT_EXPIRES_IN, không ghi cứng chỗ nào khác.
const EXPIRES_IN = process.env.JWT_EXPIRES_IN || "30d";

// Ngưỡng gia hạn: token cũ hơn 1 ngày mới cấp lại. Mở app nhiều lần trong cùng ngày thì
// không ký lại + không bắt máy ghi lại bộ nhớ mỗi lần cho tốn công.
const RENEW_AFTER_MS = 24 * 3600 * 1000;

function signToken(user) {
  return jwt.sign({ sub: user._id.toString(), role: user.role }, process.env.JWT_SECRET, {
    expiresIn: EXPIRES_IN,
  });
}

// Token còn hạn nhưng đã cũ -> trả token MỚI để app lưu đè. Còn mới thì trả null (app giữ nguyên).
// Lưu ý: token cũ KHÔNG chết ngay khi có token mới — JWT không thu hồi được, nó sống hết hạn
// của chính nó. Muốn cắt phiên ngay thì khoá tài khoản hoặc đổi mật khẩu (middleware chặn cả 2).
function renewedToken(user, payload) {
  if (!payload || !payload.iat) return null;
  if (Date.now() - payload.iat * 1000 < RENEW_AFTER_MS) return null;
  return signToken(user);
}

module.exports = { signToken, renewedToken, EXPIRES_IN, RENEW_AFTER_MS };
