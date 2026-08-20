const mongoose = require("mongoose");
const Booking = require("../models/Booking");
const Trainer = require("../models/Trainer");
const TrainerRate = require("../models/TrainerRate");
const { FORMATS, FORMAT_RATE_FIELD } = require("./formats");

// ---- Tính bảng lương 1 tháng (mục 7) ----
// Nguyên tắc (chốt 16/08, cập nhật her-35 19/08 — xem testcase_her-12/her-35):
// - CHỈ tính buổi điểm danh THẬT: booking `completed` + `attendanceAt != null`
//   (buổi sweep tự hoàn tất có attendanceAt null — không tính, thiết kế her-10).
// - Buổi thuộc tháng theo startAt (giờ máy — VN). HLV của buổi = booking.trainerId
//   (đổi HLV thì người dạy thật hưởng — trainerId đã sync ở schedule.routes).
// - 1 "buổi" = 1 lớp (classId); LOẠI HÌNH buổi đọc từ snapshot `format` của booking
//   — KHÔNG so chuỗi title.
// - per "session": đếm buổi; per "attendee": đếm KHÁCH có mặt (no_show không tính).
// - Mức áp theo bản ghi TrainerRate có effectiveFrom <= startAt buổi (gần nhất);
//   chưa từng thiết lập -> 0đ. Lương cứng: bản ghi hiệu lực MỚI NHẤT trong tháng.

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function monthRange(month) {
  if (typeof month !== "string" || !MONTH_RE.test(month)) return null;
  const [y, m] = month.split("-").map(Number);
  if (y < 2020 || y > 2099) return null; // chặn năm rác (vd "0026" bị Date map về 19xx)
  return { from: new Date(y, m - 1, 1), to: new Date(y, m, 1) };
}

// Bản ghi mức hiệu lực tại thời điểm `at` (rates đã sort tăng theo effectiveFrom)
function rateAt(rates, at) {
  let found = null;
  for (const r of rates) {
    if (r.effectiveFrom <= at) found = r;
    else break;
  }
  return found;
}

async function computeMonth(month) {
  const range = monthRange(month);
  if (!range) return null;

  const [trainers, allRates, bookings] = await Promise.all([
    Trainer.find({}).sort({ name: 1 }),
    TrainerRate.find({ effectiveFrom: { $lt: range.to } }).sort({ effectiveFrom: 1 }),
    Booking.find({
      status: "completed",
      attendanceAt: { $ne: null },
      startAt: { $gte: range.from, $lt: range.to },
      classId: { $ne: null }, // DB thật chưa reseed có thể còn booking PT cũ không classId
    }).select("trainerId classId format startAt"),
  ]);

  const ratesByTrainer = {};
  for (const r of allRates) {
    (ratesByTrainer[r.trainerId.toString()] = ratesByTrainer[r.trainerId.toString()] || []).push(r);
  }

  // Gom booking thành "buổi" theo classId cho từng HLV — nhiều khách cùng lớp = 1 buổi.
  // Loại hình lấy từ snapshot format của booking (mọi booking cùng lớp có cùng format:
  // lớp đã có khách đặt thì KHÔNG đổi được loại hình — schedule.routes chặn).
  const sessionsByTrainer = {}; // trainerId -> Map classId -> { format, startAt, attendees }
  for (const b of bookings) {
    if (!b.classId || !b.format) continue; // booking cũ/rác thiếu snapshot — bỏ qua, không cho 500 cả bảng lương
    const tid = b.trainerId.toString();
    const key = b.classId.toString();
    const map = (sessionsByTrainer[tid] = sessionsByTrainer[tid] || new Map());
    if (!map.has(key)) map.set(key, { format: b.format, startAt: b.startAt, attendees: 0 });
    map.get(key).attendees += 1;
  }

  // HLV có buổi dạy nhưng hồ sơ Trainer không còn (dữ liệu bất thường) -> vẫn hiện 1 dòng
  // "(HLV đã gỡ hồ sơ)" thay vì rơi im lặng khỏi bảng (review her-12 V3)
  const known = new Set(trainers.map((t) => t._id.toString()));
  const ghostRows = Object.keys(sessionsByTrainer)
    .filter((tid) => !known.has(tid))
    .map((tid) => ({ _id: new mongoose.Types.ObjectId(tid), name: "(HLV đã gỡ hồ sơ)" }));

  const entries = [...trainers, ...ghostRows].map((t) => {
    const tid = t._id.toString();
    const rates = ratesByTrainer[tid] || [];
    const entry = {
      trainerId: t._id,
      trainerName: t.name,
      baseSalary: 0,
      byFormat: Object.fromEntries(FORMATS.map((f) => [f, { count: 0, amount: 0, per: "session" }])),
      commission: 0,
      total: 0,
    };
    // Lương cứng + per hiển thị: theo bản ghi hiệu lực mới nhất trong tháng.
    // LƯU Ý (hành vi có từ her-12, KHÔNG phải bug): nếu admin đổi cách tính GIỮA THÁNG thì
    // count là số HỖN HỢP (buổi trước ngày đổi tính theo cách cũ) trong khi nhãn `per` hiển thị
    // theo bản ghi MỚI NHẤT — tiền vẫn đúng vì mỗi buổi áp mức tại ngày diễn ra.
    const current = rateAt(rates, new Date(range.to.getTime() - 1));
    if (current) {
      entry.baseSalary = current.baseSalary;
      for (const f of FORMATS) entry.byFormat[f].per = current[`${FORMAT_RATE_FIELD[f]}Per`];
    }

    for (const s of (sessionsByTrainer[tid] || new Map()).values()) {
      const field = FORMAT_RATE_FIELD[s.format];
      if (!field) continue; // booking dữ liệu cũ thiếu/lạ loại hình — bỏ qua, không làm hỏng bảng
      const rate = rateAt(rates, s.startAt);
      const per = rate ? rate[`${field}Per`] : "session";
      const units = per === "attendee" ? s.attendees : 1;
      const slot = entry.byFormat[s.format];
      slot.count += units;
      slot.amount += units * (rate ? rate[`${field}Amount`] : 0);
    }
    entry.commission = FORMATS.reduce((sum, f) => sum + entry.byFormat[f].amount, 0);
    entry.total = entry.baseSalary + entry.commission;
    return entry;
  });

  return { month, entries };
}

module.exports = { computeMonth, monthRange, MONTH_RE };
