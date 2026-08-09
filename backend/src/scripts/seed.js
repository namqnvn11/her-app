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
  ]);
  // Đảm bảo unique index chống đặt trùng tồn tại trong DB trước khi server nhận request
  await Booking.syncIndexes();

  console.log("Tạo HLV...");
  const [linh, duc, thu] = await Trainer.create([
    { name: "HLV Linh", specialty: "Pilates & Mobility", rating: 4.9 },
    { name: "HLV Đức", specialty: "Strength & Gym", rating: 4.8 },
    { name: "HLV Thu", specialty: "Yoga & Recovery", rating: 5.0 },
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
  const [pkgMinhAnh, pkgThaoVy] = await Package.create([
    {
      userId: customer1._id,
      name: "Pilates Unlimited 3T",
      price: 2_400_000,
      totalSessions: 24,
      // = số booking đang "tiêu" buổi: 2 buổi sắp tới + 2 buổi đã tập (buổi hủy đã được hoàn)
      usedSessions: 4,
      activatedAt: atHour(-30, 0),
      expiresAt: atHour(60, 0),
    },
    {
      userId: customer2._id,
      name: "Yoga Basic 1T",
      price: 900_000,
      totalSessions: 8,
      usedSessions: 1,
      activatedAt: atHour(-5, 0),
      expiresAt: atHour(25, 0),
    },
  ]);

  console.log("Tạo lớp Group cho 7 ngày tới...");
  const classTemplates = [
    { name: "Pilates Reformer", coach: linh, hour: 7 },
    { name: "Vinyasa Yoga", coach: thu, hour: 9 },
    { name: "Gym Circuit", coach: duc, hour: 18 },
    { name: "Mat Pilates", coach: linh, hour: 19, minute: 30 },
  ];
  const classDocs = [];
  for (let day = 0; day <= 6; day++) {
    for (const t of classTemplates) {
      classDocs.push({
        name: t.name,
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
          isBooked: false,
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
    isBooked: true,
  });
  await Booking.create({
    userId: customer1._id,
    type: "pt",
    slotId: soonSlot._id,
    trainerId: soonTrainer._id,
    title: `1:1 PT — ${soonTrainer.name}`,
    startAt: soonSlot.startAt,
    endAt: soonSlot.endAt,
    packageId: pkgMinhAnh._id,
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
