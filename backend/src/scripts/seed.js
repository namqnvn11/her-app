require("dotenv").config();
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const connectDB = require("../config/db");

const User = require("../models/User");
const Trainer = require("../models/Trainer");
const GymClass = require("../models/GymClass");
const Package = require("../models/Package");
const Booking = require("../models/Booking");
const TrainerRate = require("../models/TrainerRate");
const Discipline = require("../models/Discipline");
const { MIN_CANCEL_HOURS } = require("../utils/cancelRule");
const { FORMAT_CAPACITY } = require("../utils/formats");

// her-35: mọi buổi tập đều là 1 LỚP có BỘ MÔN + LOẠI HÌNH (1:1/1:2/1:4/1:8);
// sức chứa luôn = FORMAT_CAPACITY[format]. Không còn khung PT riêng.

// Nhãn bộ môn dùng đặt tên lớp demo (khớp danh mục tạo bên dưới)
const LABELS = {
  gym: "Gym",
  boxing: "Boxing",
  stretching: "Stretching",
  pilates: "Pilates",
  yoga: "Yoga",
};

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
    Package.deleteMany({}),
    Booking.deleteMany({}),
    TrainerRate.deleteMany({}),
    Discipline.deleteMany({}),
    require("../models/AutoScheduleRule").deleteMany({}),
    require("../models/AutoScheduleLog").deleteMany({}),
    require("../models/Setting").deleteMany({}), // her-47: cài đặt admin về mặc định env
    require("../models/Lead").deleteMany({}), // her-48: khách hẹn tư vấn từ web — demo/test về trạng thái sạch
  ]);
  // Đảm bảo unique index chống đặt trùng tồn tại trong DB trước khi server nhận request.
  // syncIndexes cũng DROP 2 unique index cũ thời còn PT slot (userId+classId bản type:"group",
  // userId+slotId) — DB cũ nâng cấp lên her-35 phải chạy seed hoặc drop tay 2 index đó.
  await Booking.syncIndexes();
  await require("../models/Setting").syncIndexes(); // her-47: unique key -> 2 PATCH song song lần đầu vẫn 1 document

  console.log("Tạo HLV...");
  // Danh mục bộ môn (her-19, her-35: 5 môn) — thêm môn mới chỉ cần thêm document ở đây/DB
  await Discipline.create([
    { key: "gym", label: "Gym", order: 1 },
    { key: "boxing", label: "Boxing", order: 2 },
    { key: "stretching", label: "Stretching", order: 3 },
    { key: "pilates", label: "Pilates", order: 4 },
    { key: "yoga", label: "Yoga", order: 5 },
  ]);

  const [linh, duc, thu] = await Trainer.create([
    { name: "HLV Linh", specialty: "Pilates · Stretching", specialties: ["pilates", "stretching"], rating: 4.9 },
    { name: "HLV Đức", specialty: "Gym · Boxing", specialties: ["gym", "boxing"], rating: 4.8 },
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
  // 5 gói demo phủ đủ 3 kiểu gói (Q3), đủ 4 LOẠI HÌNH và gói MIX nhiều bộ môn (her-35);
  // gói Yoga của Thảo Vy còn NỢ tiền (Q10 — vẫn đặt lịch bình thường).
  // Bất biến của bộ demo: MỖI gói đều có ít nhất 1 lớp khớp (bộ môn + loại hình) còn chỗ
  // trong lưới 7 ngày bên dưới — mở app lên là đặt thử được ngay.
  const [pkgMix, pkgPilatesDoi, pkgPilatesNhom, pkgYoga, pkgBoxing] = await Package.create([
    {
      // Gói MIX: 3 bộ môn dùng chung 1 loại hình 1:1 — buổi gym/pilates/stretching 1:1 đều trừ gói này
      userId: customer1._id,
      name: "Mix Gym·Pilates·Stretching 24 buổi",
      serviceTypes: ["gym", "pilates", "stretching"],
      format: "1:1",
      price: 12_000_000,
      totalSessions: 24,
      // = số booking đang giữ chỗ tiêu gói này (buổi sát giờ + Pilates 1:1 ngày mai + Gym 1:1 ngày kia)
      usedSessions: 3,
      activatedAt: atHour(-30, 0),
      expiresAt: atHour(60, 0),
      paymentMethod: "transfer",
      paidAmount: 12_000_000,
      payments: [{ amount: 12_000_000, at: atHour(-30, 0), by: staff._id }],
    },
    {
      // Kiểu "chỉ số buổi, KHÔNG thời hạn"
      userId: customer1._id,
      name: "Pilates đôi 10 buổi",
      serviceTypes: ["pilates"],
      format: "1:2",
      price: 5_000_000,
      totalSessions: 10,
      usedSessions: 1, // buổi Pilates 1:2 đã đặt trong lưới 7 ngày
      activatedAt: atHour(-10, 0),
      expiresAt: null,
      paymentMethod: "cash",
      paidAmount: 5_000_000,
      payments: [{ amount: 5_000_000, at: atHour(-10, 0), by: staff._id }],
    },
    {
      // Kiểu "buổi + thời hạn" cho loại hình nhóm 1:4 — để lớp Pilates 1:4 có khách demo đặt được
      userId: customer1._id,
      name: "Pilates nhóm 1:4 — 12 buổi",
      serviceTypes: ["pilates"],
      format: "1:4",
      price: 3_600_000,
      totalSessions: 12,
      usedSessions: 1, // buổi Pilates 1:4 đã đặt trong lưới 7 ngày
      activatedAt: atHour(-15, 0),
      expiresAt: atHour(45, 0),
      paymentMethod: "transfer",
      paidAmount: 3_600_000,
      payments: [{ amount: 3_600_000, at: atHour(-15, 0), by: staff._id }],
    },
    {
      // Kiểu "chỉ thời hạn, KHÔNG giới hạn buổi" — her-35: chỉ Yoga 1:8 mới được kiểu này
      userId: customer2._id,
      name: "Yoga 1 tháng",
      serviceTypes: ["yoga"],
      format: "1:8",
      price: 1_200_000,
      totalSessions: null,
      usedSessions: 1,
      activatedAt: atHour(-5, 0),
      expiresAt: atHour(30, 0),
      // Demo khách còn nợ 400.000đ (Q10 — vẫn đặt lịch bình thường)
      paymentMethod: "cash",
      paidAmount: 800_000,
      payments: [{ amount: 800_000, at: atHour(-5, 0), by: staff._id }],
    },
    {
      userId: customer2._id,
      name: "Boxing 10 buổi",
      serviceTypes: ["boxing"],
      format: "1:1",
      price: 6_000_000,
      totalSessions: 10,
      usedSessions: 1,
      activatedAt: atHour(-8, 0),
      expiresAt: null,
      paymentMethod: "transfer",
      paidAmount: 6_000_000,
      payments: [{ amount: 6_000_000, at: atHour(-8, 0), by: staff._id }],
    },
  ]);

  console.log("Tạo lịch 7 ngày tới (đủ 4 loại hình)...");
  // Mỗi ngày 6 buổi, tên lớp = nhãn bộ môn, sức chứa theo loại hình.
  // Bất biến của bộ demo: MỖI dòng dưới đây đều có ít nhất 1 khách demo đủ gói để đặt
  // (Gym/Pilates 1:1 → gói Mix; Pilates 1:2 → gói đôi; Pilates 1:4 → gói nhóm;
  //  Boxing 1:1 → gói Boxing của Thảo Vy; Yoga 1:8 → gói Yoga của Thảo Vy).
  // HLV Thu để TRỐNG khung 20:00 mọi ngày (chỗ để demo Lịch tự động).
  const classTemplates = [
    { serviceType: "gym", format: "1:1", coach: duc, hour: 7 },
    { serviceType: "pilates", format: "1:4", coach: linh, hour: 9 },
    { serviceType: "pilates", format: "1:2", coach: linh, hour: 11 },
    { serviceType: "pilates", format: "1:1", coach: linh, hour: 15 },
    { serviceType: "boxing", format: "1:1", coach: duc, hour: 17 },
    { serviceType: "yoga", format: "1:8", coach: thu, hour: 18 },
  ];
  const classDocs = [];
  for (let day = 0; day <= 6; day++) {
    for (const t of classTemplates) {
      classDocs.push({
        name: LABELS[t.serviceType],
        serviceType: t.serviceType,
        format: t.format,
        coachId: t.coach._id,
        startAt: atHour(day, t.hour),
        endAt: atHour(day, t.hour + 1),
        capacity: FORMAT_CAPACITY[t.format],
        bookedCount: 0,
      });
    }
  }
  const classes = await GymClass.create(classDocs);

  console.log("Tạo một vài lịch đặt mẫu...");
  // Đặt 1 buổi cho khách: cộng chỗ vào lớp + ghi booking kèm snapshot bộ môn/loại hình (her-35)
  const bookClass = async (cls, user, pkg) => {
    cls.bookedCount += 1;
    await cls.save();
    await Booking.create({
      userId: user._id,
      classId: cls._id,
      trainerId: cls.coachId,
      title: cls.name,
      serviceType: cls.serviceType,
      format: cls.format,
      startAt: cls.startAt,
      endAt: cls.endAt,
      packageId: pkg._id,
    });
  };

  const findClass = (serviceType, format, day, hour) =>
    classes.find(
      (c) =>
        c.serviceType === serviceType &&
        c.format === format &&
        c.startAt.getTime() === atHour(day, hour).getTime()
    );

  // Minh Anh: 4 loại hình khác nhau, rải qua vài ngày để lịch demo không dồn 1 hôm.
  // Mỗi loại lớp trong lưới đều có khách đặt sẵn, nhưng vẫn còn lớp TRỐNG cùng loại
  // ở ngày khác để bấm thử đặt lịch.
  const pilates11Tomorrow = findClass("pilates", "1:1", 1, 15);
  if (pilates11Tomorrow) await bookClass(pilates11Tomorrow, customer1, pkgMix); // gói Mix
  const pilates14Tomorrow = findClass("pilates", "1:4", 1, 9);
  if (pilates14Tomorrow) await bookClass(pilates14Tomorrow, customer1, pkgPilatesNhom);
  const gym11Day2 = findClass("gym", "1:1", 2, 7);
  if (gym11Day2) await bookClass(gym11Day2, customer1, pkgMix); // gói Mix có bộ môn gym
  const pilates12Day3 = findClass("pilates", "1:2", 3, 11);
  if (pilates12Day3) await bookClass(pilates12Day3, customer1, pkgPilatesDoi);

  // Thảo Vy: Yoga 1:8 + Boxing 1:1 ngày mai
  const yogaTomorrow = findClass("yoga", "1:8", 1, 18);
  if (yogaTomorrow) await bookClass(yogaTomorrow, customer2, pkgYoga);
  const boxingTomorrow = findClass("boxing", "1:1", 1, 17);
  if (boxingTomorrow) await bookClass(boxingTomorrow, customer2, pkgBoxing);

  // Buổi SÁT GIỜ của Minh Anh (L15): bắt đầu cách hiện tại NỬA số giờ tối thiểu — kịch bản
  // "nút Hủy bị khoá" phải đúng BẤT KỂ chạy seed lúc mấy giờ, múi giờ nào (CI chạy UTC — her-47).
  // Buổi phải NẰM TRONG cửa MIN_CANCEL_HOURS nên KHÔNG được dịch giờ ra ngoài cửa; thay vào đó:
  // thử Linh (pilates) rồi Đức (gym — vẫn trừ gói Mix), dịch 30' trong phạm vi còn < cửa;
  // đường cùng (không thực tế) thì cứ lấy Linh ở mốc đầu — demo chấp nhận 2 buổi chồng giờ.
  const coachBusy = (coach, start, end) =>
    classDocs.some((c) => c.coachId.equals(coach._id) && c.startAt < end && c.endAt > start);
  const soonCandidates = [
    { coach: linh, serviceType: "pilates" },
    { coach: duc, serviceType: "gym" },
  ];
  const windowMs = MIN_CANCEL_HOURS * 3600 * 1000;
  const firstStart = new Date(Date.now() + Math.max(MIN_CANCEL_HOURS * 0.5, 0.5) * 3600 * 1000);
  let soonPick = { coach: linh, serviceType: "pilates", start: firstStart }; // fallback đường cùng
  let found = false;
  for (let t = firstStart.getTime(); !found && t - Date.now() < windowMs * 0.9; t += 30 * 60 * 1000) {
    for (const cand of soonCandidates) {
      if (!coachBusy(cand.coach, new Date(t), new Date(t + 3600 * 1000))) {
        soonPick = { ...cand, start: new Date(t) };
        found = true;
        break;
      }
    }
  }
  const soonClass = await GymClass.create({
    name: LABELS[soonPick.serviceType],
    serviceType: soonPick.serviceType,
    format: "1:1",
    coachId: soonPick.coach._id,
    startAt: soonPick.start,
    endAt: new Date(soonPick.start.getTime() + 3600 * 1000),
    capacity: FORMAT_CAPACITY["1:1"],
    bookedCount: 1,
  });
  await Booking.create({
    userId: customer1._id,
    classId: soonClass._id,
    trainerId: soonPick.coach._id,
    title: soonClass.name,
    serviceType: soonPick.serviceType,
    format: "1:1",
    startAt: soonClass.startAt,
    endAt: soonClass.endAt,
    packageId: pkgMix._id, // gym/pilates đều thuộc gói Mix của Minh Anh
  });

  // ---- Lịch sử demo (tab Lịch sử của khách): 2 buổi đã tập + 1 buổi đã hủy ----
  // her-35: buổi lịch sử cũng là LỚP thật (booking bắt buộc có classId).
  // LƯU Ý: mọi buổi lịch sử demo (cả khối her-17/her-27 bên dưới) cố tình KHÔNG gắn
  // packageId và KHÔNG cộng usedSessions — chúng chỉ phục vụ chart Tổng quan + bảng lương.
  // Số buổi đã dùng của từng gói được đối chiếu theo các BOOKING SẮP TỚI ở trên.
  const pastClass = async ({ serviceType, format, coach, daysAgo, hour, bookedCount = 1 }) => {
    const start = atHour(-daysAgo, hour);
    return GymClass.create({
      name: LABELS[serviceType],
      serviceType,
      format,
      coachId: coach._id,
      startAt: start,
      endAt: new Date(start.getTime() + 3600 * 1000),
      capacity: FORMAT_CAPACITY[format],
      bookedCount,
    });
  };

  const doneGym = await pastClass({ serviceType: "gym", format: "1:2", coach: duc, daysAgo: 4, hour: 7 });
  const donePilates = await pastClass({ serviceType: "pilates", format: "1:1", coach: linh, daysAgo: 7, hour: 15 });
  // Buổi đã HỦY: chỗ đã được trả lại nên lớp còn trống
  const cancelledYoga = await pastClass({
    serviceType: "yoga", format: "1:8", coach: thu, daysAgo: 11, hour: 18, bookedCount: 0,
  });

  await Booking.create([
    {
      userId: customer1._id,
      classId: doneGym._id,
      trainerId: duc._id,
      title: doneGym.name,
      serviceType: doneGym.serviceType,
      format: doneGym.format,
      startAt: doneGym.startAt,
      endAt: doneGym.endAt,
      status: "completed",
      attendanceAt: doneGym.startAt,
      attendanceBy: staff._id,
    },
    {
      userId: customer1._id,
      classId: donePilates._id,
      trainerId: linh._id,
      title: donePilates.name,
      serviceType: donePilates.serviceType,
      format: donePilates.format,
      startAt: donePilates.startAt,
      endAt: donePilates.endAt,
      status: "completed",
      attendanceAt: donePilates.startAt,
      attendanceBy: staff._id,
    },
    {
      userId: customer1._id,
      classId: cancelledYoga._id,
      trainerId: thu._id,
      title: cancelledYoga.name,
      serviceType: cancelledYoga.serviceType,
      format: cancelledYoga.format,
      startAt: cancelledYoga.startAt,
      endAt: cancelledYoga.endAt,
      status: "cancelled",
      cancelledAt: atHour(-12, 9),
      cancelledBy: "customer",
    },
  ]);

  // ---- her-17: DỮ LIỆU DEMO cho báo cáo (mức thù lao + lịch sử điểm danh trong tháng) ----
  // Để màn Tổng quan admin có "Khung giờ đông nhất", "Thù lao HLV", "lượt đến tập"... ngay
  // sau khi seed — góp ý chủ dự án 16/08. Buổi lịch sử nằm ở các ngày TRƯỚC hôm nay
  // (seed chạy đầu tháng thì nhóm gần đây rơi sang tháng trước — vẫn đúng dữ liệu thật).
  console.log("Tạo mức thù lao + lịch sử điểm danh demo...");
  const histNow = new Date();
  // her-35: 4 mức hoa hồng theo LOẠI HÌNH. effectiveFrom lùi 2 tháng để phủ hết ~55 ngày
  // lịch sử bên dưới (mức áp cho buổi có effectiveFrom <= ngày buổi diễn ra).
  const rateFrom = new Date(histNow.getFullYear(), histNow.getMonth() - 2, 1);
  const demoRate = {
    f11Amount: 200_000, f11Per: "session",
    f12Amount: 150_000, f12Per: "session",
    f14Amount: 100_000, f14Per: "attendee",
    f18Amount: 80_000, f18Per: "attendee",
    effectiveFrom: rateFrom,
  };
  await TrainerRate.create([
    { trainerId: linh._id, baseSalary: 5_000_000, ...demoRate },
    { trainerId: duc._id, baseSalary: 0, ...demoRate },
    { trainerId: thu._id, baseSalary: 4_000_000, ...demoRate },
  ]);

  // Lùi ĐÚNG offset ngày (Date tự vắt sang tháng trước khi ngày âm) — không kẹp về ngày 1,
  // vì kẹp sẽ dồn nhiều buổi vào cùng ngày/cùng giờ của MỘT HLV khi seed chạy đầu tháng.
  const histDay = (offset, hour) =>
    new Date(histNow.getFullYear(), histNow.getMonth(), histNow.getDate() - offset, hour, 0, 0);
  // 1 buổi lịch sử = 1 LỚP quá khứ + các booking completed (đã điểm danh Đến) ± vài no_show.
  // daysAgo: lùi tuyệt đối N ngày; offset: lùi N ngày theo lịch (dùng cho nhóm buổi gần đây
  // tạo hình chart "Khung giờ đông nhất"). Hai nhóm không đụng nhau: offset dùng 1–4 ngày,
  // daysAgo bắt đầu từ 6 — nên không có 2 buổi chồng giờ của cùng 1 HLV.
  // Số khách (came + missed) không bao giờ vượt sức chứa của loại hình.
  const makeHistory = async ({ trainer, format, serviceType, offset, daysAgo, hour, came, missed = 0 }) => {
    let start;
    if (daysAgo != null) {
      start = new Date(histNow.getTime() - daysAgo * 24 * 3600 * 1000);
      start.setHours(hour, 0, 0, 0);
    } else {
      start = histDay(offset, hour);
    }
    if (start >= histNow) return; // an toàn: chỉ ghi buổi ĐÃ diễn ra
    const end = new Date(start.getTime() + 3600 * 1000);
    const capacity = FORMAT_CAPACITY[format];
    const attended = Math.min(came, capacity);
    const absent = Math.min(missed, capacity - attended);
    const cls = await GymClass.create({
      name: LABELS[serviceType],
      serviceType,
      format,
      coachId: trainer._id,
      startAt: start,
      endAt: end,
      capacity,
      bookedCount: attended + absent,
    });
    const docs = [];
    for (let i = 0; i < attended + absent; i++) {
      docs.push({
        userId: i % 2 === 0 ? customer1._id : customer2._id,
        classId: cls._id,
        trainerId: trainer._id,
        title: cls.name,
        serviceType,
        format,
        startAt: start,
        endAt: end,
        status: i < attended ? "completed" : "no_show",
        attendanceAt: start, // điểm danh THẬT — được tính hoa hồng/thống kê
        attendanceBy: staff._id,
      });
    }
    await Booking.insertMany(docs);
  };
  // Khung 7h đông nhất, 18h nhì, 9h/15h thưa — chart "Khung giờ đông nhất" có hình dạng rõ
  await makeHistory({ trainer: duc, format: "1:4", serviceType: "gym", offset: 1, hour: 7, came: 3, missed: 1 });
  await makeHistory({ trainer: duc, format: "1:4", serviceType: "gym", offset: 3, hour: 7, came: 4 });
  await makeHistory({ trainer: thu, format: "1:8", serviceType: "yoga", offset: 2, hour: 18, came: 3, missed: 1 });
  await makeHistory({ trainer: thu, format: "1:8", serviceType: "yoga", offset: 4, hour: 18, came: 2 });
  await makeHistory({ trainer: linh, format: "1:1", serviceType: "pilates", offset: 1, hour: 9, came: 1 });
  await makeHistory({ trainer: linh, format: "1:1", serviceType: "pilates", offset: 2, hour: 9, came: 1 });
  await makeHistory({ trainer: linh, format: "1:4", serviceType: "pilates", offset: 3, hour: 15, came: 2 });

  // her-27 (góp ý 16/08): thêm 50 buổi lịch sử trải ~8 tuần về trước (vắt qua tháng trước)
  // để tab Lịch sử đủ dày mà thử cuộn-tự-tải. Xoay vòng HLV/bộ môn/loại hình/giờ, số liệu
  // cố định (không random — seed chạy lại vẫn y hệt).
  const HIST_HOURS = [7, 9, 15, 18, 19];
  const HIST_PLANS = [
    { trainer: thu, format: "1:8", serviceType: "yoga" },
    { trainer: linh, format: "1:4", serviceType: "pilates" },
    { trainer: duc, format: "1:2", serviceType: "gym" },
    { trainer: linh, format: "1:1", serviceType: "pilates" },
    { trainer: duc, format: "1:1", serviceType: "boxing" },
    { trainer: linh, format: "1:2", serviceType: "stretching" },
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
