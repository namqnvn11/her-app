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
  // her-25: tab "Lịch sử" — chỉ buổi ĐÃ KẾT THÚC (chốt 16/08: đang diễn ra vẫn là Hôm nay,
  // kết thúc xong mới nhảy vào Lịch sử). Sort giảm dần ở dưới: mới nhất trước.
  if (range === "past") return { endAt: { $lt: now } };
  return {}; // "all" — giữ cho tương thích
}

// GET /api/management/bookings?range=today|upcoming|past|all&search=<tên hoặc SĐT khách>&page=&limit=
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

  // her-10: hiện CẢ buổi đã điểm danh / đã tập trong khoảng lọc (điểm danh xong không
  // "biến mất" khỏi danh sách hôm nay); chỉ loại buổi đã hủy
  const query = { status: { $ne: "cancelled" }, ...rangeFilter(range) };

  if (req.user.role === "trainer") {
    if (!req.user.trainerId) return res.json({ bookings: [], hasMore: false });
    query.trainerId = req.user.trainerId;
  } else if (typeof req.query.mine === "string" && req.query.mine === "1" && req.user.trainerId) {
    // her-31: admin kiêm HLV xem "lịch của tôi" ở tab Lịch dạy — filter TỰ CHỌN,
    // không phải phân quyền (admin vẫn toàn quyền khi không truyền mine)
    query.trainerId = req.user.trainerId;
  }

  if (search.trim()) {
    // Escape ký tự đặc biệt để chuỗi tìm kiếm không bị hiểu là regex
    const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const rx = new RegExp(escaped, "i");
    // HLV không được dò SĐT khách qua search (16/08/2026) — ẩn field chưa đủ, phải chặn
    // cả kênh suy diễn "search=cụm số -> có kết quả nghĩa là SĐT chứa cụm đó"
    const searchFields = req.user.role === "trainer" ? [{ name: rx }] : [{ name: rx }, { phone: rx }];
    // Chỉ tìm trong khách hàng, giới hạn kết quả để search 1 ký tự không kéo cả DB
    const matched = await User.find({ role: "customer", $or: searchFields })
      .select("_id")
      .limit(200);
    query.userId = { $in: matched.map((u) => u._id) };
  }

  // Lấy dư 1 bản ghi để biết còn trang sau hay không
  const bookings = await Booking.find(query)
    // Lịch sử ("past"/"all") mới nhất trước — mở ra thấy ngay hôm qua, không phải "Tải thêm"
    // cả trăm dòng. _id làm khoá phụ: nhiều booking cùng lớp trùng startAt, sort thiếu
    // tiebreaker thì skip/limit giữa 2 trang không ổn định → trang sau lặp bản ghi trang
    // trước (review her-25)
    .sort(range === "all" || range === "past" ? { startAt: -1, _id: -1 } : { startAt: 1, _id: 1 })
    .skip((page - 1) * limit)
    .limit(limit + 1)
    .populate("userId", "name phone")
    .populate("trainerId", "name")
    // her-22: bộ môn của lớp — ô tìm màn Lịch tập lọc theo bộ môn kể cả lớp tên riêng
    .populate("classId", "serviceType");

  const hasMore = bookings.length > limit;
  if (hasMore) bookings.pop();

  // HLV không được xem SĐT khách (quyết định 16/08/2026) — chặn ở server, không chỉ ẩn trên app
  const canSeePhone = req.user.role !== "trainer";

  res.json({
    hasMore,
    bookings: bookings.map((b) => ({
      id: b._id,
      type: b.type,
      title: b.title,
      // classId đã populate — trả về ID như cũ, app đang gộp/so sánh theo ID
      classId: b.classId?._id ?? b.classId,
      slotId: b.slotId, // her-20: app gộp booking PT theo khung để điểm danh theo danh sách
      serviceType: b.type === "pt" ? "pt" : b.classId?.serviceType || null,
      coach: b.trainerId?.name || "",
      startAt: b.startAt,
      endAt: b.endAt,
      status: b.status,
      customer: {
        id: b.userId?._id,
        name: b.userId?.name || "(đã xoá)",
        ...(canSeePhone ? { phone: b.userId?.phone || "" } : {}),
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

// PATCH /api/management/bookings/:id/attendance { present: true|false } — điểm danh (mục 5).
// Đến -> completed; Vắng -> no_show; sửa lại được (tích nhầm). KHÔNG đụng buổi/gói (C2 —
// khách vắng vẫn mất buổi như đã trừ lúc đặt; H1 chỉ hoàn khi hủy đúng hạn).
// Quyền: lễ tân/admin mọi buổi; HLV chỉ buổi của chính mình (H5 — server).
// Mở từ ATTENDANCE_OPEN_BEFORE_MINUTES phút trước giờ bắt đầu (khách đến sớm — 30');
// buổi đã hủy không điểm danh.
const { ATTENDANCE_OPEN_BEFORE_MINUTES, TRAINER_ATTENDANCE_EDIT_HOURS } = require("../utils/attendanceRule");

router.patch("/bookings/:id/attendance", wrap(async (req, res) => {
  const { present } = req.body;
  // present: true = Đến, false = Vắng, null = BỎ điểm danh (quay về "đã đặt" — chỉ quầy,
  // dùng khi tích nhầm trước giờ; review her-10 #6)
  if (typeof present !== "boolean" && present !== null) {
    return res.status(400).json({ error: "Thiếu trạng thái điểm danh (present: true/false/null)" });
  }
  const booking = await Booking.findById(req.params.id);
  if (!booking) return res.status(404).json({ error: "Không tìm thấy lịch đặt" });

  if (req.user.role === "trainer") {
    if (!req.user.trainerId || req.user.trainerId.toString() !== booking.trainerId?.toString()) {
      return res.status(403).json({ error: "Bạn không phụ trách buổi này" });
    }
    if (present === null) {
      return res.status(403).json({ error: "Bỏ điểm danh chỉ quầy lễ tân/admin thao tác được" });
    }
    // Chống retro-mark ăn hoa hồng (her-10 #3; siết còn 24h — chốt 16/08, her-26):
    // HLV chỉ điểm danh/sửa trong TRAINER_ATTENDANCE_EDIT_HOURS giờ kể từ giờ bắt đầu
    // buổi; muộn hơn phải nhờ quầy. Quầy không giới hạn.
    const deadline = new Date(booking.startAt.getTime() + TRAINER_ATTENDANCE_EDIT_HOURS * 3600 * 1000);
    if (new Date() >= deadline) {
      return res.status(400).json({
        error: `Đã quá ${TRAINER_ATTENDANCE_EDIT_HOURS} giờ sau buổi — liên hệ quầy lễ tân để sửa điểm danh`,
      });
    }
  }
  if (booking.status === "cancelled") {
    return res.status(400).json({ error: "Buổi này đã hủy — không điểm danh được" });
  }
  const opensAt = new Date(booking.startAt.getTime() - ATTENDANCE_OPEN_BEFORE_MINUTES * 60 * 1000);
  if (new Date() < opensAt) {
    return res.status(400).json({ error: `Chưa tới giờ điểm danh — mở từ ${ATTENDANCE_OPEN_BEFORE_MINUTES} phút trước giờ bắt đầu` });
  }

  // Ghi ATOMIC có điều kiện (C3 — review her-10 #1): luồng hủy chạy song song vừa đổi sang
  // cancelled (đã hoàn buổi + trả chỗ) thì lệnh này thất bại, KHÔNG đè trạng thái.
  const $set = present === null
    ? { status: "booked", attendanceAt: null, attendanceBy: null }
    : { status: present ? "completed" : "no_show", attendanceAt: new Date(), attendanceBy: req.user._id };
  const updated = await Booking.findOneAndUpdate(
    { _id: booking._id, status: { $ne: "cancelled" } },
    { $set },
    { new: true }
  );
  if (!updated) {
    return res.status(400).json({ error: "Buổi này vừa bị hủy — không điểm danh được" });
  }
  res.json({
    booking: {
      id: updated._id,
      status: updated.status,
      attendanceAt: updated.attendanceAt,
    },
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

  const bookings = await Booking.find({
    classId: gymClass._id,
    status: { $in: ["booked", "completed", "no_show"] },
  })
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
    // HLV không được xem SĐT khách (quyết định 16/08/2026) — chỉ reception/admin thấy.
    // status + attendanceAt để app hiện nút điểm danh và trạng thái Đến/Vắng (her-10)
    customers: bookings.map((b) => ({
      bookingId: b._id,
      name: b.userId?.name || "(đã xoá)",
      status: b.status,
      attendanceAt: b.attendanceAt,
      ...(req.user.role !== "trainer" ? { phone: b.userId?.phone || "" } : {}),
    })),
  });
}));

// GET /api/management/pt-slots/:id/roster -- danh sách khách đã đặt 1 khung PT (her-20:
// quầy điểm danh theo danh sách của buổi thay vì từng dòng khách rời rạc).
// Quyền như roster lớp: reception/admin mọi khung; trainer chỉ khung của chính mình.
const PTSlot = require("../models/PTSlot");
const Trainer = require("../models/Trainer");
const { ptTitle } = require("../utils/serviceTypes");

router.get("/pt-slots/:id/roster", wrap(async (req, res) => {
  const slot = await PTSlot.findById(req.params.id);
  if (!slot) return res.status(404).json({ error: "Không tìm thấy khung giờ PT" });

  if (req.user.role === "trainer") {
    if (!req.user.trainerId || req.user.trainerId.toString() !== slot.trainerId?.toString()) {
      return res.status(403).json({ error: "Bạn không phụ trách khung giờ này" });
    }
  }

  const trainer = await Trainer.findById(slot.trainerId).select("name");
  const bookings = await Booking.find({
    slotId: slot._id,
    status: { $in: ["booked", "completed", "no_show"] },
  })
    .sort({ createdAt: 1 })
    .populate("userId", "name phone");

  res.json({
    slot: {
      id: slot._id,
      title: ptTitle(slot.capacity, trainer?.name || ""),
      coach: trainer?.name || "",
      startAt: slot.startAt,
      endAt: slot.endAt,
      capacity: slot.capacity,
      bookedCount: slot.bookedCount,
    },
    // HLV không được xem SĐT khách (quyết định 16/08/2026) — chặn ở server (B15)
    customers: bookings.map((b) => ({
      bookingId: b._id,
      name: b.userId?.name || "(đã xoá)",
      status: b.status,
      attendanceAt: b.attendanceAt,
      ...(req.user.role !== "trainer" ? { phone: b.userId?.phone || "" } : {}),
    })),
  });
}));

module.exports = router;
