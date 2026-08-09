const express = require("express");
const Booking = require("../models/Booking");
const GymClass = require("../models/GymClass");
const User = require("../models/User");
const { requireAuth, requireRole } = require("../middleware/auth");
const wrap = require("../utils/asyncHandler");

const router = express.Router();
// reception + admin: xem/hủy lịch của mọi khách, không giới hạn giờ.
// trainer: chỉ xem lịch của chính mình (đọc, không hủy hộ khách).
router.use(requireAuth, requireRole("reception", "admin", "trainer"));

// "Hôm nay" tính theo giờ Việt Nam bất kể server chạy múi giờ nào (deploy Render/host UTC
// mà dùng setHours(0,0,0,0) sẽ lệch 7 tiếng). Đổi múi giờ bằng env TZ_OFFSET_MINUTES.
const TZ_OFFSET_MINUTES = Number(process.env.TZ_OFFSET_MINUTES ?? 420); // +7:00

function rangeFilter(range) {
  const now = new Date();
  if (range === "today") {
    const local = new Date(now.getTime() + TZ_OFFSET_MINUTES * 60000);
    const startOfDayUtc =
      Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) -
      TZ_OFFSET_MINUTES * 60000;
    return { startAt: { $gte: new Date(startOfDayUtc), $lt: new Date(startOfDayUtc + 24 * 3600 * 1000) } };
  }
  if (range === "upcoming") return { startAt: { $gte: now } };
  return {}; // "all"
}

// GET /api/management/bookings?range=today|upcoming|all&search=<tên hoặc SĐT khách>&page=&limit=
// - reception/admin: thấy lịch của TẤT CẢ khách hàng.
// - trainer: chỉ thấy lịch của chính mình (theo trainerId gắn với tài khoản).
// Tìm kiếm chạy bằng query DB (không tải hết về lọc JS) và có phân trang để không chậm dần
// khi dữ liệu lớn. Response thêm `hasMore` — client cũ không dùng cũng không sao.
router.get("/bookings", wrap(async (req, res) => {
  const { range = "upcoming" } = req.query;
  // Query string có thể bị gửi lặp (?search=a&search=b thành array) — chỉ nhận string
  const search = typeof req.query.search === "string" ? req.query.search : "";
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 100));

  const query = { status: "booked", ...rangeFilter(range) };

  if (req.user.role === "trainer") {
    if (!req.user.trainerId) return res.json({ bookings: [], hasMore: false });
    query.trainerId = req.user.trainerId;
  }

  if (search.trim()) {
    // Escape ký tự đặc biệt để chuỗi tìm kiếm không bị hiểu là regex
    const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const rx = new RegExp(escaped, "i");
    // Chỉ tìm trong khách hàng, giới hạn kết quả để search 1 ký tự không kéo cả DB
    const matched = await User.find({ role: "customer", $or: [{ name: rx }, { phone: rx }] })
      .select("_id")
      .limit(200);
    query.userId = { $in: matched.map((u) => u._id) };
  }

  // Lấy dư 1 bản ghi để biết còn trang sau hay không
  const bookings = await Booking.find(query)
    .sort({ startAt: 1 })
    .skip((page - 1) * limit)
    .limit(limit + 1)
    .populate("userId", "name phone")
    .populate("trainerId", "name");

  const hasMore = bookings.length > limit;
  if (hasMore) bookings.pop();

  res.json({
    hasMore,
    bookings: bookings.map((b) => ({
      id: b._id,
      type: b.type,
      title: b.title,
      classId: b.classId,
      coach: b.trainerId?.name || "",
      startAt: b.startAt,
      endAt: b.endAt,
      status: b.status,
      customer: {
        id: b.userId?._id,
        name: b.userId?.name || "(đã xoá)",
        phone: b.userId?.phone || "",
      },
    })),
  });
}));

// GET /api/management/customers/:id/bookings -- toàn bộ lịch của 1 khách cụ thể (reception/admin)
router.get("/customers/:id/bookings", requireRole("reception", "admin"), wrap(async (req, res) => {
  const customer = await User.findOne({ _id: req.params.id, role: "customer" });
  if (!customer) return res.status(404).json({ error: "Không tìm thấy khách hàng" });

  const bookings = await Booking.find({ userId: customer._id })
    .sort({ startAt: -1 })
    .populate("trainerId", "name");

  res.json({
    customer: { id: customer._id, name: customer.name, phone: customer.phone },
    bookings: bookings.map((b) => ({
      id: b._id,
      type: b.type,
      title: b.title,
      coach: b.trainerId?.name || "",
      startAt: b.startAt,
      endAt: b.endAt,
      status: b.status,
    })),
  });
}));

// GET /api/management/classes/:id/roster -- danh sách tên khách đã đặt 1 khung giờ Group cụ thể
// (yêu cầu: hiển thị tên khách hàng đã đặt lịch trên khung giờ group).
// reception/admin xem mọi lớp; trainer chỉ xem lớp do chính mình phụ trách.
router.get("/classes/:id/roster", wrap(async (req, res) => {
  const gymClass = await GymClass.findById(req.params.id).populate("coachId", "name");
  if (!gymClass) return res.status(404).json({ error: "Không tìm thấy lớp học" });

  if (req.user.role === "trainer") {
    if (!req.user.trainerId || req.user.trainerId.toString() !== gymClass.coachId?._id?.toString()) {
      return res.status(403).json({ error: "Bạn không phụ trách lớp này" });
    }
  }

  const bookings = await Booking.find({ classId: gymClass._id, status: "booked" })
    .sort({ createdAt: 1 })
    .populate("userId", "name phone");

  res.json({
    class: {
      id: gymClass._id,
      name: gymClass.name,
      coach: gymClass.coachId?.name || "",
      startAt: gymClass.startAt,
      endAt: gymClass.endAt,
      capacity: gymClass.capacity,
      spotsLeft: Math.max(gymClass.capacity - gymClass.bookedCount, 0),
    },
    customers: bookings.map((b) => ({
      bookingId: b._id,
      name: b.userId?.name || "(đã xoá)",
      phone: b.userId?.phone || "",
    })),
  });
}));

module.exports = router;
