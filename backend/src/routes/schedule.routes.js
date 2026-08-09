const express = require("express");
const mongoose = require("mongoose");
const GymClass = require("../models/GymClass");
const PTSlot = require("../models/PTSlot");
const Trainer = require("../models/Trainer");
const Booking = require("../models/Booking");
const { requireAuth, requireManagement } = require("../middleware/auth");
const { lockedTrainerIds, isTrainerLocked } = require("../utils/activeTrainers");
const wrap = require("../utils/asyncHandler");

const router = express.Router();
// Giao diện "sắp xếp lịch HLV" — chỉ lễ tân (reception) và admin được xếp khung giờ.
router.use(requireAuth, requireManagement);

// Kiểm tra khoảng thời gian khi tạo khung giờ mới — chặn cả trường hợp gọi thẳng API
// (app đã chặn ở form, nhưng quy tắc phải nằm ở server). Trả về message lỗi hoặc null.
function validateTimeRange(startAt, endAt) {
  const start = new Date(startAt);
  const end = new Date(endAt);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return "Ngày giờ không hợp lệ";
  if (end <= start) return "Giờ kết thúc phải sau giờ bắt đầu";
  if (start < new Date()) return "Không thể tạo khung giờ trong quá khứ";
  return null;
}

// Sức chứa lớp: số nguyên 1..100 (undefined = dùng mặc định) — chặn giá trị âm/0/chữ
function validateCapacity(capacity) {
  if (capacity === undefined) return null;
  const cap = Number(capacity);
  if (!Number.isInteger(cap) || cap < 1 || cap > 100) return "Sức chứa phải là số nguyên từ 1 đến 100";
  return null;
}

// Filter ?from=&to= trên các route GET: giá trị không parse được thì dùng mặc định
function parseDateOr(value, fallback) {
  if (!value) return fallback;
  const d = new Date(value);
  return isNaN(d.getTime()) ? fallback : d;
}

// Bất biến cốt lõi của xếp lịch: MỘT HLV không thể dạy 2 nơi cùng lúc.
// Kiểm tra khung giờ mới có giao với lớp Group hoặc PT slot nào của HLV đó không.
// (Pre-check — thao tác chỉ của lễ tân/admin, tần suất thấp, race gần như không xảy ra.)
async function trainerOverlapError(trainerId, startAt, endAt, { excludeClassId } = {}) {
  const start = new Date(startAt);
  const end = new Date(endAt);
  const classQuery = { coachId: trainerId, startAt: { $lt: end }, endAt: { $gt: start } };
  if (excludeClassId) classQuery._id = { $ne: excludeClassId };
  const cls = await GymClass.findOne(classQuery);
  if (cls) return `HLV đã có lớp "${cls.name}" trùng giờ này`;
  const slot = await PTSlot.findOne({ trainerId, startAt: { $lt: end }, endAt: { $gt: start } });
  if (slot) return "HLV đã có khung PT 1:1 trùng giờ này";
  return null;
}

// GET /api/schedule/trainers -- danh sách HLV để chọn khi xếp lịch (ẩn HLV có tài khoản bị khoá)
router.get("/trainers", wrap(async (req, res) => {
  const trainers = await Trainer.find({ _id: { $nin: await lockedTrainerIds() } }).sort({ name: 1 });
  res.json({ trainers: trainers.map((t) => ({ id: t._id, name: t.name, specialty: t.specialty })) });
}));

// GET /api/schedule/classes?from=&to= -- lịch Group đã xếp, kèm sẵn tên khách đã đặt từng khung giờ
router.get("/classes", wrap(async (req, res) => {
  const from = parseDateOr(req.query.from, new Date());
  const to = parseDateOr(req.query.to, new Date(Date.now() + 7 * 24 * 3600 * 1000));

  const classes = await GymClass.find({ startAt: { $gte: from, $lte: to } })
    .sort({ startAt: 1 })
    .populate("coachId", "name");

  const bookings = await Booking.find({
    classId: { $in: classes.map((c) => c._id) },
    status: "booked",
  }).populate("userId", "name phone");

  const namesByClass = {};
  for (const b of bookings) {
    const key = b.classId.toString();
    (namesByClass[key] = namesByClass[key] || []).push(b.userId?.name || "(đã xoá)");
  }

  res.json({
    classes: classes.map((c) => ({
      id: c._id,
      name: c.name,
      coachId: c.coachId?._id,
      coach: c.coachId?.name || "",
      startAt: c.startAt,
      endAt: c.endAt,
      capacity: c.capacity,
      spotsLeft: Math.max(c.capacity - c.bookedCount, 0),
      customerNames: namesByClass[c._id.toString()] || [],
    })),
  });
}));

// POST /api/schedule/classes -- tạo 1 khung giờ Group mới
router.post("/classes", wrap(async (req, res) => {
  const { name, coachId, startAt, endAt, capacity } = req.body;
  if (!name || !coachId || !startAt || !endAt) {
    return res.status(400).json({ error: "Thiếu thông tin bắt buộc" });
  }
  const timeError = validateTimeRange(startAt, endAt);
  if (timeError) return res.status(400).json({ error: timeError });
  const capError = validateCapacity(capacity);
  if (capError) return res.status(400).json({ error: capError });

  const coach = await Trainer.findById(coachId);
  if (!coach) return res.status(404).json({ error: "Không tìm thấy HLV" });
  if (await isTrainerLocked(coach._id)) {
    return res.status(400).json({ error: "HLV này đang bị khoá tài khoản, không thể xếp lịch mới" });
  }
  const overlap = await trainerOverlapError(coach._id, startAt, endAt);
  if (overlap) return res.status(400).json({ error: overlap });

  const gymClass = await GymClass.create({
    name,
    coachId,
    startAt: new Date(startAt),
    endAt: new Date(endAt),
    capacity: capacity || 8,
  });
  res.status(201).json({ class: gymClass });
}));

// PATCH /api/schedule/classes/:id -- sửa khung giờ / đổi HLV / sức chứa
// Áp cùng bộ kiểm tra như khi tạo mới — không để flow "tạo hợp lệ rồi sửa" lách qua quy tắc.
router.patch("/classes/:id", wrap(async (req, res) => {
  const gymClass = await GymClass.findById(req.params.id);
  if (!gymClass) return res.status(404).json({ error: "Không tìm thấy lớp học" });

  const { name, coachId, startAt, endAt, capacity } = req.body;

  // Quyết định 07/08/2026 (L7): lớp ĐÃ CÓ KHÁCH ĐẶT thì không cho đổi giờ/HLV/tên —
  // lịch của khách là snapshot, đổi sẽ làm khách đến sai giờ/gặp sai người mà không được báo.
  // Muốn đổi: lễ tân thoả thuận với khách, hủy lịch hộ (khách được hoàn buổi) rồi mới sửa.
  // Ngoại lệ: TĂNG sức chứa vẫn cho phép (không đổi thông tin khách đã thấy).
  const changesCustomerFacing =
    startAt !== undefined || endAt !== undefined || coachId !== undefined || name !== undefined;
  if (gymClass.bookedCount > 0 && changesCustomerFacing) {
    return res.status(400).json({
      error: `Lớp đã có ${gymClass.bookedCount} khách đặt — không thể đổi giờ/HLV/tên. Hãy hủy lịch cho khách trước rồi mới sửa.`,
    });
  }

  const newStart = startAt !== undefined ? new Date(startAt) : gymClass.startAt;
  const newEnd = endAt !== undefined ? new Date(endAt) : gymClass.endAt;
  if (isNaN(newStart.getTime()) || isNaN(newEnd.getTime())) {
    return res.status(400).json({ error: "Ngày giờ không hợp lệ" });
  }
  if (newEnd <= newStart) return res.status(400).json({ error: "Giờ kết thúc phải sau giờ bắt đầu" });
  // Chỉ chặn khi thật sự DỜI giờ bắt đầu về quá khứ — sửa mỗi endAt của lớp đang diễn ra vẫn được
  if (startAt !== undefined && newStart < new Date()) {
    return res.status(400).json({ error: "Không thể dời khung giờ về quá khứ" });
  }

  const capError = validateCapacity(capacity);
  if (capError) return res.status(400).json({ error: capError });
  if (capacity !== undefined && Number(capacity) < gymClass.bookedCount) {
    return res.status(400).json({ error: `Sức chứa không thể nhỏ hơn số khách đã đặt (${gymClass.bookedCount})` });
  }

  if (coachId !== undefined) {
    const coach = mongoose.isValidObjectId(coachId) ? await Trainer.findById(coachId) : null;
    if (!coach) return res.status(404).json({ error: "Không tìm thấy HLV" });
    if (await isTrainerLocked(coach._id)) {
      return res.status(400).json({ error: "HLV này đang bị khoá tài khoản, không thể nhận lớp" });
    }
  }

  // Đổi giờ/đổi HLV thì khung giờ mới không được đè lên lịch khác của HLV đó
  if (startAt !== undefined || endAt !== undefined || coachId !== undefined) {
    const targetCoach = coachId !== undefined ? coachId : gymClass.coachId;
    const overlap = await trainerOverlapError(targetCoach, newStart, newEnd, { excludeClassId: gymClass._id });
    if (overlap) return res.status(400).json({ error: overlap });
  }

  // Ghi atomic — điều kiện chống race khách đặt thêm ĐÚNG GIỮA lúc lễ tân bấm lưu:
  // - đổi giờ/HLV/tên: lớp phải vẫn 0 khách tại thời điểm ghi (không chỉ lúc đọc ở trên)
  // - đổi capacity: số khách hiện tại vẫn <= capacity mới
  const condition = { _id: gymClass._id };
  if (changesCustomerFacing) condition.bookedCount = 0;
  else if (capacity !== undefined) condition.bookedCount = { $lte: Number(capacity) };
  const $set = { startAt: newStart, endAt: newEnd };
  if (name !== undefined) $set.name = name;
  if (coachId !== undefined) $set.coachId = coachId;
  if (capacity !== undefined) $set.capacity = Number(capacity);

  const updated = await GymClass.findOneAndUpdate(condition, { $set }, { new: true });
  if (!updated) {
    return res.status(400).json({
      error: changesCustomerFacing
        ? "Vừa có khách đặt lớp này — không thể đổi giờ/HLV/tên nữa. Hãy hủy lịch cho khách trước."
        : "Vừa có thêm khách đặt — sức chứa mới nhỏ hơn số khách hiện tại",
    });
  }
  res.json({ class: updated });
}));

// DELETE /api/schedule/classes/:id -- xoá khung giờ (chỉ khi chưa có khách đặt)
// Xoá atomic với điều kiện bookedCount=0 — chặn race "khách bấm đặt đúng lúc lễ tân đang xoá"
router.delete("/classes/:id", wrap(async (req, res) => {
  const deleted = await GymClass.findOneAndDelete({ _id: req.params.id, bookedCount: 0 });
  if (deleted) return res.json({ ok: true });
  const exists = await GymClass.findById(req.params.id);
  if (!exists) return res.status(404).json({ error: "Không tìm thấy lớp học" });
  res.status(400).json({ error: "Lớp đã có khách đặt, không thể xoá. Hãy liên hệ khách trước." });
}));

// GET /api/schedule/pt-slots?from=&to= -- khung giờ 1:1 đã xếp cho các HLV
router.get("/pt-slots", wrap(async (req, res) => {
  const from = parseDateOr(req.query.from, new Date());
  const to = parseDateOr(req.query.to, new Date(Date.now() + 7 * 24 * 3600 * 1000));

  const slots = await PTSlot.find({ startAt: { $gte: from, $lte: to } })
    .sort({ startAt: 1 })
    .populate("trainerId", "name");

  res.json({
    slots: slots.map((s) => ({
      id: s._id,
      trainerId: s.trainerId?._id,
      trainer: s.trainerId?.name || "",
      startAt: s.startAt,
      endAt: s.endAt,
      isBooked: s.isBooked,
    })),
  });
}));

// POST /api/schedule/pt-slots -- tạo 1 khung giờ PT 1:1 cho 1 HLV
router.post("/pt-slots", wrap(async (req, res) => {
  const { trainerId, startAt, endAt } = req.body;
  if (!trainerId || !startAt || !endAt) {
    return res.status(400).json({ error: "Thiếu thông tin bắt buộc" });
  }
  const timeError = validateTimeRange(startAt, endAt);
  if (timeError) return res.status(400).json({ error: timeError });

  const trainer = await Trainer.findById(trainerId);
  if (!trainer) return res.status(404).json({ error: "Không tìm thấy HLV" });
  if (await isTrainerLocked(trainer._id)) {
    return res.status(400).json({ error: "HLV này đang bị khoá tài khoản, không thể xếp lịch mới" });
  }
  const overlap = await trainerOverlapError(trainer._id, startAt, endAt);
  if (overlap) return res.status(400).json({ error: overlap });

  const slot = await PTSlot.create({ trainerId, startAt: new Date(startAt), endAt: new Date(endAt) });
  res.status(201).json({ slot });
}));

// DELETE /api/schedule/pt-slots/:id -- xoá khung giờ PT (chỉ khi chưa có khách đặt)
// Xoá atomic với điều kiện isBooked=false — cùng lý do chống race như xoá lớp
router.delete("/pt-slots/:id", wrap(async (req, res) => {
  const deleted = await PTSlot.findOneAndDelete({ _id: req.params.id, isBooked: false });
  if (deleted) return res.json({ ok: true });
  const exists = await PTSlot.findById(req.params.id);
  if (!exists) return res.status(404).json({ error: "Không tìm thấy khung giờ" });
  res.status(400).json({ error: "Khung giờ đã có khách đặt, không thể xoá." });
}));

module.exports = router;
