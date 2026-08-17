const express = require("express");
const mongoose = require("mongoose");
const GymClass = require("../models/GymClass");
const PTSlot = require("../models/PTSlot");
const Trainer = require("../models/Trainer");
const Booking = require("../models/Booking");
const { requireAuth, requireManagement } = require("../middleware/auth");
const { lockedTrainerIds, isTrainerLocked } = require("../utils/activeTrainers");
const wrap = require("../utils/asyncHandler");
const { ptTitle } = require("../utils/serviceTypes");
const { isValidClassType } = require("../utils/disciplines");

const router = express.Router();
// Từ her-11 (mục 6): lớp nhóm vẫn CHỈ quầy (lễ tân/admin) xếp; riêng khung PT thì HLV
// được thao tác trên khung CỦA CHÍNH MÌNH (tạo/sửa/xoá khi trống) — quyền gắn TỪNG route (C8).
router.use(requireAuth);

const isStaff = (user) => user.role === "reception" || user.role === "admin";
// HLV thao tác khung PT: cần hồ sơ trainer gắn với tài khoản (role trainer, hoặc admin kiêm HLV)
const ownTrainerId = (user) => (user.trainerId ? user.trainerId.toString() : null);

// Số người tối đa của khung PT (mục 6): 1 = PT 1:1; tối đa 10 (chốt 16/08)
function validatePtCapacity(capacity) {
  if (capacity === undefined) return null;
  const cap = Number(capacity);
  if (!Number.isInteger(cap) || cap < 1 || cap > 10) {
    return "Số người tối đa phải là số nguyên từ 1 đến 10";
  }
  return null;
}


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
// (Pre-check, KHÔNG atomic — từ her-11 HLV cũng tự tạo/sửa khung nên rủi ro tăng nhẹ so với
// thời chỉ có quầy: 2 request song song của cùng 1 HLV có thể tạo 2 khung chồng giờ.
// Chấp nhận có ghi nhận — tần suất thao tác vẫn thấp, hậu quả tự thấy và tự xoá được;
// làm chặt cần unique index theo khoảng thời gian, ngoài phạm vi đợt này.)
async function trainerOverlapError(trainerId, startAt, endAt, { excludeClassId, excludeSlotId } = {}) {
  const start = new Date(startAt);
  const end = new Date(endAt);
  const classQuery = { coachId: trainerId, startAt: { $lt: end }, endAt: { $gt: start } };
  if (excludeClassId) classQuery._id = { $ne: excludeClassId };
  const cls = await GymClass.findOne(classQuery);
  if (cls) return `HLV đã có lớp "${cls.name}" trùng giờ này`;
  const slotQuery = { trainerId, startAt: { $lt: end }, endAt: { $gt: start } };
  if (excludeSlotId) slotQuery._id = { $ne: excludeSlotId };
  const slot = await PTSlot.findOne(slotQuery);
  if (slot) return "HLV đã có khung PT trùng giờ này";
  return null;
}

// GET /api/schedule/trainers -- danh sách HLV để chọn khi xếp lịch (ẩn HLV có tài khoản bị khoá)
router.get("/trainers", requireManagement, wrap(async (req, res) => {
  const trainers = await Trainer.find({ _id: { $nin: await lockedTrainerIds() } }).sort({ name: 1 });
  res.json({ trainers: trainers.map((t) => ({ id: t._id, name: t.name, specialty: t.specialty, specialties: t.specialties || [] })) });
}));

// GET /api/schedule/classes?from=&to= -- lịch Group đã xếp, kèm sẵn tên khách đã đặt từng khung giờ
router.get("/classes", requireManagement, wrap(async (req, res) => {
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
      serviceType: c.serviceType,
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
router.post("/classes", requireManagement, wrap(async (req, res) => {
  const { name, serviceType, coachId, startAt, endAt, capacity } = req.body;
  if (!name || !coachId || !startAt || !endAt) {
    return res.status(400).json({ error: "Thiếu thông tin bắt buộc" });
  }
  if (!(await isValidClassType(serviceType))) {
    return res.status(400).json({ error: "Bộ môn không hợp lệ — chọn từ danh mục bộ môn" });
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
  // her-19: lớp bộ môn nào phải giao cho HLV CÓ chuyên môn đó (hồ sơ cũ chưa gán chuyên môn
  // thì tạm cho qua để không chặn dữ liệu cũ — seed/hồ sơ mới đều có specialties)
  if ((coach.specialties || []).length && !coach.specialties.includes(serviceType)) {
    return res.status(400).json({ error: `HLV ${coach.name} không có chuyên môn bộ môn này` });
  }
  const overlap = await trainerOverlapError(coach._id, startAt, endAt);
  if (overlap) return res.status(400).json({ error: overlap });

  const gymClass = await GymClass.create({
    name,
    serviceType,
    coachId,
    startAt: new Date(startAt),
    endAt: new Date(endAt),
    capacity: capacity || 8,
  });
  res.status(201).json({ class: gymClass });
}));

// PATCH /api/schedule/classes/:id -- sửa khung giờ / đổi HLV / sức chứa
// Áp cùng bộ kiểm tra như khi tạo mới — không để flow "tạo hợp lệ rồi sửa" lách qua quy tắc.
router.patch("/classes/:id", requireManagement, wrap(async (req, res) => {
  const gymClass = await GymClass.findById(req.params.id);
  if (!gymClass) return res.status(404).json({ error: "Không tìm thấy lớp học" });
  // Lớp đã kết thúc là lịch sử — không sửa gì nữa (kể cả HLV: buổi đã dạy phải ghi đúng người dạy)
  if (gymClass.endAt < new Date()) {
    return res.status(400).json({ error: "Lớp đã kết thúc — lịch sử giữ nguyên, không thể sửa" });
  }

  const { name, serviceType, coachId, startAt, endAt, capacity } = req.body;
  if (serviceType !== undefined && !(await isValidClassType(serviceType))) {
    return res.status(400).json({ error: "Bộ môn không hợp lệ — chọn từ danh mục bộ môn" });
  }

  // Lớp ĐÃ CÓ KHÁCH ĐẶT: không cho đổi GIỜ/TÊN/BỘ MÔN (lịch của khách là snapshot — L7).
  // Riêng ĐỔI HLV thì ĐƯỢC (quyết định 16/08/2026, góp ý khách hàng: HLV ốm đột xuất thì
  // nội bộ chủ động thay người dạy, khách không phải huỷ đặt lại) — booking của khách được
  // đồng bộ sang HLV mới ngay bên dưới. Nhắc khách qua push thuộc đợt 6.
  // Ngoại lệ khác giữ nguyên: tăng sức chứa; gán bộ môn LẦN ĐẦU cho lớp cũ (backfill Q8).
  const serviceTypeFirstAssign = serviceType !== undefined && !gymClass.serviceType;
  const changesCustomerFacing =
    startAt !== undefined || endAt !== undefined ||
    name !== undefined || (serviceType !== undefined && !serviceTypeFirstAssign);
  if (gymClass.bookedCount > 0 && changesCustomerFacing) {
    return res.status(400).json({
      error: `Lớp đã có ${gymClass.bookedCount} khách đặt — không thể đổi giờ/tên/bộ môn. Hãy hủy lịch cho khách trước rồi mới sửa (đổi HLV thì được).`,
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
    const targetType = serviceType !== undefined ? serviceType : gymClass.serviceType;
    if ((coach.specialties || []).length && !coach.specialties.includes(targetType)) {
      return res.status(400).json({ error: `HLV ${coach.name} không có chuyên môn bộ môn này` });
    }
  } else if (serviceType !== undefined && serviceType !== gymClass.serviceType) {
    // Đổi BỘ MÔN mà giữ nguyên HLV (review her-19 V1): HLV hiện tại cũng phải có chuyên môn mới —
    // không có lỗ "đổi môn chui" khi gọi thẳng API không kèm coachId
    const currentCoach = await Trainer.findById(gymClass.coachId);
    if (currentCoach && (currentCoach.specialties || []).length && !currentCoach.specialties.includes(serviceType)) {
      return res.status(400).json({ error: `HLV ${currentCoach.name} không có chuyên môn bộ môn này — đổi HLV trước` });
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
  // Pin thêm snapshot giờ (review her-11 V1 — cùng dạng pt-slots): request "chỉ đổi HLV/sức
  // chứa" không được đè giờ stale lên lớp vừa bị thao tác song song dời đi
  const condition = { _id: gymClass._id, startAt: gymClass.startAt, endAt: gymClass.endAt };
  if (changesCustomerFacing) condition.bookedCount = 0;
  else if (capacity !== undefined) condition.bookedCount = { $lte: Number(capacity) };
  const $set = { startAt: newStart, endAt: newEnd };
  if (name !== undefined) $set.name = name;
  if (serviceType !== undefined) $set.serviceType = serviceType;
  if (coachId !== undefined) $set.coachId = coachId;
  if (capacity !== undefined) $set.capacity = Number(capacity);

  const updated = await GymClass.findOneAndUpdate(condition, { $set }, { new: true });
  if (!updated) {
    return res.status(400).json({
      error: changesCustomerFacing
        ? "Vừa có khách đặt lớp này — không thể đổi giờ/tên/bộ môn nữa. Hãy hủy lịch cho khách trước."
        : "Vừa có thêm khách đặt — sức chứa mới nhỏ hơn số khách hiện tại",
    });
  }

  // Đổi HLV: đồng bộ mọi booking đang "booked" của lớp sang HLV mới — lịch của khách,
  // lịch dạy HLV và quyền xem roster đều đi theo trainerId (16/08). Buổi đã tập/đã hủy giữ
  // nguyên HLV cũ (lịch sử ghi người dạy thật). Race hẹp "khách claim chỗ TRƯỚC khi đổi,
  // create booking SAU updateMany" được tự lành ở bookings.routes (đọc lại HLV sau khi tạo).
  if (coachId !== undefined && coachId.toString() !== gymClass.coachId.toString()) {
    // $or: booking "booked" + booking bị điểm danh SỚM (completed/no_show nhưng buổi CHƯA
    // diễn ra) — người dạy thật vẫn là HLV mới (review her-12 V1: không sync thì bảng lương
    // tính 1 buổi cho CẢ 2 HLV). Buổi đã qua giữ HLV cũ — lịch sử ghi người dạy thật (her-09).
    await Booking.updateMany(
      {
        classId: updated._id,
        $or: [
          { status: "booked" },
          { status: { $in: ["completed", "no_show"] }, startAt: { $gt: new Date() } },
        ],
      },
      { $set: { trainerId: updated.coachId } }
    );
  }
  res.json({ class: updated });
}));

// DELETE /api/schedule/classes/:id -- xoá khung giờ (chỉ khi chưa có khách đặt)
// Xoá atomic với điều kiện bookedCount=0 — chặn race "khách bấm đặt đúng lúc lễ tân đang xoá"
router.delete("/classes/:id", requireManagement, wrap(async (req, res) => {
  const deleted = await GymClass.findOneAndDelete({ _id: req.params.id, bookedCount: 0 });
  if (deleted) return res.json({ ok: true });
  const exists = await GymClass.findById(req.params.id);
  if (!exists) return res.status(404).json({ error: "Không tìm thấy lớp học" });
  res.status(400).json({ error: "Lớp đã có khách đặt, không thể xoá. Hãy liên hệ khách trước." });
}));

// ---- Khung PT (mục 6): quầy thao tác mọi khung; HLV thao tác khung CỦA MÌNH ----

// GET /api/schedule/pt-slots?from=&to= — quầy: tất cả; HLV: chỉ khung của mình; khách: 403
router.get("/pt-slots", wrap(async (req, res) => {
  const staff = isStaff(req.user);
  const mine = ownTrainerId(req.user);
  if (!staff && (req.user.role !== "trainer" || !mine)) {
    return res.status(403).json({ error: "Không có quyền truy cập" });
  }
  const from = parseDateOr(req.query.from, new Date());
  const to = parseDateOr(req.query.to, new Date(Date.now() + 7 * 24 * 3600 * 1000));

  const query = { startAt: { $gte: from, $lte: to } };
  if (!staff) query.trainerId = mine; // HLV chỉ thấy khung của chính mình (H5)
  // her-31: staff CÓ hồ sơ HLV truyền mine=1 → chỉ khung của mình (tab Lịch dạy của
  // admin kiêm HLV) — filter tự chọn, không phải phân quyền
  else if (typeof req.query.mine === "string" && req.query.mine === "1" && mine) query.trainerId = mine;
  const slots = await PTSlot.find(query).sort({ startAt: 1 }).populate("trainerId", "name");

  res.json({
    slots: slots.map((s) => ({
      id: s._id,
      trainerId: s.trainerId?._id,
      trainer: s.trainerId?.name || "",
      startAt: s.startAt,
      endAt: s.endAt,
      capacity: s.capacity,
      bookedCount: s.bookedCount,
      full: s.bookedCount >= s.capacity,
    })),
  });
}));

// POST /api/schedule/pt-slots { trainerId, startAt, endAt, capacity? } -- tạo khung PT.
// Quầy (admin/lễ tân — admin kiêm HLV cũng đi nhánh này) tạo cho HLV bất kỳ;
// HLV thường chỉ tạo cho CHÍNH MÌNH.
// capacity 1..10 (mặc định 1 = PT 1:1) — PT nhóm là capacity > 1 (mục 6, chốt 16/08).
router.post("/pt-slots", wrap(async (req, res) => {
  // Chặn role TRƯỚC khi đụng body — khách không có quyền thì 403 luôn (C8)
  const mine = ownTrainerId(req.user);
  if (!isStaff(req.user) && (req.user.role !== "trainer" || !mine)) {
    return res.status(403).json({ error: "Không có quyền truy cập" });
  }
  const { trainerId, startAt, endAt, capacity } = req.body;
  if (!trainerId || !startAt || !endAt) {
    return res.status(400).json({ error: "Thiếu thông tin bắt buộc" });
  }
  if (!isStaff(req.user) && trainerId.toString() !== mine) {
    return res.status(403).json({ error: "HLV chỉ mở được khung giờ cho chính mình" });
  }
  const timeError = validateTimeRange(startAt, endAt);
  if (timeError) return res.status(400).json({ error: timeError });
  const capError = validatePtCapacity(capacity);
  if (capError) return res.status(400).json({ error: capError });

  const trainer = mongoose.isValidObjectId(trainerId) ? await Trainer.findById(trainerId) : null;
  if (!trainer) return res.status(404).json({ error: "Không tìm thấy HLV" });
  if (await isTrainerLocked(trainer._id)) {
    return res.status(400).json({ error: "HLV này đang bị khoá tài khoản, không thể xếp lịch mới" });
  }
  const overlap = await trainerOverlapError(trainer._id, startAt, endAt);
  if (overlap) return res.status(400).json({ error: overlap });

  const slot = await PTSlot.create({
    trainerId,
    startAt: new Date(startAt),
    endAt: new Date(endAt),
    capacity: capacity !== undefined ? Number(capacity) : 1,
  });
  res.status(201).json({ slot });
}));

// PATCH /api/schedule/pt-slots/:id -- sửa khung giờ PT.
// Quầy (mục 4, 16/08): trống → đổi giờ/HLV/sức chứa; ĐÃ có khách → chỉ đổi HLV +
//   tăng sức chứa (không giảm dưới số khách đã đặt); đổi giờ phải hủy lịch cho khách trước.
// HLV (mục 6, 16/08): CHỈ khung của mình và CHỈ khi trống (giờ + sức chứa);
//   không đổi được trainerId; khung có khách → liên hệ quầy.
router.patch("/pt-slots/:id", wrap(async (req, res) => {
  if (!isStaff(req.user) && req.user.role !== "trainer") {
    return res.status(403).json({ error: "Không có quyền truy cập" });
  }
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(404).json({ error: "Không tìm thấy khung giờ" });
  }
  const slot = await PTSlot.findById(req.params.id);
  if (!slot) return res.status(404).json({ error: "Không tìm thấy khung giờ" });
  if (slot.endAt < new Date()) {
    return res.status(400).json({ error: "Khung giờ đã kết thúc — lịch sử giữ nguyên, không thể sửa" });
  }

  const staff = isStaff(req.user);
  const owner = req.user.role === "trainer" && ownTrainerId(req.user) === slot.trainerId.toString();
  if (!staff && !owner) {
    return res.status(403).json({ error: "Không có quyền sửa khung giờ này" });
  }

  const { trainerId, startAt, endAt, capacity } = req.body;
  const timeChange = startAt !== undefined || endAt !== undefined;

  if (owner && !staff) {
    if (trainerId !== undefined) {
      return res.status(403).json({ error: "HLV không đổi được người dạy — liên hệ quầy" });
    }
    if (slot.bookedCount > 0) {
      return res.status(400).json({ error: "Khung đã có khách đặt — liên hệ quầy để thay đổi" });
    }
  }
  if (slot.bookedCount > 0 && timeChange) {
    return res.status(400).json({
      error: "Khung này đã có khách đặt — chỉ đổi được HLV. Muốn đổi giờ hãy hủy lịch cho khách (khách được hoàn buổi) rồi sửa.",
    });
  }

  const capError = validatePtCapacity(capacity);
  if (capError) return res.status(400).json({ error: capError });
  if (capacity !== undefined && Number(capacity) < slot.bookedCount) {
    return res.status(400).json({
      error: `Đã có ${slot.bookedCount} khách đặt — số người tối đa không thể nhỏ hơn số khách hiện có`,
    });
  }

  const newStart = startAt !== undefined ? new Date(startAt) : slot.startAt;
  const newEnd = endAt !== undefined ? new Date(endAt) : slot.endAt;
  if (isNaN(newStart.getTime()) || isNaN(newEnd.getTime())) {
    return res.status(400).json({ error: "Ngày giờ không hợp lệ" });
  }
  if (newEnd <= newStart) return res.status(400).json({ error: "Giờ kết thúc phải sau giờ bắt đầu" });
  if (startAt !== undefined && newStart < new Date()) {
    return res.status(400).json({ error: "Không thể dời khung giờ về quá khứ" });
  }

  let trainer = null;
  if (trainerId !== undefined) {
    trainer = mongoose.isValidObjectId(trainerId) ? await Trainer.findById(trainerId) : null;
    if (!trainer) return res.status(404).json({ error: "Không tìm thấy HLV" });
    if (await isTrainerLocked(trainer._id)) {
      return res.status(400).json({ error: "HLV này đang bị khoá tài khoản, không thể nhận khung giờ" });
    }
  }
  const targetTrainerId = trainerId !== undefined ? trainerId : slot.trainerId;

  const overlap = await trainerOverlapError(targetTrainerId, newStart, newEnd, { excludeSlotId: slot._id });
  if (overlap) return res.status(400).json({ error: overlap });

  const newCapacity = capacity !== undefined ? Number(capacity) : slot.capacity;

  // Ghi atomic — điều kiện pin ĐỦ snapshot HLV + GIỜ (review her-11 V1: nếu chỉ pin HLV,
  // request "chỉ đổi capacity" có thể đè giờ stale lên khung vừa được người khác dời):
  // - đổi GIỜ (hoặc HLV tự sửa): khung phải VẪN trống tại thời điểm ghi (khách có thể vừa đặt)
  // - đổi SỨC CHỨA: không được tụt dưới số khách đã đặt tại thời điểm ghi
  const condition = {
    _id: slot._id,
    trainerId: slot.trainerId,
    startAt: slot.startAt,
    endAt: slot.endAt,
  };
  if (timeChange || (owner && !staff)) condition.bookedCount = 0;
  else if (capacity !== undefined) condition.bookedCount = { $lte: newCapacity };
  const updated = await PTSlot.findOneAndUpdate(
    condition,
    { $set: { trainerId: targetTrainerId, startAt: newStart, endAt: newEnd, capacity: newCapacity } },
    { new: true }
  );
  if (!updated) {
    return res.status(400).json({
      error: "Khung giờ vừa thay đổi (có khách đặt hoặc thao tác khác) — tải lại danh sách rồi thử lại",
    });
  }

  // Đồng bộ title/trainerId cho booking đang "booked" của khung — LUÔN chạy khi đổi HLV
  // (race her-09 #1) và CẢ khi đổi capacity làm dạng buổi đổi 1:1 <-> nhóm (review her-11 V2:
  // không thì khách cũ vẫn thấy "1:1 PT" trong khi khách mới thấy "PT nhóm" cùng một khung).
  const trainerChanged = trainerId !== undefined && trainerId.toString() !== slot.trainerId.toString();
  const titleKindChanged = (updated.capacity > 1) !== (slot.capacity > 1);
  if (trainerChanged || titleKindChanged) {
    const targetTrainer = trainer || (await Trainer.findById(updated.trainerId));
    if (targetTrainer) {
      // $or như nhánh lớp nhóm (review her-12 V1/V2): sync cả booking bị điểm danh SỚM của
      // khung CHƯA diễn ra — không thì cùng 1 khung bị bảng lương tách thành 2 buổi/2 HLV
      await Booking.updateMany(
        {
          slotId: slot._id,
          $or: [
            { status: "booked" },
            { status: { $in: ["completed", "no_show"] }, startAt: { $gt: new Date() } },
          ],
        },
        { $set: { trainerId: targetTrainer._id, title: ptTitle(updated.capacity, targetTrainer.name) } }
      );
    }
  }
  res.json({ slot: updated });
}));

// DELETE /api/schedule/pt-slots/:id -- xoá khung PT khi chưa có khách đặt.
// Quầy xoá khung bất kỳ; HLV chỉ xoá khung CỦA MÌNH. Xoá atomic điều kiện bookedCount=0.
router.delete("/pt-slots/:id", wrap(async (req, res) => {
  if (!isStaff(req.user) && req.user.role !== "trainer") {
    return res.status(403).json({ error: "Không có quyền truy cập" });
  }
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(404).json({ error: "Không tìm thấy khung giờ" });
  }
  const slot = await PTSlot.findById(req.params.id);
  if (!slot) return res.status(404).json({ error: "Không tìm thấy khung giờ" });

  const staff = isStaff(req.user);
  const owner = req.user.role === "trainer" && ownTrainerId(req.user) === slot.trainerId.toString();
  if (!staff && !owner) {
    return res.status(403).json({ error: "Không có quyền xoá khung giờ này" });
  }

  const deleted = await PTSlot.findOneAndDelete({ _id: slot._id, bookedCount: 0 });
  if (deleted) return res.json({ ok: true });
  // Phân biệt 2 lý do fail (C6 — review her-11 N2): slot vừa bị xoá song song vs vừa có khách
  const exists = await PTSlot.findById(slot._id);
  if (!exists) return res.status(404).json({ error: "Không tìm thấy khung giờ" });
  res.status(400).json({ error: "Khung giờ đã có khách đặt, không thể xoá." });
}));

module.exports = router;
