const Booking = require("../models/Booking");
const GymClass = require("../models/GymClass");
const PTSlot = require("../models/PTSlot");
const Package = require("../models/Package");
const User = require("../models/User");
const { computeMonth } = require("./payroll");

// ---- Số liệu màn Tổng quan (mục 8) ----
// Định nghĩa chốt trong plan her-13 (tóm tắt tại testcase_her-13):
// - Admin: báo cáo THÁNG hiện tại — doanh thu = tiền ĐÃ THU của gói bán trong tháng
//   (paidAmount; gói cũ không có field coi là thu đủ), nợ, gói bán chạy; tổng chi lương khớp
//   mục 7 (luôn tính động — 16/08 bỏ chốt); lượt đến THẬT (completed + attendanceAt) + khung giờ
//   đông; bảng HLV (buổi/tỉ lệ đến/thù lao).
// - Lễ tân: vận hành HÔM NAY — không doanh thu/lương (H5).
// - HLV: lịch dạy CỦA MÌNH hôm nay/tuần/tháng.

const fmtTime = (d) =>
  `${String(new Date(d).getHours()).padStart(2, "0")}:${String(new Date(d).getMinutes()).padStart(2, "0")}`;

function monthOf(now) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}
function monthBounds(now) {
  return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: new Date(now.getFullYear(), now.getMonth() + 1, 1) };
}
function dayBounds(now) {
  return { from: new Date(now.getFullYear(), now.getMonth(), now.getDate()), to: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1) };
}

// Buổi "có khách" của 1 HLV trong khoảng thời gian: gom booking active theo classId/slotId
async function trainerSessions(trainerId, from, to) {
  const bookings = await Booking.find({
    trainerId,
    status: { $ne: "cancelled" },
    startAt: { $gte: from, $lt: to },
  }).populate("userId", "name").sort({ startAt: 1 });
  const byKey = new Map();
  for (const b of bookings) {
    const key = `${b.type}:${(b.classId || b.slotId || b._id).toString()}`;
    if (!byKey.has(key)) {
      byKey.set(key, { title: b.title, startAt: b.startAt, endAt: b.endAt, classId: b.classId || null, customers: [] });
    }
    byKey.get(key).customers.push(b.userId?.name || "(đã xoá)");
  }
  return [...byKey.values()].sort((a, b) => a.startAt - b.startAt);
}

// month "YYYY-MM" (tùy chọn) — admin xem lùi các tháng trước; mặc định tháng hiện tại
async function adminDashboard(month) {
  const now = new Date();
  let from;
  let to;
  if (month) {
    const [y, m] = month.split("-").map(Number);
    from = new Date(y, m - 1, 1);
    to = new Date(y, m, 1);
  } else {
    ({ from, to } = monthBounds(now));
  }

  // Doanh thu = tiền THU TRONG THÁNG (nhật ký payments — review her-13 N1: nợ thu muộn phải
  // vào báo cáo tháng THU, không "bốc hơi"). Gói cũ chưa có nhật ký: phần đã thu tính vào
  // tháng bán (createdAt). packagesSold/topPackages vẫn theo tháng bán.
  const pkgs = await Package.find({
    $or: [
      { createdAt: { $gte: from, $lt: to } },
      { payments: { $elemMatch: { at: { $gte: from, $lt: to } } } },
    ],
  }).select("name price paidAmount payments createdAt");
  let revenue = 0;
  let packagesSold = 0;
  const byName = {};
  for (const p of pkgs) {
    const pays = p.payments || [];
    const paysAll = pays.reduce((t, x) => t + x.amount, 0);
    revenue += pays.filter((x) => x.at >= from && x.at < to).reduce((t, x) => t + x.amount, 0);
    if (p.createdAt >= from && p.createdAt < to) {
      packagesSold += 1;
      byName[p.name] = (byName[p.name] || 0) + 1;
      // Phần đã thu KHÔNG có trong nhật ký (gói bán trước đợt này) -> tính vào tháng bán
      const declaredPaid = p.paidAmount == null ? p.price : Math.min(p.paidAmount, p.price);
      revenue += Math.max(declaredPaid - paysAll, 0);
    }
  }
  // Nợ CÒN TỒN toàn bộ (không chỉ gói bán tháng này) — khớp con số "khách nợ" của lễ tân
  const debtAgg = await Package.aggregate([
    { $match: { paidAmount: { $ne: null }, $expr: { $lt: ["$paidAmount", "$price"] } } },
    { $group: { _id: null, d: { $sum: { $subtract: ["$price", "$paidAmount"] } } } },
  ]);
  const debt = debtAgg[0]?.d || 0;
  const topPackages = Object.entries(byName)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, 3);

  // Lương LUÔN tính động (quyết định 16/08 — bỏ cơ chế chốt)
  const payMonth = month || monthOf(now);
  const liveEntries = (await computeMonth(payMonth)).entries;
  const payroll = liveEntries.reduce((t, e) => t + (e.total || 0), 0);

  // Lượt đến thật + khung giờ đông (từ điểm danh — mục 5)
  const attended = await Booking.find({
    status: "completed",
    attendanceAt: { $ne: null },
    startAt: { $gte: from, $lt: to },
  }).select("startAt trainerId type classId slotId");
  const byHour = {};
  for (const b of attended) {
    const h = `${String(b.startAt.getHours()).padStart(2, "0")}:00`;
    byHour[h] = (byHour[h] || 0) + 1;
  }
  const maxHour = Math.max(1, ...Object.values(byHour));
  const peakHours = Object.entries(byHour)
    .map(([time, count]) => ({ time, rate: count / maxHour }))
    .sort((a, b) => b.rate - a.rate || a.time.localeCompare(b.time))
    .slice(0, 4);

  // Bảng HLV: buổi có khách đến + tỉ lệ Đến + thù lao (từ payEntries cho khớp)
  const attendanceAgg = await Booking.aggregate([
    { $match: { attendanceAt: { $ne: null }, status: { $in: ["completed", "no_show"] }, startAt: { $gte: from, $lt: to } } },
    { $group: { _id: { trainerId: "$trainerId", status: "$status" }, n: { $sum: 1 } } },
  ]);
  const attByTrainer = {};
  for (const row of attendanceAgg) {
    const tid = row._id.trainerId.toString();
    const rec = (attByTrainer[tid] = attByTrainer[tid] || { came: 0, missed: 0 });
    if (row._id.status === "completed") rec.came += row.n;
    else rec.missed += row.n;
  }
  // Số BUỔI THẬT từng HLV (distinct lớp/khung có khách đến) — không phụ thuộc cách tính
  // hoa hồng buổi/khách, để cột "X buổi" luôn là số buổi đứng lớp
  const sessionKeysByTrainer = {};
  for (const b of attended) {
    const tid = b.trainerId.toString();
    (sessionKeysByTrainer[tid] = sessionKeysByTrainer[tid] || new Set()).add(
      `${b.type}:${(b.classId || b.slotId || b._id).toString()}`
    );
  }
  const trainers = liveEntries.map((e) => {
    const att = attByTrainer[e.trainerId.toString()] || { came: 0, missed: 0 };
    const denom = att.came + att.missed;
    return {
      trainerId: e.trainerId,
      name: e.trainerName,
      sessions: (sessionKeysByTrainer[e.trainerId.toString()] || new Set()).size,
      attendance: denom === 0 ? 0 : att.came / denom,
      pay: e.total || 0,
    };
  });

  // her-19: tháng XA NHẤT có dữ liệu (gói đầu tiên được bán / buổi điểm danh đầu tiên) —
  // app chỉ cho lùi filter tới đây, không lùi vô hạn về quá khứ trống
  const [firstPkg, firstAtt] = await Promise.all([
    Package.findOne({}).sort({ createdAt: 1 }).select("createdAt"),
    Booking.findOne({ attendanceAt: { $ne: null }, status: "completed" }).sort({ startAt: 1 }).select("startAt"),
  ]);
  const firsts = [firstPkg?.createdAt, firstAtt?.startAt].filter(Boolean);
  const minDate = firsts.length ? new Date(Math.min(...firsts.map((d) => d.getTime()))) : now;
  const minMonth = `${minDate.getFullYear()}-${String(minDate.getMonth() + 1).padStart(2, "0")}`;

  return { revenue, debt, packagesSold, topPackages, payroll, sessions: attended.length, peakHours, trainers, minMonth };
}

async function receptionDashboard(now = new Date()) {
  const { from, to } = dayBounds(now);

  const classes = await GymClass.find({ startAt: { $gte: from, $lt: to } })
    .sort({ startAt: 1 })
    .populate("coachId", "name");
  const bookingsToday = await Booking.countDocuments({ status: { $ne: "cancelled" }, startAt: { $gte: from, $lt: to } });
  const slotsToday = await PTSlot.find({ startAt: { $gte: from, $lt: to } })
    .sort({ startAt: 1 })
    .populate("trainerId", "name");
  // Chỗ trống chỉ tính buổi CHƯA KẾT THÚC — cuối ngày không cộng chỗ của lớp đã qua (review nhẹ)
  const freeSlots =
    classes.filter((c) => c.endAt > now).reduce((t, c) => t + Math.max(c.capacity - c.bookedCount, 0), 0) +
    slotsToday.filter((sl) => sl.endAt > now).reduce((t, sl) => t + Math.max(sl.capacity - sl.bookedCount, 0), 0);

  // Khách còn nợ — đếm theo KHÁCH, bỏ tài khoản ĐÃ KHOÁ (review V4: khách khoá không giao dịch nữa)
  const debtPkgs = await Package.find({ paidAmount: { $ne: null }, $expr: { $lt: ["$paidAmount", "$price"] } }).select("userId");
  const debtUserIds = [...new Set(debtPkgs.map((p) => p.userId.toString()))];
  const unpaid = await User.countDocuments({ _id: { $in: debtUserIds }, isActive: true });

  // Gói sắp hết hạn trong 7 ngày: bỏ gói bảo lưu, gói ĐÃ HẾT BUỔI, và khách bị khoá (V4)
  const soonEnd = new Date(now.getTime() + 7 * 24 * 3600 * 1000);
  const expPkgs = await Package.find({
    pausedAt: null,
    expiresAt: { $gte: now, $lte: soonEnd },
    $or: [{ totalSessions: null }, { $expr: { $lt: ["$usedSessions", "$totalSessions"] } }],
  }).select("userId");
  const expUserIds = [...new Set(expPkgs.map((p) => p.userId.toString()))];
  const activeExpUsers = new Set(
    (await User.find({ _id: { $in: expUserIds }, isActive: true }).select("_id")).map((u) => u._id.toString())
  );
  const expiring = expPkgs.filter((p) => activeExpUsers.has(p.userId.toString())).length;

  const todo = [];
  if (unpaid > 0) todo.push({ title: `${unpaid} khách còn nợ tiền gói`, sub: "Mở thẻ khách → Gói tập & thanh toán để thu" });
  if (expiring > 0) todo.push({ title: `${expiring} gói sắp hết hạn trong 7 ngày`, sub: "Gọi mời khách gia hạn sớm" });

  return {
    classesToday: classes.length,
    bookingsToday,
    freeSlots,
    unpaid,
    // her-30 (chốt 17/08): CÓ KHÁCH mới hiển thị (cả lớp lẫn PT — khung/lớp trống thể hiện
    // qua ô "chỗ trống"); hiện 4 buổi SẮP TỚI (đang diễn ra tính là sắp tới); cuối ngày còn
    // dưới 4 buổi sắp tới thì hiện 4 buổi CUỐI CÙNG của ngày
    today: (() => {
      const all = [
        ...classes.filter((c) => c.bookedCount > 0).map((c) => ({
          startAt: c.startAt,
          endAt: c.endAt,
          time: fmtTime(c.startAt),
          title: c.name,
          coach: c.coachId?.name || "",
          booked: c.bookedCount,
          capacity: c.capacity,
        })),
        // Buổi PT có khách cũng thuộc "Lịch hôm nay" (review nhẹ — trước đây chỉ lớp nhóm)
        ...slotsToday
          .filter((sl) => sl.bookedCount > 0)
          .map((sl) => ({
            startAt: sl.startAt,
            endAt: sl.endAt,
            time: fmtTime(sl.startAt),
            title: sl.capacity > 1 ? "PT nhóm" : "PT 1:1",
            coach: sl.trainerId?.name || "",
            booked: sl.bookedCount,
            capacity: sl.capacity,
          })),
      ].sort((a, b) => a.startAt - b.startAt);
      const upcoming = all.filter((r) => r.endAt > now);
      const chosen = upcoming.length >= 4 ? upcoming.slice(0, 4) : all.slice(-4);
      return chosen.map(({ startAt, endAt, ...row }) => row);
    })(),
    todo,
  };
}

async function trainerDashboard(trainerId, now = new Date()) {
  const day = dayBounds(now);
  const { from: mFrom, to: mTo } = monthBounds(now);
  // Tuần hiện tại: Thứ 2 -> hết CN
  const dow = (now.getDay() + 6) % 7; // 0 = Thứ 2
  const weekFrom = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow);
  const weekTo = new Date(weekFrom.getFullYear(), weekFrom.getMonth(), weekFrom.getDate() + 7);

  const [todaySessions, weekSessions, monthSessions] = await Promise.all([
    trainerSessions(trainerId, day.from, day.to),
    trainerSessions(trainerId, weekFrom, weekTo),
    trainerSessions(trainerId, mFrom, mTo),
  ]);

  const weekMs = weekSessions.reduce((t, s) => t + (new Date(s.endAt) - new Date(s.startAt)), 0);
  const upcoming = todaySessions.filter((s) => new Date(s.endAt) > now);
  const next = upcoming[0]
    ? { time: fmtTime(upcoming[0].startAt), title: upcoming[0].title, customers: upcoming[0].customers, classId: upcoming[0].classId || null }
    : null;
  const rest = upcoming.slice(1).map((s) => ({ time: fmtTime(s.startAt), title: s.title, sub: `${s.customers.length} khách` }));

  // Tỉ lệ Đến tháng này (điểm danh thật)
  const [came, missed] = await Promise.all([
    Booking.countDocuments({ trainerId, status: "completed", attendanceAt: { $ne: null }, startAt: { $gte: mFrom, $lt: mTo } }),
    Booking.countDocuments({ trainerId, status: "no_show", attendanceAt: { $ne: null }, startAt: { $gte: mFrom, $lt: mTo } }),
  ]);

  return {
    todayCount: todaySessions.length,
    weekHours: Math.round((weekMs / 3600000) * 10) / 10,
    monthSessions: monthSessions.length,
    next,
    rest,
    attendanceRate: came + missed === 0 ? null : came / (came + missed),
  };
}

module.exports = { adminDashboard, receptionDashboard, trainerDashboard };
