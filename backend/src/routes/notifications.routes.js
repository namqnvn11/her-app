const express = require("express");
const mongoose = require("mongoose");
const Notification = require("../models/Notification");
const { requireAuth, requireRole } = require("../middleware/auth");
const wrap = require("../utils/asyncHandler");

const router = express.Router();
// her-57: chuông thông báo cho 3 vai trò nội bộ (chủ dự án chốt 03/09). Khách 403 —
// khách không có thông báo loại này (nhắc lịch của khách là local trên máy, her-16).
router.use(requireAuth, requireRole("admin", "reception", "trainer"));

const serialize = (n) => ({
  id: n._id,
  type: n.type,
  title: n.title,
  body: n.body,
  data: n.data || {},
  readAt: n.readAt,
  createdAt: n.createdAt,
});

// GET /api/notifications?page=&limit= — của TÔI, mới nhất trước; kèm số chưa đọc
router.get("/", wrap(async (req, res) => {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 30, 1), 100);
  const [items, unread] = await Promise.all([
    Notification.find({ userId: req.user._id }).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit + 1),
    Notification.countDocuments({ userId: req.user._id, readAt: null }),
  ]);
  const hasMore = items.length > limit;
  if (hasMore) items.pop();
  res.json({ notifications: items.map(serialize), hasMore, unread });
}));

// GET /api/notifications/unread-count — cho chấm đỏ trên chuông (gọi nhẹ, thường xuyên)
router.get("/unread-count", wrap(async (req, res) => {
  const unread = await Notification.countDocuments({ userId: req.user._id, readAt: null });
  res.json({ unread });
}));

// PATCH /api/notifications/read-all — mở danh sách = đã xem hết
// body.before (tuỳ chọn, ISO): chỉ đánh dấu tới thông báo mới nhất app ĐÃ hiển thị — cái tới xen giữa
// lúc tải và lúc đánh dấu vẫn còn "mới" (review #10)
router.patch("/read-all", wrap(async (req, res) => {
  const filter = { userId: req.user._id, readAt: null };
  const before = req.body && req.body.before ? new Date(req.body.before) : null;
  if (before && !isNaN(before.getTime())) filter.createdAt = { $lte: before };
  const r = await Notification.updateMany(filter, { $set: { readAt: new Date() } });
  res.json({ ok: true, updated: r.modifiedCount });
}));

// PATCH /api/notifications/:id/read — đánh dấu 1 cái (chỉ của mình; của người khác -> 404, không lộ)
router.patch("/:id/read", wrap(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: "Mã (ID) không hợp lệ" });
  const n = await Notification.findOneAndUpdate(
    { _id: req.params.id, userId: req.user._id },
    { $set: { readAt: new Date() } },
    { new: true }
  );
  if (!n) return res.status(404).json({ error: "Không tìm thấy thông báo" });
  res.json({ notification: serialize(n) });
}));

module.exports = router;
