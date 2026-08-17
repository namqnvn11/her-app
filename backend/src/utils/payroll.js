const mongoose = require("mongoose");
const Booking = require("../models/Booking");
const Trainer = require("../models/Trainer");
const TrainerRate = require("../models/TrainerRate");

// ---- Tính bảng lương 1 tháng (mục 7) ----
// Nguyên tắc (chốt 16/08, xem testcase_her-12):
// - CHỈ tính buổi điểm danh THẬT: booking `completed` + `attendanceAt != null`
//   (buổi sweep tự hoàn tất có attendanceAt null — không tính, thiết kế her-10).
// - Buổi thuộc tháng theo startAt (giờ máy — VN). HLV của buổi = booking.trainerId
//   (đổi HLV thì người dạy thật hưởng — title/trainerId đã sync ở schedule.routes).
// - 1 "buổi" lớp nhóm = 1 classId; 1 "buổi" PT = 1 slotId; PT nhóm vs 1:1 phân theo
//   title snapshot ("PT nhóm — ..." — giữ đúng dạng qua các lần đổi HLV/capacity, her-11).
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
    }).select("trainerId type classId slotId title startAt"),
  ]);

  const ratesByTrainer = {};
  for (const r of allRates) {
    (ratesByTrainer[r.trainerId.toString()] = ratesByTrainer[r.trainerId.toString()] || []).push(r);
  }

  // Gom booking thành "buổi" theo classId/slotId cho từng HLV
  const sessionsByTrainer = {}; // trainerId -> Map key -> { kind, startAt, attendees }
  for (const b of bookings) {
    const tid = b.trainerId.toString();
    // Gộp theo classId/slotId — KHÔNG đưa kind vào key (review her-12 V2: khung 1:1 nâng lên
    // nhóm giữa chừng làm title các booking cùng slot khác nhau; kind chốt sau khi gộp —
    // có bất kỳ booking "PT nhóm" nào thì cả buổi là PT nhóm, không tách thành 2 buổi)
    const key = `${b.type}:${(b.classId || b.slotId || b._id).toString()}`;
    const map = (sessionsByTrainer[tid] = sessionsByTrainer[tid] || new Map());
    if (!map.has(key)) {
      map.set(key, { kind: b.type === "group" ? "group" : "pt1", startAt: b.startAt, attendees: 0 });
    }
    const sess = map.get(key);
    if (b.type !== "group" && (b.title || "").startsWith("PT nhóm")) sess.kind = "ptGroup";
    sess.attendees += 1;
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
      group: { count: 0, amount: 0, per: "session" },
      pt1: { count: 0, amount: 0 },
      ptGroup: { count: 0, amount: 0, per: "session" },
      commission: 0,
      total: 0,
    };
    // Lương cứng + per hiển thị: theo bản ghi hiệu lực mới nhất trong tháng
    const current = rateAt(rates, new Date(range.to.getTime() - 1));
    if (current) {
      entry.baseSalary = current.baseSalary;
      entry.group.per = current.groupPer;
      entry.ptGroup.per = current.ptGroupPer;
    }

    for (const s of (sessionsByTrainer[tid] || new Map()).values()) {
      const rate = rateAt(rates, s.startAt);
      if (s.kind === "group") {
        const per = rate ? rate.groupPer : "session";
        const units = per === "attendee" ? s.attendees : 1;
        entry.group.count += units;
        entry.group.amount += units * (rate ? rate.groupAmount : 0);
      } else if (s.kind === "pt1") {
        entry.pt1.count += 1;
        entry.pt1.amount += rate ? rate.pt1Amount : 0;
      } else {
        const per = rate ? rate.ptGroupPer : "session";
        const units = per === "attendee" ? s.attendees : 1;
        entry.ptGroup.count += units;
        entry.ptGroup.amount += units * (rate ? rate.ptGroupAmount : 0);
      }
    }
    entry.commission = entry.group.amount + entry.pt1.amount + entry.ptGroup.amount;
    entry.total = entry.baseSalary + entry.commission;
    return entry;
  });

  return { month, entries };
}

module.exports = { computeMonth, monthRange, MONTH_RE };
