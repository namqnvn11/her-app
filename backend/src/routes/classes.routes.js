const express = require("express");
const GymClass = require("../models/GymClass");
const { requireAuth } = require("../middleware/auth");
const { lockedTrainerIds } = require("../utils/activeTrainers");
const wrap = require("../utils/asyncHandler");

const router = express.Router();
router.use(requireAuth);

// GET /api/classes -- các buổi sắp tới còn mở đăng ký (7 ngày tới).
// her-35: mọi buổi đều là lớp, kèm loại hình 1:1 / 1:2 / 1:4 / 1:8.
router.get("/", wrap(async (req, res) => {
  const from = new Date();
  const to = new Date(Date.now() + 7 * 24 * 3600 * 1000);
  // Ẩn lớp của HLV có tài khoản bị khoá (H6)
  const classes = await GymClass.find({
    startAt: { $gte: from, $lte: to },
    coachId: { $nin: await lockedTrainerIds() },
  })
    .sort({ startAt: 1 })
    .populate("coachId", "name");

  res.json({
    classes: classes.map((c) => ({
      id: c._id,
      name: c.name,
      serviceType: c.serviceType,
      format: c.format, // her-35: loại hình buổi (1:1 / 1:2 / 1:4 / 1:8)
      coach: c.coachId?.name || "",
      startAt: c.startAt,
      endAt: c.endAt,
      capacity: c.capacity,
      spotsLeft: Math.max(c.capacity - c.bookedCount, 0),
    })),
  });
}));

module.exports = router;
