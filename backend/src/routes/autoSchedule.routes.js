const express = require("express");
const AutoScheduleRule = require("../models/AutoScheduleRule");
const Trainer = require("../models/Trainer");
const { requireAuth, requireManagement } = require("../middleware/auth");
const { isTrainerLocked } = require("../utils/activeTrainers");
const { isValidClassType, labelOf } = require("../utils/disciplines");
const { normalizeClassName } = require("../utils/className");
const { isValidFormat, FORMAT_18_SERVICE } = require("../utils/formats");
const { runAutoSchedule } = require("../utils/autoSchedule");
const wrap = require("../utils/asyncHandler");

// her-32: LỊCH TỰ ĐỘNG — quầy (lễ tân/admin) đặt luật sinh lớp lặp theo thứ,
// hệ thống tự phủ trước 7 ngày. Sửa luật = xoá tạo lại (UI tối giản).
const router = express.Router();
router.use(requireAuth, requireManagement);

const serialize = (r) => ({
  id: r._id,
  serviceType: r.serviceType,
  name: r.name,
  coachId: r.coachId?._id ?? r.coachId,
  coach: r.coachId?.name || "",
  hour: r.hour,
  minute: r.minute,
  daysOfWeek: r.daysOfWeek,
  format: r.format,
  active: r.active,
});

// GET /api/auto-schedule -- danh sách luật
router.get("/", wrap(async (req, res) => {
  const rules = await AutoScheduleRule.find().sort({ hour: 1, minute: 1 }).populate("coachId", "name");
  res.json({ rules: rules.map(serialize) });
}));

// POST /api/auto-schedule -- tạo luật mới (validate như tạo lớp + sinh NGAY cho 7 ngày tới)
router.post("/", wrap(async (req, res) => {
  const { format, serviceType, coachId, hour, minute, daysOfWeek, name } = req.body;
  if (!coachId || hour === undefined || minute === undefined) {
    return res.status(400).json({ error: "Thiếu thông tin bắt buộc" });
  }
  // her-36: luật cũng đặt được TÊN RIÊNG — mọi buổi luật sinh ra mang tên đó.
  // Bỏ trống thì lấy nhãn bộ môn (hành vi cũ). Cùng luật độ dài với tạo lớp (utils/className)
  const nameCheck = normalizeClassName(name);
  if (nameCheck.error) return res.status(400).json({ error: nameCheck.error });
  if (!(await isValidClassType(serviceType))) {
    return res.status(400).json({ error: "Bộ môn không hợp lệ — chọn từ danh mục bộ môn" });
  }
  // == null bắt cả null lẫn undefined — Number(null) = 0 sẽ thành 00:00 im lặng (review N4)
  if (hour == null || minute == null) {
    return res.status(400).json({ error: "Thiếu thông tin bắt buộc" });
  }
  const h = Number(hour);
  const m = Number(minute);
  if (!Number.isInteger(h) || h < 0 || h > 23 || !Number.isInteger(m) || m < 0 || m > 59) {
    return res.status(400).json({ error: "Giờ bắt đầu không hợp lệ" });
  }
  const rawDays = Array.isArray(daysOfWeek) ? daysOfWeek : [];
  // typeof number: chặn [true]/["1"] lọt thành thứ 2 qua Number() (review N4)
  const days = [...new Set(rawDays.filter((d) => typeof d === "number"))];
  if (!days.length || days.length !== rawDays.length || days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
    return res.status(400).json({ error: "Chọn ít nhất 1 thứ trong tuần" });
  }
  // her-35: loại hình quyết định sức chứa — không còn ô sức chứa trên form
  if (!isValidFormat(format)) {
    return res.status(400).json({ error: "Loại hình phải là 1:1, 1:2, 1:4 hoặc 1:8" });
  }
  if (format === "1:8" && serviceType !== FORMAT_18_SERVICE) {
    return res.status(400).json({ error: "Loại hình 1:8 chỉ dành cho bộ môn Yoga" });
  }
  const coach = await Trainer.findById(coachId);
  if (!coach) return res.status(404).json({ error: "Không tìm thấy HLV" });
  if (await isTrainerLocked(coach._id)) {
    return res.status(400).json({ error: "HLV này đang bị khoá tài khoản, không thể xếp lịch mới" });
  }
  if ((coach.specialties || []).length && !coach.specialties.includes(serviceType)) {
    return res.status(400).json({ error: `HLV ${coach.name} không có chuyên môn bộ môn này` });
  }
  // review her-32 V1: 2 luật cùng HLV giao giờ + chung thứ sẽ vĩnh viễn "tranh nhau" —
  // buổi thua bị bỏ qua im lặng mỗi ngày. Chặn ngay khi đặt luật (buổi 60'):
  const startMin = h * 60 + m;
  const others = await AutoScheduleRule.find({ coachId });
  for (const o of others) {
    const oStart = o.hour * 60 + o.minute;
    const sharesDay = o.daysOfWeek.some((d) => days.includes(d));
    const overlaps = startMin < oStart + 60 && oStart < startMin + 60;
    if (sharesDay && overlaps) {
      return res.status(400).json({
        error: `Trùng với lịch tự động khác của HLV này (${String(o.hour).padStart(2, "0")}:${String(o.minute).padStart(2, "0")} ${o.name})`,
      });
    }
  }

  const rule = await AutoScheduleRule.create({
    serviceType,
    format,
    name: nameCheck.value || (await labelOf(serviceType)),
    coachId,
    hour: h,
    minute: m,
    daysOfWeek: days.sort((a, b) => a - b),
    createdBy: req.user._id,
  });
  // Sinh NGAY — buổi phải vào tầm thấy 7 ngày của khách ngay khi đặt luật, không chờ chu kỳ.
  // Trả kèm số buổi sinh được: thấp bất thường = có buổi bị trùng giờ với lớp lẻ (review V1)
  const created = await runAutoSchedule();
  const populated = await AutoScheduleRule.findById(rule._id).populate("coachId", "name");
  res.status(201).json({ rule: serialize(populated), created });
}));

// PATCH /api/auto-schedule/:id { active } -- bật/tắt luật (bật lại là sinh bù ngay)
router.patch("/:id", wrap(async (req, res) => {
  const { active } = req.body;
  if (typeof active !== "boolean") {
    return res.status(400).json({ error: "Thiếu trạng thái bật/tắt (active: true/false)" });
  }
  const rule = await AutoScheduleRule.findByIdAndUpdate(req.params.id, { active }, { new: true })
    .populate("coachId", "name");
  if (!rule) return res.status(404).json({ error: "Không tìm thấy lịch tự động" });
  if (active) await runAutoSchedule();
  res.json({ rule: serialize(rule) });
}));

// DELETE /api/auto-schedule/:id -- xoá luật (buổi ĐÃ sinh giữ nguyên). Sổ ghi của luật xoá
// theo luôn cho gọn — lớp còn đó thì coachBusy vẫn chặn nếu đặt lại luật y hệt (review N7)
const AutoScheduleLog = require("../models/AutoScheduleLog");
router.delete("/:id", wrap(async (req, res) => {
  const rule = await AutoScheduleRule.findByIdAndDelete(req.params.id);
  if (!rule) return res.status(404).json({ error: "Không tìm thấy lịch tự động" });
  await AutoScheduleLog.deleteMany({ ruleId: rule._id });
  res.json({ ok: true });
}));

module.exports = router;
