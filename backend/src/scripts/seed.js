require("dotenv").config();
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const connectDB = require("../config/db");

const User = require("../models/User");
const Trainer = require("../models/Trainer");
const GymClass = require("../models/GymClass");
const PTSlot = require("../models/PTSlot");
const Package = require("../models/Package");
const Booking = require("../models/Booking");
const TrainerRate = require("../models/TrainerRate");
const Discipline = require("../models/Discipline");
const { MIN_CANCEL_HOURS } = require("../utils/cancelRule");

function atHour(daysFromNow, hour, minute = 0) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  d.setHours(hour, minute, 0, 0);
  return d;
}

async function run() {
  await connectDB();

  console.log("Đang xoá dữ liệu cũ...");
  await Promise.all([
    User.deleteMany({}),
    Trainer.deleteMany({}),
    GymClass.deleteMany({}),
    PTSlot.deleteMany({}),
    Package.deleteMany({}),
    Booking.deleteMany({}),
    TrainerRate.deleteMany({}),
    Discipline.deleteMany({}),
    require("../models/AutoScheduleRule").deleteMany({}),
    require("../models/AutoScheduleLog").deleteMany({}),
  ]);
  // Đảm bảo unique index chống đặt trùng tồn tại trong DB trước khi server nhận request
  await Booking.syncIndexes();

  console.log("Tạo HLV...");
  // Danh mục bộ môn (her-19) — thêm môn mới chỉ cần thêm document ở đây/DB
  await Discipline.create([
    { key: "pilates", label: "Pilates", order: 1 },
    { key: "yoga", label: "Yoga", order: 2 },
    { key: "gym", label: "Gym", order: 3 },
  ]);

  const [linh, duc, thu] = await Trainer.create([
    { name: "HLV Linh", specialty: "Pilates", specialties: ["pilates"], rating: 4.9 },
    { name: "HLV Đức", specialty: "Gym", specialties: ["gym"], rating: 4.8 },
    { name: "HLV Thu", specialty: "Yoga", specialties: ["yoga"], rating: 5.0 },
  ]);

  console.log("Tạo tài khoản mẫu...");
  const passHash = await bcrypt.hash("123456", 10);

  const admin = await User.create({
    name: "Chủ phòng tập",
    phone: "0999999999",
    passwordHash: passHash,
    role: "admin",
  });

  // Chỉ cần vài tài khoản lễ tân ban đầu — do admin/seed tạo.
  const staff = await User.create({
    name: "Lễ tân Mai",
    phone: "0900000000",
    passwordHash: passHash,
    role: "reception",
    createdBy: admin._id,
  });

  // Tài khoản HLV — trong thực tế do lễ tân tạo qua /api/accounts, ở đây seed cho demo.
  const trainerAccount = await User.create({
    name: linh.name,
    phone: "0911111111",
    passwordHash: passHash,
    role: "trainer",
    trainerId: linh._id,
    createdBy: staff._id,
  });

  const customer1 = await User.create({
    name: "Minh Anh",
    phone: "0909090909",
    passwordHash: passHash,
    role: "customer",
  });

  const customer2 = await User.create({
    name: "Thảo Vy",
    phone: "0912345678",
    passwordHash: passHash,
    role: "customer",
  });

  console.log("Tạo gói tập...");
  // 4 gói demo phủ đủ 3 kiểu gói (Q3) + 4 loại hình (Q1); Yoga của Thảo Vy còn NỢ (Q10)
  const [pkgMinhAnh, pkgMinhAnhPT, pkgThaoVy, pkgThaoVyGym] = await Package.create([
    {
      userId: customer1._id,
      name: "Pilates 24 buổi — 3 tháng",
      serviceType: "pilates",
      price: 2_400_000,
      // = số booking đang "tiêu" buổi gói này: 1 buổi group sắp tới + 2 buổi đã tập
      totalSessions: 24,
      usedSessions: 3,
      activatedAt: atHour(-30, 0),
      expiresAt: atHour(60, 0),
      paymentMethod: "transfer",
      paidAmount: 2_400_000,
    },
    {
      // Kiểu "chỉ số buổi, KHÔNG thời hạn": buổi PT sắp tới trừ gói này
      userId: customer1._id,
      name: "PT 1:1 — 10 buổi",
      serviceType: "pt",
      price: 5_000_000,
      totalSessions: 10,
      usedSessions: 1,
      activatedAt: atHour(-10, 0),
      expiresAt: null,
      paymentMethod: "cash",
      paidAmount: 5_000_000,
    },
    {
      userId: customer2._id,
      name: "Yoga Basic 1T",
      serviceType: "yoga",
      price: 900_000,
      totalSessions: 8,
      usedSessions: 1,
      activatedAt: atHour(-5, 0),
      expiresAt: atHour(25, 0),
      // Demo khách còn nợ tiền gói (Q10 — vẫn đặt lịch bình thường)
      paymentMethod: "cash",
      paidAmount: 500_000,
    },
    {
      // Kiểu "chỉ thời hạn, KHÔNG giới hạn buổi"
      userId: customer2._id,
      name: "Gym Unlimited 1T",
      serviceType: "gym",
      price: 1_200_000,
      totalSessions: null,
      usedSessions: 0,
      activatedAt: atHour(-5, 0),
      expiresAt: atHour(25, 0),
      paymentMethod: "transfer",
      paidAmount: 1_200_000,
    },
  ]);

  console.log("Tạo lớp Group cho 7 ngày tới...");
  const classTemplates = [
    { name: "Pilates Reformer", serviceType: "pilates", coach: linh, hour: 7 },
    { name: "Vinyasa Yoga", serviceType: "yoga", coach: thu, hour: 9 },
    { name: "Gym Circuit", serviceType: "gym", coach: duc, hour: 18 },
    { name: "Mat Pilates", serviceType: "pilates", coach: linh, hour: 19, minute: 30 },
  ];
  const classDocs = [];
  for (let day = 0; day <= 6; day++) {
    for (const t of classTemplates) {
      classDocs.push({
        name: t.name,
        serviceType: t.serviceType,
        coachId: t.coach._id,
        startAt: atHour(day, t.hour, t.minute || 0),
        endAt: atHour(day, t.hour + 1, t.minute || 0),
        capacity: t.name === "Gym Circuit" ? 12 : t.name === "Vinyasa Yoga" ? 10 : 8,
        bookedCount: 0,
      });
    }
  }
  const classes = await GymClass.create(classDocs);

  console.log("Tạo khung giờ PT cho 7 ngày tới...");
  // Giờ PT không được đè lên giờ lớp Group của chính HLV đó
  // (Linh dạy 7h + 19:30; Đức dạy 18h; Thu dạy 9h)
  const trainerSlotHours = {
    [linh._id.toString()]: [8, 10, 15],
    [duc._id.toString()]: [7, 17, 19],
    [thu._id.toString()]: [11, 14, 16],
  };
  const slotDocs = [];
  for (let day = 0; day <= 6; day++) {
    for (const trainer of [linh, duc, thu]) {
      for (const hour of trainerSlotHours[trainer._id.toString()]) {
        slotDocs.push({
          trainerId: trainer._id,
          startAt: atHour(day, hour),
          endAt: atHour(day, hour + 1),
          capacity: 1,
          bookedCount: 0,
        });
      }
    }
  }
  const slots = await PTSlot.create(slotDocs);

  console.log("Tạo một vài lịch đặt mẫu...");
  // Đặt trước 1 buổi Pilates Reformer ngày mai cho Minh Anh (còn đủ 3h -> huỷ được)
  const tomorrowPilates = classes.find(
    (c) => c.name === "Pilates Reformer" && c.startAt.toDateString() === atHour(1, 0).toDateString()
  );
  if (tomorrowPilates) {
    tomorrowPilates.bookedCount += 1;
    await tomorrowPilates.save();
    await Booking.create({
      userId: customer1._id,
      type: "group",
      classId: tomorrowPilates._id,
      trainerId: linh._id,
      title: tomorrowPilates.name,
      startAt: tomorrowPilates.startAt,
      endAt: tomorrowPilates.endAt,
      packageId: pkgMinhAnh._id,
    });
  }

  // Đặt PT giờ bắt đầu luôn cách hiện tại NỬA số giờ tối thiểu — để kịch bản "nút Hủy bị
  // khoá" luôn đúng bất kể chạy seed vào giờ nào. Chọn HLV đang RẢNH khung đó (không đè
  // lên lớp/slot có sẵn của họ); cả 3 đều bận thì dịch 30 phút tới khi có người rảnh.
  const busy = (trainer, start, end) =>
    classDocs.some((c) => c.coachId.equals(trainer._id) && c.startAt < end && c.endAt > start) ||
    slotDocs.some((sl) => sl.trainerId.equals(trainer._id) && sl.startAt < end && sl.endAt > start);

  let soonStart = new Date(Date.now() + Math.max(MIN_CANCEL_HOURS * 0.5, 0.5) * 3600 * 1000);
  let soonTrainer = null;
  for (let shift = 0; shift < 48 && !soonTrainer; shift++) {
    const end = new Date(soonStart.getTime() + 3600 * 1000);
    soonTrainer = [duc, linh, thu].find((t) => !busy(t, soonStart, end)) || null;
    if (!soonTrainer) soonStart = new Date(soonStart.getTime() + 30 * 60 * 1000);
  }
  soonTrainer = soonTrainer || duc; // không bao giờ xảy ra, nhưng không để seed chết

  const soonSlot = await PTSlot.create({
    trainerId: soonTrainer._id,
    startAt: soonStart,
    endAt: new Date(soonStart.getTime() + 3600 * 1000),
    capacity: 1,
    bookedCount: 1,
  });
  await Booking.create({
    userId: customer1._id,
    type: "pt",
    slotId: soonSlot._id,
    trainerId: soonTrainer._id,
    title: `1:1 PT — ${soonTrainer.name}`,
    startAt: soonSlot.startAt,
    endAt: soonSlot.endAt,
    packageId: pkgMinhAnhPT._id, // buổi PT tiêu gói PT (H7)
  });

  // Một buổi Yoga cho Thảo Vy
  const vyClass = classes.find((c) => c.name === "Vinyasa Yoga" && c.startAt > new Date());
  if (vyClass) {
    vyClass.bookedCount += 1;
    await vyClass.save();
    await Booking.create({
      userId: customer2._id,
      type: "group",
      classId: vyClass._id,
      trainerId: thu._id,
      title: vyClass.name,
      startAt: vyClass.startAt,
      endAt: vyClass.endAt,
      packageId: pkgThaoVy._id,
    });
  }

  // Lịch sử: một buổi đã tập, một buổi đã hủy (startAt trong quá khứ)
  await Booking.create([
    {
      userId: customer1._id,
      type: "group",
      trainerId: duc._id,
      title: "Gym Circuit",
      startAt: atHour(-4, 18),
      endAt: atHour(-4, 19),
      status: "completed",
    },
    {
      userId: customer1._id,
      type: "group",
      trainerId: linh._id,
      title: "Mat Pilates",
      startAt: atHour(-7, 19, 30),
      endAt: atHour(-7, 20, 30),
      status: "completed",
    },
    {
      userId: customer1._id,
      type: "group",
      trainerId: thu._id,
      title: "Vinyasa Yoga",
      startAt: atHour(-11, 9),
      endAt: atHour(-11, 10),
      status: "cancelled",
      cancelledAt: atHour(-12, 9),
      cancelledBy: "customer",
    },
  ]);


  // ---- her-17: DỮ LIỆU DEMO cho báo cáo (mức thù lao + lịch sử điểm danh trong tháng) ----
  // Để màn Tổng quan admin có "Khung giờ đông nhất", "Thù lao HLV", "lượt đến tập"... ngay
  // sau khi seed — góp ý chủ dự án 16/08. Buổi lịch sử nằm ở các ngày TRƯỚC hôm nay của
  // THÁNG HIỆN TẠI (nếu đầu tháng quá thì lùi được tới đâu hay tới đó).
  console.log("Tạo mức thù lao + lịch sử điểm danh demo...");
  await TrainerRate.create([
    { trainerId: linh._id, baseSalary: 5000000, groupAmount: 0, groupPer: "session", pt1Amount: 300000, ptGroupAmount: 150000, ptGroupPer: "attendee", effectiveFrom: new Date(2026, 0, 1) },
    { trainerId: duc._id, baseSalary: 0, groupAmount: 50000, groupPer: "attendee", pt1Amount: 250000, ptGroupAmount: 0, ptGroupPer: "session", effectiveFrom: new Date(2026, 0, 1) },
    { trainerId: thu._id, baseSalary: 4000000, groupAmount: 0, groupPer: "session", pt1Amount: 0, ptGroupAmount: 0, ptGroupPer: "session", effectiveFrom: new Date(2026, 0, 1) },
  ]);

  const histNow = new Date();
  const histDay = (offset, hour) => {
    const d = Math.max(1, histNow.getDate() - offset);
    return new Date(histNow.getFullYear(), histNow.getMonth(), d, hour, 0, 0);
  };
  // 1 buổi lịch sử = lớp/khung + các booking completed (đã điểm danh Đến) ± vài no_show.
  // daysAgo: lùi tuyệt đối N ngày (vắt được qua tháng trước — cho tab Lịch sử dày dữ liệu);
  // offset: ngày-trong-tháng-này như cũ (giữ cho chart "Khung giờ đông nhất")
  const makeHistory = async ({ trainer, kind, offset, daysAgo, hour, came, missed = 0, serviceType = "pilates" }) => {
    let start;
    if (daysAgo != null) {
      start = new Date(histNow.getTime() - daysAgo * 24 * 3600 * 1000);
      start.setHours(hour, 0, 0, 0);
    } else {
      start = histDay(offset, hour);
    }
    if (start >= histNow) return; // ngày 1 đầu tháng có thể rơi vào tương lai của hôm nay -> bỏ
    const end = new Date(start.getTime() + 3600 * 1000);
    let classId = null;
    let slotId = null;
    let title;
    if (kind === "group") {
      const cls = await GymClass.create({
        name: serviceType === "yoga" ? "Vinyasa Yoga" : serviceType === "gym" ? "Gym Circuit" : "Pilates Reformer",
        serviceType, coachId: trainer._id, startAt: start, endAt: end, capacity: 10, bookedCount: came + missed,
      });
      classId = cls._id;
      title = cls.name;
    } else {
      const slot = await PTSlot.create({ trainerId: trainer._id, startAt: start, endAt: end, capacity: kind === "ptGroup" ? 3 : 1, bookedCount: came + missed });
      slotId = slot._id;
      title = kind === "ptGroup" ? `PT nhóm — ${trainer.name}` : `1:1 PT — ${trainer.name}`;
    }
    const docs = [];
    for (let i = 0; i < came + missed; i++) {
      docs.push({
        userId: i % 2 === 0 ? customer1._id : customer2._id,
        type: kind === "group" ? "group" : "pt",
        classId, slotId, trainerId: trainer._id, title,
        startAt: start, endAt: end,
        status: i < came ? "completed" : "no_show",
        attendanceAt: start, // điểm danh THẬT — được tính hoa hồng/thống kê
        attendanceBy: staff._id,
      });
    }
    await Booking.insertMany(docs);
  };
  // Khung 7h đông nhất, 18h nhì, 9h/15h thưa — chart "Khung giờ đông nhất" có hình dạng rõ
  await makeHistory({ trainer: duc, kind: "group", offset: 1, hour: 7, came: 4, missed: 1 });
  await makeHistory({ trainer: duc, kind: "group", offset: 3, hour: 7, came: 4 });
  await makeHistory({ trainer: thu, kind: "group", offset: 2, hour: 18, came: 3, missed: 1, serviceType: "yoga" });
  await makeHistory({ trainer: thu, kind: "group", offset: 4, hour: 18, came: 2, serviceType: "yoga" });
  await makeHistory({ trainer: linh, kind: "pt1", offset: 1, hour: 9, came: 1 });
  await makeHistory({ trainer: linh, kind: "pt1", offset: 2, hour: 9, came: 1 });
  await makeHistory({ trainer: linh, kind: "ptGroup", offset: 3, hour: 15, came: 2 });

  // her-27 (góp ý 16/08): thêm ~50 buổi lịch sử trải ~8 tuần về trước (vắt qua tháng trước)
  // để tab Lịch sử đủ dày mà thử cuộn-tự-tải. Xoay vòng HLV/loại buổi/giờ, số liệu cố định
  // (không random — seed chạy lại vẫn y hệt).
  const HIST_HOURS = [7, 9, 15, 18, 19];
  const HIST_PLANS = [
    { trainer: duc, kind: "group", serviceType: "gym" },
    { trainer: linh, kind: "group", serviceType: "pilates" },
    { trainer: thu, kind: "group", serviceType: "yoga" },
    { trainer: linh, kind: "pt1" },
    { trainer: duc, kind: "pt1" },
    { trainer: linh, kind: "ptGroup" },
  ];
  for (let i = 0; i < 50; i++) {
    await makeHistory({
      ...HIST_PLANS[i % HIST_PLANS.length],
      daysAgo: 6 + i,
      hour: HIST_HOURS[i % HIST_HOURS.length],
      came: 1 + (i % 3),
      missed: i % 5 === 0 ? 1 : 0,
    });
  }

  console.log("\nXong! Tài khoản demo (mật khẩu chung: 123456):");
  console.log("  Admin      :", admin.phone);
  console.log("  Lễ tân     :", staff.phone);
  console.log("  HLV        :", trainerAccount.phone, "(HLV Linh)");
  console.log("  Khách 1    :", customer1.phone, "(Minh Anh)");
  console.log("  Khách 2    :", customer2.phone, "(Thảo Vy)");

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
