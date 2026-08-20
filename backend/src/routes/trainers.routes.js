const express = require("express");
const Trainer = require("../models/Trainer");
const { requireAuth } = require("../middleware/auth");
const { lockedTrainerIds } = require("../utils/activeTrainers");
const wrap = require("../utils/asyncHandler");

const router = express.Router();
router.use(requireAuth);

// GET /api/trainers -- danh sách HLV (dùng cho filter theo HLV ở màn đặt lịch của học viên).
// her-35: mọi buổi tập đều là lớp -> khách xem/đặt buổi ở /api/classes, đây chỉ còn danh sách
// HLV để lọc. HLV bị khoá tài khoản không hiện (H6).
router.get("/", wrap(async (req, res) => {
  const trainers = await Trainer.find({ _id: { $nin: await lockedTrainerIds() } }).sort({ name: 1 });

  res.json({
    trainers: trainers.map((t) => ({
      id: t._id,
      name: t.name,
      specialty: t.specialty,
      specialties: t.specialties || [],
      rating: t.rating,
    })),
  });
}));

module.exports = router;
