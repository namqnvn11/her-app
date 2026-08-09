const User = require("../models/User");

// HLV có tài khoản bị KHOÁ thì ẩn khỏi các danh sách đặt lịch / xếp lịch mới
// (quyết định 07/08/2026, L5 — không xoá tài khoản, chỉ khoá).
// HLV chưa được cấp tài khoản user (dữ liệu seed cũ) coi như đang hoạt động bình thường.
// Lưu ý: các lịch ĐÃ đặt với HLV bị khoá giữ nguyên — lễ tân thoả thuận hủy/đổi với khách.
function lockedTrainerIds() {
  return User.find({ role: "trainer", isActive: false, trainerId: { $ne: null } }).distinct("trainerId");
}

// Chốt chặn phía server cho 1 HLV cụ thể — ẩn danh sách KHÔNG phải là phân quyền (H5):
// khách/lễ tân có thể còn giữ classId/slotId tải trước lúc khoá, hoặc gọi thẳng API.
async function isTrainerLocked(trainerId) {
  if (!trainerId) return false;
  return !!(await User.exists({ role: "trainer", isActive: false, trainerId }));
}

module.exports = { lockedTrainerIds, isTrainerLocked };
