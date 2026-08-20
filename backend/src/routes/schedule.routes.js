const express = require("express");
const mongoose = require("mongoose");
const GymClass = require("../models/GymClass");
const Trainer = require("../models/Trainer");
const Booking = require("../models/Booking");
const { requireAuth, requireManagement } = require("../middleware/auth");
const { lockedTrainerIds, isTrainerLocked } = require("../utils/activeTrainers");
const wrap = require("../utils/asyncHandler");
const { isValidClassType, labelOf } = require("../utils/disciplines");
const { normalizeClassName } = require("../utils/className");
const { FORMAT_CAPACITY, TRAINER_SELF_FORMATS, FORMAT_18_SERVICE, isValidFormat } = require("../utils/formats");

const router = express.Router();
// her-35 (chốt 19/08): mọi buổi tập là 1 LỚP có loại hình 1:1/1:2/1:4/1:8 — không còn khung PT.
// Quầy (lễ tân/admin) thao tác mọi lớp, đủ 4 loại hình; HLV tự tạo/sửa/xoá lớp 1:1/1:2 CỦA
// CHÍNH MÌNH khi lớp chưa có khách, không đổi được người dạy — quyền gắn TỪNG route (C8).
router.use(requireAuth);

const isStaff = (user) => user.role === "reception" || user.role === "admin";
// HLV thao tác lớp của mình: cần hồ sơ trainer gắn với tài khoản (role trainer, hoặc admin kiêm HLV)
const ownTrainerId = (user) => (user.trainerId ? user.trainerId.toString() : null);

// Kiểm tra khoảng thời gian khi tạo khung giờ mới — chặn cả trường hợp gọi thẳng API
// (app đã chặn ở form, nhưng quy tắc phải nằm ở server). Trả về message lỗi hoặc null.
// her-39 (20/08): allowPast = true CHỈ dành cho quầy — kịch bản khách tập trước, đăng ký sau:
// quầy dựng lại buổi ĐÃ TẬP trong quá khứ rồi add khách vào để trừ buổi. HLV tự mở buổi
// vẫn bị chặn quá khứ như cũ (không để HLV tự chế buổi cũ ăn thù lao).
function validateTimeRange(startAt, endAt, { allowPast = false } = {}) {
  const start = new Date(startAt);
  const end = new Date(endAt);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return "Ngày giờ không hợp lệ";
  if (end <= start) return "Giờ kết thúc phải sau giờ bắt đầu";
  if (!allowPast && start < new Date()) return "Không thể tạo khung giờ trong quá khứ";
  return null;
}

// Filter ?from=&to= trên các route GET: giá trị không parse được thì dùng mặc định
function parseDateOr(value, fallback) {
  if (!value) return fallback;
  const d = new Date(value);
  return isNaN(d.getTime()) ? fallback : d;
}

// Bất biến cốt lõi của xếp lịch: MỘT HLV không thể dạy 2 nơi cùng lúc.
// Kiểm tra khung giờ mới có giao với lớp nào của HLV đó không (her-35: mọi buổi đều là lớp).
// (Pre-check, KHÔNG atomic — từ her-11 HLV cũng tự tạo/sửa lớp nên rủi ro tăng nhẹ so với
// thời chỉ có quầy: 2 request song song của cùng 1 HLV có thể tạo 2 lớp chồng giờ.
// Chấp nhận có ghi nhận — tần suất thao tác vẫn thấp, hậu quả tự thấy và tự xoá được;
// làm chặt cần unique index theo khoảng thời gian, ngoài phạm vi đợt này.)
async function trainerOverlapError(trainerId, startAt, endAt, { excludeClassId } = {}) {
  const start = new Date(startAt);
  const end = new Date(endAt);
  const classQuery = { coachId: trainerId, startAt: { $lt: end }, endAt: { $gt: start } };
  if (excludeClassId) classQuery._id = { $ne: excludeClassId };
  const cls = await GymClass.findOne(classQuery);
  if (cls) return `HLV đã có lớp "${cls.name}" trùng giờ này`;
  return null;
}

// GET /api/schedule/trainers -- danh sách HLV để chọn khi xếp lịch (ẩn HLV có tài khoản bị khoá)
router.get("/trainers", requireManagement, wrap(async (req, res) => {
  const trainers = await Trainer.find({ _id: { $nin: await lockedTrainerIds() } }).sort({ name: 1 });
  res.json({ trainers: trainers.map((t) => ({ id: t._id, name: t.name, specialty: t.specialty, specialties: t.specialties || [] })) });
}));

// GET /api/schedule/classes?from=&to= -- lịch đã xếp, kèm sẵn tên khách đã đặt từng buổi.
// Quầy: tất cả; HLV: chỉ lớp của mình; khách: 403.
router.get("/classes", wrap(async (req, res) => {
  const staff = isStaff(req.user);
  const mine = ownTrainerId(req.user);
  if (!staff && (req.user.role !== "trainer" || !mine)) {
    return res.status(403).json({ error: "Không có quyền truy cập" });
  }
  const from = parseDateOr(req.query.from, new Date());
  const to = parseDateOr(req.query.to, new Date(Date.now() + 7 * 24 * 3600 * 1000));

  const query = { startAt: { $gte: from, $lte: to } };
  if (!staff) query.coachId = mine; // HLV chỉ thấy lớp của chính mình (H5)
  // her-31: staff CÓ hồ sơ HLV truyền mine=1 → chỉ lớp của mình (tab Lịch dạy của
  // admin kiêm HLV) — filter tự chọn, không phải phân quyền
  else if (typeof req.query.mine === "string" && req.query.mine === "1" && mine) query.coachId = mine;

  const classes = await GymClass.find(query).sort({ startAt: 1 }).populate("coachId", "name");

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
      format: c.format,
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

// POST /api/schedule/classes { name?, format, serviceType, coachId, startAt, endAt } -- tạo 1 buổi mới.
// Sức chứa KHÔNG nhận từ client: luôn = FORMAT_CAPACITY[format] (her-35).
router.post("/classes", wrap(async (req, res) => {
  // Chặn role TRƯỚC khi đụng body — khách không có quyền thì 403 luôn (C8)
  const staff = isStaff(req.user);
  const mine = ownTrainerId(req.user);
  if (!staff && (req.user.role !== "trainer" || !mine)) {
    return res.status(403).json({ error: "Không có quyền truy cập" });
  }

  const { name, format, serviceType, coachId, startAt, endAt } = req.body;
  if (!coachId || !startAt || !endAt) {
    return res.status(400).json({ error: "Thiếu thông tin bắt buộc" });
  }
  if (!isValidFormat(format)) {
    return res.status(400).json({ error: "Loại hình phải là 1:1, 1:2, 1:4 hoặc 1:8" });
  }
  // H5 mới (chốt 19/08): HLV chỉ tự mở buổi 1:1/1:2 cho CHÍNH MÌNH
  if (!staff) {
    if (coachId.toString() !== mine) {
      return res.status(403).json({ error: "HLV chỉ mở được buổi cho chính mình" });
    }
    if (!TRAINER_SELF_FORMATS.includes(format)) {
      return res.status(403).json({ error: "HLV chỉ tự mở được buổi 1:1 hoặc 1:2 — loại khác nhờ quầy" });
    }
  }
  if (!(await isValidClassType(serviceType))) {
    return res.status(400).json({ error: "Bộ môn không hợp lệ — chọn từ danh mục bộ môn" });
  }
  // her-36: tên lớp tuỳ chọn — sai kiểu/quá dài thì chặn ngay, bỏ trống thì lấy nhãn bộ môn
  const nameCheck = normalizeClassName(name);
  if (nameCheck.error) return res.status(400).json({ error: nameCheck.error });
  // Loại hình 1:8 chỉ dành cho Yoga (chốt 19/08)
  if (format === "1:8" && serviceType !== FORMAT_18_SERVICE) {
    return res.status(400).json({ error: "Loại hình 1:8 chỉ dành cho bộ môn Yoga" });
  }
  const timeError = validateTimeRange(startAt, endAt, { allowPast: staff });
  if (timeError) return res.status(400).json({ error: timeError });

  const coach = mongoose.isValidObjectId(coachId) ? await Trainer.findById(coachId) : null;
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
    name: nameCheck.value || (await labelOf(serviceType)),
    serviceType,
    format,
    coachId,
    startAt: new Date(startAt),
    endAt: new Date(endAt),
    capacity: FORMAT_CAPACITY[format], // sức chứa CỐ ĐỊNH theo loại hình — không nhận từ client
  });
  res.status(201).json({ class: gymClass });
}));

// PATCH /api/schedule/classes/:id -- sửa khung giờ / đổi HLV / đổi loại hình / bộ môn.
// Áp cùng bộ kiểm tra như khi tạo mới — không để flow "tạo hợp lệ rồi sửa" lách qua quy tắc.
// Quầy: mọi lớp. HLV: chỉ lớp 1:1/1:2 CỦA MÌNH và chỉ khi lớp còn trống.
router.patch("/classes/:id", wrap(async (req, res) => {
  if (!isStaff(req.user) && req.user.role !== "trainer") {
    return res.status(403).json({ error: "Không có quyền truy cập" });
  }
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(404).json({ error: "Không tìm thấy lớp học" });
  }
  const gymClass = await GymClass.findById(req.params.id);
  if (!gymClass) return res.status(404).json({ error: "Không tìm thấy lớp học" });
  // Lớp đã kết thúc là lịch sử — không sửa gì nữa (kể cả HLV: buổi đã dạy phải ghi đúng người dạy)
  if (gymClass.endAt < new Date()) {
    return res.status(400).json({ error: "Lớp đã kết thúc — lịch sử giữ nguyên, không thể sửa" });
  }

  const staff = isStaff(req.user);
  const owner = req.user.role === "trainer" && ownTrainerId(req.user) === gymClass.coachId.toString();
  if (!staff && !owner) return res.status(403).json({ error: "Không có quyền sửa buổi này" });
  if (owner && !staff) {
    if (req.body.coachId !== undefined) {
      return res.status(403).json({ error: "HLV không đổi được người dạy — liên hệ quầy" });
    }
    if (!TRAINER_SELF_FORMATS.includes(gymClass.format) ||
        (req.body.format !== undefined && !TRAINER_SELF_FORMATS.includes(req.body.format))) {
      return res.status(403).json({ error: "HLV chỉ tự sửa được buổi 1:1 hoặc 1:2" });
    }
    if (gymClass.bookedCount > 0) {
      return res.status(400).json({ error: "Buổi đã có khách đặt — liên hệ quầy để thay đổi" });
    }
  }

  const { name, format, serviceType, coachId, startAt, endAt } = req.body;
  if (serviceType !== undefined && !(await isValidClassType(serviceType))) {
    return res.status(400).json({ error: "Bộ môn không hợp lệ — chọn từ danh mục bộ môn" });
  }
  if (format !== undefined && !isValidFormat(format)) {
    return res.status(400).json({ error: "Loại hình phải là 1:1, 1:2, 1:4 hoặc 1:8" });
  }
  // her-36: tên lớp tuỳ chọn — cùng luật độ dài như lúc tạo, không lách qua đường sửa.
  // Gửi tên rỗng/toàn khoảng trắng = XOÁ tên riêng, đặt lại theo nhãn bộ môn.
  const nameCheck = normalizeClassName(name);
  if (nameCheck.error) return res.status(400).json({ error: nameCheck.error });

  // Lớp ĐÃ CÓ KHÁCH ĐẶT: không cho đổi GIỜ/TÊN/BỘ MÔN/LOẠI HÌNH (lịch của khách là snapshot — L7;
  // đổi loại hình còn kéo theo đổi sức chứa). Riêng ĐỔI HLV thì ĐƯỢC (quyết định 16/08/2026,
  // góp ý khách hàng: HLV ốm đột xuất thì nội bộ chủ động thay người dạy, khách không phải hủy
  // đặt lại) — booking của khách được đồng bộ sang HLV mới ngay bên dưới.
  // Ngoại lệ giữ nguyên: gán bộ môn LẦN ĐẦU cho lớp cũ (backfill Q8).
  const serviceTypeFirstAssign = serviceType !== undefined && !gymClass.serviceType;
  // Luật 1:8 tính trên TRẠNG THÁI SAU KHI SỬA — không để "đổi từng field" lách qua
  const targetFormat = format !== undefined ? format : gymClass.format;
  const targetType = serviceType !== undefined ? serviceType : gymClass.serviceType;

  // her-36: TÊN SAU KHI SỬA.
  // - Client gửi name: dùng tên đó (rỗng = xoá tên riêng, về nhãn bộ môn).
  // - Client KHÔNG gửi name mà đổi bộ môn: tên đang là nhãn bộ môn CŨ (tên tự sinh) thì đi theo
  //   bộ môn mới — luật nằm ở SERVER để gọi thẳng API cũng không có lớp "Pilates" mà môn là yoga.
  //   Tên RIÊNG do người dùng đặt thì giữ nguyên. labelOf trả rỗng (lớp cũ chưa có bộ môn) thì
  //   giữ tên cũ, không ghi tên rỗng đè lên.
  let nextName = gymClass.name;
  if (!nameCheck.skip) {
    nextName = nameCheck.value || (await labelOf(targetType)) || gymClass.name;
  } else if (serviceType !== undefined && serviceType !== gymClass.serviceType) {
    const oldLabel = await labelOf(gymClass.serviceType);
    if (oldLabel && gymClass.name === oldLabel) {
      const newLabel = await labelOf(serviceType);
      if (newLabel) nextName = newLabel;
    }
  }

  // So TÊN SAU KHI SỬA với tên hiện tại (giống cách so format ngay dưới): gửi kèm ô tên
  // GIỐNG HỆT tên cũ không phải là "đổi tên" — không được chặn oan luồng đổi HLV lớp có khách
  const changesCustomerFacing =
    startAt !== undefined || endAt !== undefined ||
    nextName !== gymClass.name || (serviceType !== undefined && !serviceTypeFirstAssign) ||
    (format !== undefined && format !== gymClass.format);
  if (gymClass.bookedCount > 0 && changesCustomerFacing) {
    return res.status(400).json({
      error: `Lớp đã có ${gymClass.bookedCount} khách đặt — không thể đổi giờ/tên/bộ môn/loại hình. Hãy hủy lịch cho khách trước rồi mới sửa (đổi HLV thì được).`,
    });
  }

  if (targetFormat === "1:8" && targetType !== FORMAT_18_SERVICE) {
    return res.status(400).json({ error: "Loại hình 1:8 chỉ dành cho bộ môn Yoga" });
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

  if (coachId !== undefined) {
    const coach = mongoose.isValidObjectId(coachId) ? await Trainer.findById(coachId) : null;
    if (!coach) return res.status(404).json({ error: "Không tìm thấy HLV" });
    if (await isTrainerLocked(coach._id)) {
      return res.status(400).json({ error: "HLV này đang bị khoá tài khoản, không thể nhận lớp" });
    }
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
  // đổi giờ/HLV/tên/loại hình thì lớp phải vẫn 0 khách tại thời điểm ghi (không chỉ lúc đọc ở trên).
  // Pin thêm snapshot giờ (review her-11 V1): request "chỉ đổi HLV" không được đè giờ stale
  // lên lớp vừa bị thao tác song song dời đi.
  const condition = { _id: gymClass._id, startAt: gymClass.startAt, endAt: gymClass.endAt };
  if (changesCustomerFacing) condition.bookedCount = 0;
  const $set = { startAt: newStart, endAt: newEnd };
  if (nextName !== gymClass.name) $set.name = nextName;
  if (serviceType !== undefined) $set.serviceType = serviceType;
  if (coachId !== undefined) $set.coachId = coachId;
  if (format !== undefined) {
    $set.format = format;
    $set.capacity = FORMAT_CAPACITY[format]; // sức chứa đi theo loại hình, không nhận từ client
  }

  const updated = await GymClass.findOneAndUpdate(condition, { $set }, { new: true });
  if (!updated) {
    return res.status(400).json({
      error: changesCustomerFacing
        ? "Vừa có khách đặt lớp này — không thể đổi giờ/tên/bộ môn/loại hình nữa. Hãy hủy lịch cho khách trước."
        : "Lớp vừa thay đổi (thao tác khác) — tải lại danh sách rồi thử lại",
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

// DELETE /api/schedule/classes/:id -- xoá buổi (chỉ khi chưa có khách đặt).
// Quầy xoá buổi bất kỳ; HLV chỉ xoá buổi 1:1/1:2 CỦA MÌNH.
// Xoá atomic với điều kiện bookedCount=0 — chặn race "khách bấm đặt đúng lúc lễ tân đang xoá"
router.delete("/classes/:id", wrap(async (req, res) => {
  if (!isStaff(req.user) && req.user.role !== "trainer") {
    return res.status(403).json({ error: "Không có quyền truy cập" });
  }
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(404).json({ error: "Không tìm thấy lớp học" });
  }
  const gymClass = await GymClass.findById(req.params.id);
  if (!gymClass) return res.status(404).json({ error: "Không tìm thấy lớp học" });

  const staff = isStaff(req.user);
  const owner = req.user.role === "trainer" && ownTrainerId(req.user) === gymClass.coachId.toString();
  if (!staff && !owner) return res.status(403).json({ error: "Không có quyền xoá buổi này" });
  if (owner && !staff && !TRAINER_SELF_FORMATS.includes(gymClass.format)) {
    return res.status(403).json({ error: "HLV chỉ tự xoá được buổi 1:1 hoặc 1:2" });
  }

  const deleted = await GymClass.findOneAndDelete({ _id: gymClass._id, bookedCount: 0 });
  if (deleted) return res.json({ ok: true });
  // Phân biệt 2 lý do fail (C6 — review her-11 N2): lớp vừa bị xoá song song vs vừa có khách
  const exists = await GymClass.findById(gymClass._id);
  if (!exists) return res.status(404).json({ error: "Không tìm thấy lớp học" });
  res.status(400).json({ error: "Lớp đã có khách đặt, không thể xoá. Hãy liên hệ khách trước." });
}));

module.exports = router;
