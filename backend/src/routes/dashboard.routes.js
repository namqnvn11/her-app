const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { adminDashboard, receptionDashboard, trainerDashboard } = require("../utils/dashboard");
const { monthRange } = require("../utils/payroll");
const wrap = require("../utils/asyncHandler");

const router = express.Router();
router.use(requireAuth);

// GET /api/dashboard — số liệu màn Tổng quan, trả theo ROLE của token (mục 8, H5):
// admin = báo cáo thu–chi tháng; lễ tân = vận hành hôm nay (không doanh thu/lương);
// HLV = lịch dạy của chính mình. Khách không có màn này -> 403.
router.get("/", wrap(async (req, res) => {
  const role = req.user.role;
  if (role === "admin") {
    // her-18: admin lọc báo cáo theo THÁNG (?month=YYYY-MM); bỏ trống = tháng hiện tại
    const { month } = req.query;
    if (month !== undefined) {
      const range = monthRange(month);
      if (!range) return res.status(400).json({ error: "Tháng không hợp lệ — dùng dạng YYYY-MM (vd 2026-08)" });
      if (range.from > new Date()) return res.status(400).json({ error: "Tháng này chưa tới — chưa có số liệu" });
      return res.json(await adminDashboard(month));
    }
    return res.json(await adminDashboard());
  }
  if (role === "reception") return res.json(await receptionDashboard());
  if (role === "trainer") {
    if (!req.user.trainerId) return res.status(400).json({ error: "Tài khoản HLV chưa gắn hồ sơ — liên hệ admin" });
    return res.json(await trainerDashboard(req.user.trainerId));
  }
  return res.status(403).json({ error: "Không có quyền truy cập" });
}));

module.exports = router;
