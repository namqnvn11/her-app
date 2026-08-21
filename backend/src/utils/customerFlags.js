const Package = require("../models/Package");
const User = require("../models/User");

// her-43: khối "Cần xử lý" ở màn Tổng quan của lễ tân nay BẤM ĐƯỢC — dẫn sang tab Tài khoản
// lọc sẵn đúng nhóm khách. Con số trên dashboard và danh sách khách phải là MỘT NGUỒN,
// nên cả 2 nơi (dashboard.js, accounts.routes.js) dùng chung 2 hàm dưới, không ai tự query lại.
// Lệch số giữa "3 khách còn nợ" và danh sách mở ra là mất tin cậy cả màn.

const EXPIRING_DAYS = 7;

// Khách CÒN NỢ tiền gói. Bỏ tài khoản đã KHOÁ (review V4: khách khoá không giao dịch nữa).
// Trả kèm tổng nợ từng khách để danh sách ghi rõ "nợ 400.000".
async function debtCustomers() {
  const pkgs = await Package.find({
    paidAmount: { $ne: null },
    $expr: { $lt: ["$paidAmount", "$price"] },
  }).select("userId price paidAmount");
  const owed = new Map();
  for (const p of pkgs) {
    const id = p.userId.toString();
    owed.set(id, (owed.get(id) || 0) + (p.price - p.paidAmount));
  }
  const active = await User.find({ _id: { $in: [...owed.keys()] }, isActive: true }).select("_id");
  const ids = active.map((u) => u._id.toString());
  return { ids, amountByUser: Object.fromEntries(ids.map((id) => [id, owed.get(id)])) };
}

// Gói SẮP HẾT HẠN trong EXPIRING_DAYS ngày: bỏ gói bảo lưu, gói ĐÃ HẾT BUỔI, và khách bị khoá (V4).
// packageCount = số GÓI (con số dashboard hiển thị); ids = số KHÁCH (có thể ít hơn nếu 1 khách 2 gói).
async function expiringPackages(now = new Date()) {
  const soonEnd = new Date(now.getTime() + EXPIRING_DAYS * 24 * 3600 * 1000);
  const pkgs = await Package.find({
    pausedAt: null,
    expiresAt: { $gte: now, $lte: soonEnd },
    $or: [{ totalSessions: null }, { $expr: { $lt: ["$usedSessions", "$totalSessions"] } }],
  }).select("userId expiresAt");
  const owners = [...new Set(pkgs.map((p) => p.userId.toString()))];
  const activeSet = new Set(
    (await User.find({ _id: { $in: owners }, isActive: true }).select("_id")).map((u) => u._id.toString())
  );
  const rows = pkgs.filter((p) => activeSet.has(p.userId.toString()));
  // Khách có 2 gói sắp hết thì lấy hạn GẦN NHẤT để danh sách xếp/ghi đúng cái cần gọi trước
  const soonestByUser = {};
  for (const p of rows) {
    const id = p.userId.toString();
    if (!soonestByUser[id] || p.expiresAt < soonestByUser[id]) soonestByUser[id] = p.expiresAt;
  }
  return { ids: Object.keys(soonestByUser), packageCount: rows.length, soonestByUser };
}

module.exports = { debtCustomers, expiringPackages, EXPIRING_DAYS };
