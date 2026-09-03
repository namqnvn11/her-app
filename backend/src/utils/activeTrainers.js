const User = require("../models/User");

// HLV có tài khoản bị KHOÁ thì ẩn khỏi các danh sách đặt lịch / xếp lịch mới
// (quyết định 07/08/2026, L5 — không xoá tài khoản, chỉ khoá).
// HLV chưa được cấp tài khoản user (dữ liệu seed cũ) coi như đang hoạt động bình thường.
// Lưu ý: các lịch ĐÃ đặt với HLV bị khoá giữ nguyên — lễ tân thoả thuận hủy/đổi với khách.
// her-53: HLV bị XOÁ MỀM (deletedAt) cũng ẩn — xoá đã đặt isActive=false nhưng viết tường minh
// để không phụ thuộc chi tiết đó.
const LOCKED_OR_DELETED = { $or: [{ isActive: false }, { deletedAt: { $ne: null } }] };

function lockedTrainerIds() {
  return User.find({ role: "trainer", trainerId: { $ne: null }, ...LOCKED_OR_DELETED }).distinct("trainerId");
}

// Chốt chặn phía server cho 1 HLV cụ thể — ẩn danh sách KHÔNG phải là phân quyền (H5):
// khách/lễ tân có thể còn giữ classId/slotId tải trước lúc khoá, hoặc gọi thẳng API.
async function isTrainerLocked(trainerId) {
  if (!trainerId) return false;
  return !!(await User.exists({ role: "trainer", trainerId, ...LOCKED_OR_DELETED }));
}

// Chỉ HLV đã XOÁ mềm (không gồm HLV khoá) — bảng lương dùng để ẩn HLV tạo nhầm (her-53 D11)
function deletedTrainerIds() {
  return User.find({ role: "trainer", trainerId: { $ne: null }, deletedAt: { $ne: null } }).distinct("trainerId");
}

module.exports = { lockedTrainerIds, isTrainerLocked, deletedTrainerIds };
