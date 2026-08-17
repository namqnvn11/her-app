const express = require("express");
const GymClass = require("../models/GymClass");
const { requireAuth } = require("../middleware/auth");
const { lockedTrainerIds } = require("../utils/activeTrainers");
const wrap = require("../utils/asyncHandler");

const router = express.Router();
router.use(requireAuth);

// GET /api/classes -- các buổi group sắp tới còn mở đăng ký (7 ngày tới)
router.get("/", wrap(async (req, res) => {
  const from = new Date();
  const to = new Date(Date.now() + 7 * 24 * 3600 * 1000);
  // Ẩn cả lớp Group của HLV có tài khoản bị khoá (không chỉ khung PT)
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
      coach: c.coachId?.name || "",
      startAt: c.startAt,
      endAt: c.endAt,
      capacity: c.capacity,
      spotsLeft: Math.max(c.capacity - c.bookedCount, 0),
    })),
  });
}));

module.exports = router;
