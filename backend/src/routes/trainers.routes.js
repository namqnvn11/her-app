const express = require("express");
const Trainer = require("../models/Trainer");
const PTSlot = require("../models/PTSlot");
const { requireAuth } = require("../middleware/auth");
const { lockedTrainerIds } = require("../utils/activeTrainers");
const wrap = require("../utils/asyncHandler");

const router = express.Router();
router.use(requireAuth);

// GET /api/trainers -- danh sách HLV kèm khung giờ PT còn trống trong 7 ngày tới
router.get("/", wrap(async (req, res) => {
  const from = new Date();
  const to = new Date(Date.now() + 7 * 24 * 3600 * 1000);

  const trainers = await Trainer.find({ _id: { $nin: await lockedTrainerIds() } }).sort({ name: 1 });
  const slots = await PTSlot.find({
    isBooked: false,
    startAt: { $gte: from, $lte: to },
  }).sort({ startAt: 1 });

  const slotsByTrainer = {};
  for (const s of slots) {
    const key = s.trainerId.toString();
    (slotsByTrainer[key] = slotsByTrainer[key] || []).push({
      id: s._id,
      startAt: s.startAt,
      endAt: s.endAt,
    });
  }

  res.json({
    trainers: trainers.map((t) => ({
      id: t._id,
      name: t.name,
      specialty: t.specialty,
      rating: t.rating,
      slots: slotsByTrainer[t._id.toString()] || [],
    })),
  });
}));

module.exports = router;
