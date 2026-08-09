// Chặn đoán mật khẩu: đếm số lần đăng nhập sai theo SĐT, lưu trong bộ nhớ.
// Đủ dùng khi chạy 1 instance (demo/phòng tập nhỏ); nếu chạy nhiều instance thì chuyển sang Redis.
// Lưu ý giới hạn đã chấp nhận: chỉ đếm theo SĐT (không theo IP) — người xấu cố tình nhập sai
// 5 lần có thể tạm khoá đăng nhập của một SĐT cụ thể trong 1 cửa sổ.
const attempts = new Map(); // phone -> { count, firstAt, blockedUntil }

// Đọc env mỗi lần gọi để test chỉnh được cửa sổ chặn mà không phải nạp lại module
function maxAttempts() {
  return Number(process.env.LOGIN_MAX_ATTEMPTS || 5);
}
function windowMs() {
  return Number(process.env.LOGIN_BLOCK_MINUTES || 15) * 60 * 1000;
}

function isExpired(entry, now) {
  return entry.blockedUntil ? now >= entry.blockedUntil : now - entry.firstAt > windowMs();
}

// Map chỉ được dọn lazily -> khi phình to thì quét bỏ các entry đã hết hạn
function sweepIfNeeded(now) {
  if (attempts.size < 1000) return;
  for (const [phone, entry] of attempts) {
    if (isExpired(entry, now)) attempts.delete(phone);
  }
}

// Trả về số phút còn bị chặn (0 = không bị chặn)
function blockedMinutes(phone) {
  const entry = attempts.get(phone);
  if (!entry) return 0;
  const now = Date.now();
  if (isExpired(entry, now)) {
    attempts.delete(phone);
    return 0;
  }
  if (!entry.blockedUntil) return 0;
  return Math.max(1, Math.ceil((entry.blockedUntil - now) / 60000));
}

function recordFailure(phone) {
  const now = Date.now();
  sweepIfNeeded(now);
  const entry = attempts.get(phone);
  if (!entry || isExpired(entry, now)) {
    attempts.set(phone, { count: 1, firstAt: now, blockedUntil: null });
    return;
  }
  entry.count += 1;
  // Đủ số lần sai -> chặn TRỌN một cửa sổ tính từ bây giờ (không phải từ lần sai đầu tiên,
  // nếu không thời gian chặn thực tế có thể chỉ còn vài giây)
  if (!entry.blockedUntil && entry.count >= maxAttempts()) {
    entry.blockedUntil = now + windowMs();
  }
}

function resetAttempts(phone) {
  attempts.delete(phone);
}

module.exports = { blockedMinutes, recordFailure, resetAttempts };
