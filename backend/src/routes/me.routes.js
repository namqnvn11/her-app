const express = require("express");
const User = require("../models/User");
const Trainer = require("../models/Trainer");
const Package = require("../models/Package");
const Booking = require("../models/Booking");
const { requireAuth } = require("../middleware/auth");
const { MIN_CANCEL_HOURS } = require("../utils/cancelRule");
const wrap = require("../utils/asyncHandler");

const router = express.Router();
router.use(requireAuth);

// GET /api/me — kèm config để app đồng bộ quy tắc với server (vd số giờ tự hủy)
router.get("/", (req, res) => {
  res.json({ user: req.user.toPublicJSON(), config: { minCancelHours: MIN_CANCEL_HOURS } });
});

// PATCH /api/me  { name?, avatarUrl? }  -- đổi số điện thoại nên xử lý riêng vì cần unique-check
router.patch("/", wrap(async (req, res) => {
  const { name, avatarUrl } = req.body;
  if (name !== undefined) req.user.name = name;
  if (avatarUrl !== undefined) req.user.avatarUrl = avatarUrl;
  await req.user.save();

  // HLV tự đổi tên -> đồng bộ hồ sơ Trainer (tên hiện ở lịch lớp, danh sách đặt PT)
  if (name !== undefined && req.user.role === "trainer" && req.user.trainerId) {
    await Trainer.updateOne({ _id: req.user.trainerId }, { $set: { name: req.user.name } });
  }

  res.json({ user: req.user.toPublicJSON() });
}));

// GET /api/me/package -- gói đang active gần nhất (chưa hết hạn)
router.get("/package", wrap(async (req, res) => {
  const pkg = await Package.findOne({ userId: req.user._id, expiresAt: { $gte: new Date() } }).sort({
    expiresAt: -1,
  });
  if (!pkg) return res.json({ package: null });
  res.json({
    package: {
      id: pkg._id,
      name: pkg.name,
      price: pkg.price,
      totalSessions: pkg.totalSessions,
      usedSessions: pkg.usedSessions,
      activatedAt: pkg.activatedAt,
      expiresAt: pkg.expiresAt,
    },
  });
}));

// GET /api/me/bookings -- lịch sắp tới VÀ đang diễn ra (status booked, chưa qua giờ KẾT THÚC —
// buổi 7:00-8:00 lúc 7:15 vẫn phải hiện ở đây, không "biến mất" trước khi sweep chạy)
router.get("/bookings", wrap(async (req, res) => {
  const bookings = await Booking.find({
    userId: req.user._id,
    status: "booked",
    endAt: { $gte: new Date() },
  })
    .sort({ startAt: 1 })
    .populate("trainerId", "name");
  res.json({ bookings: bookings.map(serializeBooking) });
}));

// GET /api/me/history -- đã tập/đã hủy hoặc đã qua giờ kết thúc
router.get("/history", wrap(async (req, res) => {
  const bookings = await Booking.find({
    userId: req.user._id,
    $or: [{ status: { $in: ["cancelled", "completed", "no_show"] } }, { endAt: { $lt: new Date() } }],
  })
    .sort({ startAt: -1 })
    .limit(50)
    .populate("trainerId", "name");
  res.json({ bookings: bookings.map(serializeBooking) });
}));

function serializeBooking(b) {
  return {
    id: b._id,
    type: b.type,
    title: b.title,
    coach: b.trainerId?.name || "",
    startAt: b.startAt,
    endAt: b.endAt,
    status: b.status,
  };
}

module.exports = router;
