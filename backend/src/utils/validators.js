// Kiểm tra định dạng đầu vào khi tạo tài khoản / đăng ký.
// SĐT Việt Nam: 10 chữ số, bắt đầu bằng 0 (khớp với dữ liệu seed và cách lễ tân nhập).
// Bắt buộc là string thật — mảng/số/object bị từ chối ngay (tránh .trim() nổ 500 ở nơi gọi)
function isValidPhone(phone) {
  return typeof phone === "string" && /^0\d{9}$/.test(phone.trim());
}

// Mật khẩu tối thiểu 6 ký tự (mức tối thiểu cho demo; siết thêm khi lên production).
const MIN_PASSWORD_LENGTH = 6;
function isValidPassword(password) {
  return typeof password === "string" && password.length >= MIN_PASSWORD_LENGTH;
}

module.exports = { isValidPhone, isValidPassword, MIN_PASSWORD_LENGTH };
