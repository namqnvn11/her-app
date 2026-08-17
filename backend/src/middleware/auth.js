const jwt = require("jsonwebtoken");
const User = require("../models/User");

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: "Thiếu token đăng nhập" });
  }
  // Tách 2 loại lỗi: token sai -> 401 (app xoá token, bắt đăng nhập lại là đúng);
  // DB lỗi -> chuyển error middleware trả 500 — nếu gộp chung 401 thì DB chập chờn
  // sẽ làm app đăng xuất oan hàng loạt người dùng.
  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: "Token không hợp lệ hoặc đã hết hạn" });
  }
  try {
    const user = await User.findById(payload.sub);
    if (!user) return res.status(401).json({ error: "Tài khoản không còn tồn tại" });
    if (user.isActive === false) return res.status(403).json({ error: "Tài khoản đã bị khoá" });
    // Token cấp trước lần đổi mật khẩu gần nhất -> hết hiệu lực (her-14 A2). iat tính bằng
    // GIÂY, trừ hao 2s lệch đồng hồ để phiên VỪA đổi mật khẩu tự đăng nhập lại không bị kẹt.
    if (user.passwordChangedAt && payload.iat * 1000 < user.passwordChangedAt.getTime() - 2000) {
      return res.status(401).json({ error: "Mật khẩu đã được thay đổi — vui lòng đăng nhập lại" });
    }
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Không có quyền truy cập" });
    }
    next();
  };
}

// Tầng "quản lý": lễ tân (reception) + admin — được xếp lịch HLV, tạo/quản trị tài khoản,
// hủy lịch khách không giới hạn giờ.
const requireManagement = requireRole("reception", "admin");

module.exports = { requireAuth, requireRole, requireManagement };
