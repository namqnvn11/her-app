const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { allDisciplines } = require("../utils/disciplines");
const wrap = require("../utils/asyncHandler");

const router = express.Router();
router.use(requireAuth);

// GET /api/disciplines — danh mục bộ môn (her-19): mọi form "chọn bộ môn" của app lấy từ đây.
// Thêm môn mới = thêm document vào collection `disciplines` (hiện chưa cần màn quản trị riêng).
router.get("/", wrap(async (req, res) => {
  const list = await allDisciplines();
  res.json({ disciplines: list.map((d) => ({ key: d.key, label: d.label })) });
}));

module.exports = router;
