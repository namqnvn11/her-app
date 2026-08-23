const express = require("express");
const Setting = require("../models/Setting");
const { requireAuth, requireRole } = require("../middleware/auth");
const { getMinCancelHours, setCachedMinCancelHours, MAX_CANCEL_HOURS } = require("../utils/cancelRule");
const wrap = require("../utils/asyncHandler");

// her-47: cài đặt phòng tập — CHỈ admin (H5). Khách/lễ tân vẫn nhận giá trị hiện hành qua
// `config` ở /auth/login và /me, không cần gọi đây.
const router = express.Router();
router.use(requireAuth, requireRole("admin"));

// GET /api/settings
router.get("/", wrap(async (req, res) => {
  res.json({ minCancelHours: await getMinCancelHours() });
}));

// PATCH /api/settings  { minCancelHours }  — số NGUYÊN 0..72; 0 = khách hủy được tới sát giờ tập
router.patch("/", wrap(async (req, res) => {
  const { minCancelHours } = req.body || {};
  if (!Number.isInteger(minCancelHours) || minCancelHours < 0 || minCancelHours > MAX_CANCEL_HOURS) {
    return res.status(400).json({ error: `Số giờ hủy tối thiểu phải là số nguyên từ 0 đến ${MAX_CANCEL_HOURS}` });
  }
  const doc = await Setting.findOneAndUpdate(
    { key: "studio" },
    { $set: { minCancelHours } },
    { upsert: true, new: true, runValidators: true }
  );
  setCachedMinCancelHours(doc.minCancelHours); // hiệu lực ngay trên instance này
  res.json({ minCancelHours: doc.minCancelHours });
}));

module.exports = router;
