// Test her-13 — Mục 8: Báo cáo thu–chi + API /dashboard.
// Xem docs-her/testcase/testcase_her-13_dashboard.md
// DB riêng her_test_k (tự seed), server cổng 4191.

const { test, before, after } = require("node:test");
const assert = require("node:assert");
const { spawn, spawnSync } = require("node:child_process");
const path = require("node:path");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const ROOT = path.join(__dirname, "..");
const URI = "mongodb://localhost:27017/her_test_k";
const S = "http://localhost:4191/api";

const Booking = require("../src/models/Booking");
const PTSlot = require("../src/models/PTSlot");
const GymClass = require("../src/models/GymClass");
const Trainer = require("../src/models/Trainer");
const TrainerRate = require("../src/models/TrainerRate");
const Package = require("../src/models/Package");
const User = require("../src/models/User");

let proc;
const tokens = {};
let linhTrainerId;
let ducTrainerId;

async function waitHealthy(base) {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${base}/health`);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Server ${base} không khởi động được`);
}

async function call(pathName, { method = "GET", token, body } = {}) {
  const res = await fetch(S + pathName, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

async function login(phone, password = "123456") {
  const r = await call("/auth/login", { method: "POST", body: { phone, password } });
  assert.equal(r.status, 200, `login ${phone}: ${JSON.stringify(r.data)}`);
  return r.data;
}

const now = new Date();
const dash = (token) => call("/dashboard", { token });

// Ngày d của THÁNG NÀY nhưng luôn TRONG QUÁ KHỨ (để buổi "đã diễn ra"): lùi về ngày 1..hôm nay
const pastDayThisMonth = (offset, hour) => {
  const d = Math.max(1, now.getDate() - offset);
  return new Date(now.getFullYear(), now.getMonth(), d, hour, 0, 0);
};

let khachId; // 1 khách dùng chung cho fixture booking
async function makeAttendedSession({ trainerId, kind = "group", start, attended = 1, noShow = 0, attendanceAtNull = false, status = "completed" } = {}) {
  const end = new Date(start.getTime() + 3600 * 1000);
  let classId = null;
  let slotId = null;
  let title;
  if (kind === "group") {
    const cls = await GymClass.create({
      name: `Lop dash ${Math.random().toString(36).slice(2, 7)}`, serviceType: "pilates",
      coachId: trainerId, startAt: start, endAt: end, capacity: 10, bookedCount: attended + noShow,
    });
    classId = cls._id;
    title = cls.name;
  } else {
    const slot = await PTSlot.create({ trainerId, startAt: start, endAt: end, capacity: kind === "ptGroup" ? 5 : 1, bookedCount: attended + noShow });
    slotId = slot._id;
    title = kind === "ptGroup" ? "PT nhóm — X" : "1:1 PT — X";
  }
  const docs = [];
  for (let i = 0; i < attended; i++) {
    docs.push({ userId: khachId, type: kind === "group" ? "group" : "pt", classId, slotId, trainerId, title, startAt: start, endAt: end, status, attendanceAt: attendanceAtNull || status !== "completed" ? null : start });
  }
  for (let i = 0; i < noShow; i++) {
    docs.push({ userId: khachId, type: kind === "group" ? "group" : "pt", classId, slotId, trainerId, title, startAt: start, endAt: end, status: "no_show", attendanceAt: start });
  }
  await Booking.insertMany(docs);
  return { classId, slotId, title };
}

before(async () => {
  const seeded = spawnSync(process.execPath, ["src/scripts/seed.js"], {
    cwd: ROOT,
    env: { ...process.env, MONGODB_URI: URI },
    stdio: "ignore",
  });
  assert.equal(seeded.status, 0, "seed her_test_k thất bại");
  proc = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: "4191", MONGODB_URI: URI, JWT_SECRET: "testsecret", MIN_CANCEL_HOURS: "3" },
    stdio: "ignore",
  });
  await waitHealthy(S);
  await mongoose.connect(URI);
  await TrainerRate.deleteMany({});

  // Seed (her-17) nay kèm LỊCH SỬ ĐIỂM DANH DEMO cho màn Tổng quan — suite này cần số
  // liệu sạch tuyệt đối nên xoá phần demo đó trước khi dựng fixture riêng
  await Booking.deleteMany({ attendanceAt: { $ne: null } });

  tokens.admin = (await login("0999999999")).token;
  tokens.staff = (await login("0900000000")).token;
  tokens.trainer = (await login("0911111111")).token; // HLV Linh
  tokens.customer = (await login("0909090909")).token;
  linhTrainerId = (await User.findOne({ phone: "0911111111" })).trainerId;
  ducTrainerId = (await Trainer.findOne({ name: /Đức/ }))._id;
  khachId = (await User.findOne({ phone: "0909090909" }))._id;

  // Mức thù lao: Linh PT 100k/buổi; Đức lớp nhóm 50k/khách đến
  await TrainerRate.create({
    trainerId: linhTrainerId, baseSalary: 0, groupAmount: 0, groupPer: "session",
    pt1Amount: 100000, ptGroupAmount: 0, ptGroupPer: "session", effectiveFrom: new Date(2020, 0, 1),
  });
  await TrainerRate.create({
    trainerId: ducTrainerId, baseSalary: 0, groupAmount: 50000, groupPer: "attendee",
    pt1Amount: 0, ptGroupAmount: 0, ptGroupPer: "session", effectiveFrom: new Date(2020, 0, 1),
  });
});

after(async () => {
  proc?.kill();
  await mongoose.disconnect();
});

// ---------- 1. Ma trận + đúng khối ----------

test("matrix: mỗi role đúng khối của mình; lễ tân KHÔNG thấy doanh thu/lương; khách 403; anon 401", async () => {
  assert.equal((await call("/dashboard")).status, 401);
  assert.equal((await dash(tokens.customer)).status, 403);

  const admin = await dash(tokens.admin);
  assert.equal(admin.status, 200);
  for (const k of ["revenue", "debt", "packagesSold", "payroll", "sessions", "peakHours", "trainers"]) {
    assert.ok(k in admin.data, `admin thiếu ${k}`);
  }

  const rec = await dash(tokens.staff);
  assert.equal(rec.status, 200);
  for (const k of ["classesToday", "bookingsToday", "freeSlots", "unpaid", "today", "todo"]) {
    assert.ok(k in rec.data, `lễ tân thiếu ${k}`);
  }
  assert.ok(!("revenue" in rec.data) && !("payroll" in rec.data) && !("trainers" in rec.data),
    "lễ tân không được thấy doanh thu/lương (H5)");

  const tr = await dash(tokens.trainer);
  assert.equal(tr.status, 200);
  for (const k of ["todayCount", "weekHours", "monthSessions", "attendanceRate"]) {
    assert.ok(k in tr.data, `HLV thiếu ${k}`);
  }
  assert.ok(!("revenue" in tr.data) && !("trainers" in tr.data), "HLV không thấy số của người khác");
});

// ---------- 2. Doanh thu ----------

test("revenue: tiền ĐÃ THU + nợ + gói bán chạy của THÁNG; gói tháng trước không tính", async () => {
  const base = (await dash(tokens.admin)).data;

  const mkPkg = (name, price, paidAmount) =>
    Package.create({ userId: khachId, name, serviceType: "yoga", price, paidAmount, totalSessions: 10, activatedAt: new Date(), expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000) });
  await mkPkg("Gói Bán Chạy", 1000000, 1000000);
  await mkPkg("Gói Bán Chạy", 1000000, 1000000);
  await mkPkg("Gói Lẻ", 2000000, 1500000); // nợ 500k
  // Gói THÁNG TRƯỚC (chèn raw để đặt createdAt)
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 15);
  await mongoose.connection.db.collection("packages").insertOne({
    userId: khachId, name: "Gói Cũ", serviceType: "gym", price: 9000000, paidAmount: 9000000,
    totalSessions: 10, usedSessions: 0, activatedAt: lastMonth, expiresAt: new Date(),
    pausedAt: null, paymentMethod: "cash", createdAt: lastMonth, updatedAt: lastMonth,
  });

  const cur = (await dash(tokens.admin)).data;
  assert.equal(cur.packagesSold, base.packagesSold + 3, "gói tháng trước không được tính");
  assert.equal(cur.revenue, base.revenue + 1000000 + 1000000 + 1500000, "doanh thu = tiền ĐÃ THU");
  assert.equal(cur.debt, base.debt + 500000);
  assert.equal(cur.topPackages[0].name, "Gói Bán Chạy", "gói bán chạy nhất đứng đầu");
  assert.equal(cur.topPackages[0].count, 2);
});

// ---------- 4. Lượt đến + khung giờ đông (chạy trước payroll-match/trainers để có dữ liệu) ----------

test("peak: sessions đếm lượt ĐẾN thật; peakHours xếp theo giờ đông; sweep/vắng/hủy không tính", async () => {
  const base = (await dash(tokens.admin)).data;
  assert.equal(base.sessions, 0, "seed không có buổi điểm danh thật nào");

  // 07:00 tổng 4 lượt đến (3 group Đức + 1 PT Linh); 18:00 1 lượt (PT Linh)
  await makeAttendedSession({ trainerId: ducTrainerId, kind: "group", start: pastDayThisMonth(3, 7), attended: 3, noShow: 1 });
  await makeAttendedSession({ trainerId: linhTrainerId, kind: "pt1", start: pastDayThisMonth(2, 7), attended: 1 });
  await makeAttendedSession({ trainerId: linhTrainerId, kind: "pt1", start: pastDayThisMonth(2, 18), attended: 1 });
  // Không được tính: sweep (attendanceAt null), hủy
  await makeAttendedSession({ trainerId: linhTrainerId, kind: "pt1", start: pastDayThisMonth(1, 9), attended: 1, attendanceAtNull: true });
  await makeAttendedSession({ trainerId: linhTrainerId, kind: "pt1", start: pastDayThisMonth(1, 10), attended: 1, status: "cancelled" });

  const cur = (await dash(tokens.admin)).data;
  assert.equal(cur.sessions, 5, "3+1+1 lượt đến thật (no_show/sweep/hủy không tính)");
  assert.equal(cur.peakHours[0].time, "07:00");
  assert.equal(cur.peakHours[0].rate, 1, "khung đông nhất chuẩn hoá = 1");
  const h18 = cur.peakHours.find((h) => h.time === "18:00");
  assert.ok(h18 && Math.abs(h18.rate - 0.25) < 0.01, "18:00 = 1/4 lượt của khung đông nhất");
});

// ---------- 3. Tổng chi lương khớp mục 7 ----------

test("payroll-match: dashboard.payroll = tổng của /payroll/summary; LUÔN tính động (bỏ chốt)", async () => {
  const MONTH = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const sum = (await call(`/payroll/summary?month=${MONTH}`, { token: tokens.admin })).data;
  const expected = sum.entries.reduce((t, e) => t + (e.total || 0), 0);
  assert.ok(expected > 0, "fixture phải sinh ra thù lao > 0");
  assert.equal((await dash(tokens.admin)).data.payroll, expected);

  // BỎ chốt (16/08): thêm buổi mới -> dashboard cập nhật NGAY
  await makeAttendedSession({ trainerId: linhTrainerId, kind: "pt1", start: pastDayThisMonth(1, 11), attended: 1 });
  const after = (await dash(tokens.admin)).data.payroll;
  assert.ok(after > expected, "lương luôn tính động theo điểm danh hiện tại");
});

// ---------- 5. Bảng HLV ----------

test("trainers-table: sessions/attendance/pay từng HLV đúng", async () => {
  const cur = (await dash(tokens.admin)).data;
  const linh = cur.trainers.find((t) => t.name === "HLV Linh");
  const duc = cur.trainers.find((t) => t.name === "HLV Đức");
  assert.ok(linh && duc);
  assert.equal(duc.sessions, 1, "Đức 1 buổi lớp nhóm");
  assert.equal(duc.pay, 3 * 50000, "per=attendee: 3 khách đến x 50k");
  assert.ok(Math.abs(duc.attendance - 0.75) < 0.01, "3 đến / (3+1 vắng) = 75%");
  assert.equal(linh.sessions, 3, "Linh 3 buổi PT có khách đến (2 + 1 thêm ở test chốt)");
  assert.equal(linh.pay, 3 * 100000);
  assert.equal(linh.attendance, 1);
});

// ---------- 6. Lễ tân ----------

test("reception: số hôm nay + danh sách lớp + todo (nợ, gói sắp hết hạn)", async () => {
  // Đối chiếu độc lập với DB
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  const clsCount = await GymClass.countDocuments({ startAt: { $gte: startOfDay, $lte: endOfDay } });

  // Thêm 1 gói SẮP HẾT HẠN (3 ngày nữa) cho khách mới -> todo phải có dòng gói sắp hết
  const passwordHash = await bcrypt.hash("123456", 10);
  const u = await User.create({ name: "Khach No", phone: "0972111111", passwordHash, role: "customer" });
  await Package.create({
    userId: u._id, name: "Gói Sắp Hết", serviceType: "gym", price: 500000, paidAmount: 100000, // nợ 400k
    totalSessions: 10, activatedAt: new Date(), expiresAt: new Date(Date.now() + 3 * 24 * 3600 * 1000),
  });

  const rec = (await dash(tokens.staff)).data;
  assert.equal(rec.classesToday, clsCount, "đếm lớp nhóm hôm nay");
  // her-30 (chốt 17/08): Lịch hôm nay CHỈ buổi CÓ KHÁCH, tối đa 4
  assert.ok(rec.today.length <= 4, "tối đa 4 buổi");
  for (const t of rec.today) {
    assert.ok(t.time && t.title && typeof t.booked === "number" && typeof t.capacity === "number");
    assert.ok(t.booked > 0, "chỉ buổi có khách mới được hiển thị");
  }
  assert.ok(rec.unpaid >= 2, "ít nhất 2 khách nợ (Gói Lẻ + Gói Sắp Hết)");
  assert.ok(typeof rec.bookingsToday === "number" && typeof rec.freeSlots === "number");
  const todoText = rec.todo.map((t) => `${t.title} ${t.sub || ""}`).join(" | ");
  assert.match(todoText, /nợ/i, "todo phải nhắc khách nợ");
  assert.match(todoText, /hết hạn/i, "todo phải nhắc gói sắp hết hạn");
});

// ---------- 7. HLV ----------

test("trainer-view: buổi hôm nay của CHÍNH MÌNH — next/rest/đếm đúng, không lộ HLV khác", async () => {
  // 2 buổi TƯƠNG LAI hôm nay của Linh (nếu còn đủ giờ trong ngày) + 1 buổi của Đức
  const in30 = new Date(Date.now() + 30 * 60 * 1000);
  const in3h = new Date(Date.now() + 3 * 3600 * 1000);
  const sameDay = in3h.getDate() === now.getDate();
  let phoneSeq = 0;
  const mkBooked = async (trainerId, start, custName) => {
    const slot = await PTSlot.create({ trainerId, startAt: start, endAt: new Date(start.getTime() + 3600000), capacity: 1, bookedCount: 1 });
    const passwordHash = await bcrypt.hash("123456", 10);
    const u = await User.create({ name: custName, phone: `0973${String(phoneSeq++).padStart(6, "0")}`, passwordHash, role: "customer" });
    await Booking.insertMany([{ userId: u._id, type: "pt", slotId: slot._id, trainerId, title: "1:1 PT — X", startAt: start, endAt: slot.endAt, status: "booked", attendanceAt: null }]);
  };
  const base = (await dash(tokens.trainer)).data;
  await mkBooked(linhTrainerId, in30, "Khach Ke Tiep");
  if (sameDay) await mkBooked(linhTrainerId, in3h, "Khach Sau Do");
  await mkBooked(ducTrainerId, in30, "Khach Cua Duc");

  const tr = (await dash(tokens.trainer)).data;
  assert.equal(tr.todayCount, base.todayCount + (sameDay ? 2 : 1), "chỉ đếm buổi của mình");
  assert.ok(tr.next, "phải có buổi kế tiếp");
  assert.ok((tr.next.customers || []).includes("Khach Ke Tiep"), "buổi kế tiếp là buổi sớm nhất chưa qua");
  assert.ok(!JSON.stringify(tr).includes("Khach Cua Duc"), "không được lộ buổi của HLV khác");
  assert.ok(tr.monthSessions >= tr.todayCount, "buổi tháng bao gồm buổi hôm nay");
  assert.equal(tr.attendanceRate, 1, "Linh: mọi khách tháng này đều Đến (không no_show)");
  if (sameDay) {
    assert.ok(tr.rest.some((r) => (r.title || "").length > 0), "danh sách còn lại hôm nay có dòng");
  }
});

// ---------- Vòng review độc lập her-13: regression cho các fix ----------

test("review-fix (N1): thu nợ qua /pay vào doanh thu tháng THU — kể cả gói bán tháng trước", async () => {
  const base = (await dash(tokens.admin)).data;

  // Gói bán THÁNG TRƯỚC còn nợ 300k (raw insert kèm nhật ký payment tháng trước)
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 10);
  const ins = await mongoose.connection.db.collection("packages").insertOne({
    userId: khachId, name: "Gói Nợ Cũ", serviceType: "gym", price: 1000000, paidAmount: 700000,
    totalSessions: 10, usedSessions: 0, activatedAt: lastMonth, expiresAt: new Date(Date.now() + 60 * 24 * 3600 * 1000),
    pausedAt: null, paymentMethod: "cash", createdAt: lastMonth, updatedAt: lastMonth,
    payments: [{ amount: 700000, at: lastMonth, by: null }],
  });
  // Quầy thu nợ 300k HÔM NAY qua API
  const pay = await call(`/packages/${ins.insertedId}/pay`, { method: "PATCH", token: tokens.staff, body: { amount: 300000 } });
  assert.equal(pay.status, 200, JSON.stringify(pay.data));

  const cur = (await dash(tokens.admin)).data;
  assert.equal(cur.revenue, base.revenue + 300000, "tiền thu nợ phải vào doanh thu tháng THU");
  assert.equal(cur.packagesSold, base.packagesSold, "gói bán tháng trước không tăng số gói bán tháng này");
  assert.equal(cur.debt, base.debt - 300000 + 300000, "nợ tồn: +300k (gói cũ chèn vào) rồi -300k (vừa thu hết)");
});

test("review-fix (N1b): debt là NỢ TỒN toàn bộ — khớp định nghĩa 'khách nợ' của lễ tân", async () => {
  // Đối chiếu độc lập: tổng (price - paidAmount) của mọi gói còn nợ (paidAmount null = thu đủ)
  const agg = await Package.aggregate([
    { $match: { paidAmount: { $ne: null }, $expr: { $lt: ["$paidAmount", "$price"] } } },
    { $group: { _id: null, d: { $sum: { $subtract: ["$price", "$paidAmount"] } } } },
  ]);
  const cur = (await dash(tokens.admin)).data;
  assert.equal(cur.debt, agg[0]?.d || 0, "debt = tổng nợ tồn toàn bộ");
  assert.ok(cur.debt >= 900000, "gồm ít nhất Gói Lẻ 500k + Gói Sắp Hết 400k của fixture");
});

test("review-fix: admin KIÊM HLV nhận khối ADMIN; HLV thiếu trainerId -> 400", async () => {
  // Admin mở hồ sơ HLV rồi gọi dashboard -> vẫn khối admin
  await call("/me/trainer-profile", { method: "POST", token: tokens.admin, body: { name: "Chu Kiem HLV", specialties: ["pilates"] } });
  const d = await dash(tokens.admin);
  assert.equal(d.status, 200);
  assert.ok("revenue" in d.data, "admin kiêm HLV vẫn nhận khối admin");

  // Tài khoản role trainer nhưng trainerId null -> 400 rõ lý do
  const passwordHash = await bcrypt.hash("123456", 10);
  await User.create({ name: "HLV Thieu Ho So", phone: "0974000001", passwordHash, role: "trainer", trainerId: null });
  const { token } = await login("0974000001");
  const r = await dash(token);
  assert.equal(r.status, 400);
  assert.ok(r.data.error);
});

test("review-fix (V1): tháng ĐÃ CHỐT — HLV mới có buổi sau chốt vẫn có dòng trong bảng trainers", async () => {
  const MONTH = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const fresh = await Trainer.create({ name: "HLV Sau Chot", specialty: "" });
  await makeAttendedSession({ trainerId: fresh._id, kind: "pt1", start: pastDayThisMonth(0, 5), attended: 1 });

  const d = (await dash(tokens.admin)).data;
  const row = d.trainers.find((t) => t.name === "HLV Sau Chot");
  assert.ok(row, "HLV mới sau khi chốt không được rơi khỏi bảng");
  assert.equal(row.sessions, 1);
});

test("review-fix (V4): unpaid dedupe theo khách, bỏ khách bị KHOÁ; expiring bỏ gói bảo lưu/hết buổi", async () => {
  const base = (await dash(tokens.staff)).data;
  const passwordHash = await bcrypt.hash("123456", 10);
  // 1 khách nợ 2 gói -> unpaid chỉ +1
  const u1 = await User.create({ name: "No Hai Goi", phone: "0974000002", passwordHash, role: "customer" });
  const mk = (userId, extra = {}) =>
    Package.create({ userId, name: "G", serviceType: "gym", price: 1000000, paidAmount: 100000,
      totalSessions: 10, activatedAt: new Date(), expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000), ...extra });
  await mk(u1._id);
  await mk(u1._id);
  // 1 khách nợ nhưng BỊ KHOÁ -> không đếm
  const u2 = await User.create({ name: "No Bi Khoa", phone: "0974000003", passwordHash, role: "customer", isActive: false });
  await mk(u2._id);

  const cur = (await dash(tokens.staff)).data;
  assert.equal(cur.unpaid, base.unpaid + 1, "2 gói nợ cùng khách = +1; khách khoá không đếm");

  // expiring: gói bảo lưu + gói hết buổi trong cửa 7 ngày -> không đếm
  const b2 = (await dash(tokens.staff)).data;
  await mk(u1._id, { paidAmount: 1000000, pausedAt: new Date(), expiresAt: new Date(Date.now() + 2 * 24 * 3600 * 1000) });
  await mk(u1._id, { paidAmount: 1000000, usedSessions: 10, expiresAt: new Date(Date.now() + 2 * 24 * 3600 * 1000) });
  const b3 = (await dash(tokens.staff)).data;
  const countTodoExpiring = (d) => {
    const line = d.todo.find((t) => /hết hạn/.test(t.title));
    return line ? Number(line.title.match(/^(\d+)/)?.[1] || 0) : 0;
  };
  assert.equal(countTodoExpiring(b3), countTodoExpiring(b2), "gói bảo lưu/hết buổi không làm tăng cảnh báo sắp hết hạn");
});

test("review-fix: bookingsToday loại buổi ĐÃ HỦY", async () => {
  const base = (await dash(tokens.staff)).data;
  const start = new Date(Date.now() + 60 * 60 * 1000);
  const sameDay = start.getDate() === now.getDate();
  if (!sameDay) return; // sát nửa đêm — bỏ qua cho ổn định
  const slot = await PTSlot.create({ trainerId: ducTrainerId, startAt: start, endAt: new Date(start.getTime() + 3600000), capacity: 1, bookedCount: 0 });
  await Booking.insertMany([{ userId: khachId, type: "pt", slotId: slot._id, trainerId: ducTrainerId, title: "1:1 PT — X", startAt: start, endAt: slot.endAt, status: "cancelled", attendanceAt: null }]);
  const cur = (await dash(tokens.staff)).data;
  assert.equal(cur.bookingsToday, base.bookingsToday, "booking hủy không được đếm vào lượt đặt hôm nay");
});

test("her-18: admin lọc dashboard theo ?month — tháng trước OK, tháng rác/tương lai 400", async () => {
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 15);
  const prevMonth = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`;
  // Fixture: 1 buổi điểm danh Ở THÁNG TRƯỚC — chỉ tháng đó được đếm
  await makeAttendedSession({ trainerId: ducTrainerId, kind: "pt1", start: prev, attended: 1 });
  const r = await call(`/dashboard?month=${prevMonth}`, { token: tokens.admin });
  assert.equal(r.status, 200);
  assert.ok("revenue" in r.data && "peakHours" in r.data, "vẫn đủ khối báo cáo");
  assert.equal(r.data.sessions, 1, "lượt đến đếm theo THÁNG CHỌN");

  assert.equal((await call("/dashboard?month=abc", { token: tokens.admin })).status, 400);
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const nextMonth = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`;
  assert.equal((await call(`/dashboard?month=${nextMonth}`, { token: tokens.admin })).status, 400);
  // lễ tân/HLV không nhận ?month (bị bỏ qua, vẫn khối của mình)
  assert.equal((await call(`/dashboard?month=${prevMonth}`, { token: tokens.staff })).status, 200);
});

// her-30 (góp ý 17/08): "Lịch hôm nay" của lễ tân hiện 4 buổi SẮP TỚI (chưa kết thúc);
// cuối ngày hết buổi sắp tới thì hiện 4 buổi CUỐI CÙNG của ngày. Gọi thẳng util với
// `now` ghim + dựng ngày thử ở +30 ngày (không dính lịch seed 7 ngày).
test("her-30: Lịch hôm nay = 4 buổi sắp tới; hết thì 4 buổi cuối ngày", async () => {
  const { receptionDashboard } = require("../src/utils/dashboard");
  const User = require("../src/models/User");
  const linhId = (await User.findOne({ phone: "0911111111" })).trainerId;
  const base = new Date(Date.now() + 30 * 24 * 3600 * 1000);
  const at = (h) => new Date(base.getFullYear(), base.getMonth(), base.getDate(), h, 0, 0);
  for (const h of [8, 9, 10, 13, 14, 15]) {
    await GymClass.create({
      name: `HER30 ${h}h`, serviceType: "pilates", coachId: linhId,
      startAt: at(h), endAt: at(h + 1), capacity: 8, bookedCount: 1,
    });
  }
  // Chốt 17/08: CÓ KHÁCH mới hiển thị — lớp 0 khách không được vào danh sách
  await GymClass.create({
    name: "HER30 16h khong khach", serviceType: "pilates", coachId: linhId,
    startAt: at(16), endAt: at(17), capacity: 8, bookedCount: 0,
  });
  const titles = (d) => d.today.map((t) => t.title);

  // 08:30 — lớp 8h ĐANG diễn ra vẫn tính sắp tới → 4 buổi kế: 8,9,10,13
  const early = await receptionDashboard(new Date(base.getFullYear(), base.getMonth(), base.getDate(), 8, 30));
  assert.deepEqual(titles(early), ["HER30 8h", "HER30 9h", "HER30 10h", "HER30 13h"]);

  // 12:00 — còn 3 buổi sắp tới (<4) → hiện 4 buổi CUỐI của ngày: 10,13,14,15
  const noon = await receptionDashboard(new Date(base.getFullYear(), base.getMonth(), base.getDate(), 12, 0));
  assert.deepEqual(titles(noon), ["HER30 10h", "HER30 13h", "HER30 14h", "HER30 15h"]);

  // 23:00 — hết buổi sắp tới → vẫn 4 buổi cuối của ngày; lớp 0 khách (16h) KHÔNG hiện
  const night = await receptionDashboard(new Date(base.getFullYear(), base.getMonth(), base.getDate(), 23, 0));
  assert.deepEqual(titles(night), ["HER30 10h", "HER30 13h", "HER30 14h", "HER30 15h"]);
  for (const d of [early, noon, night]) {
    assert.ok(!titles(d).some((t) => t.includes("khong khach")), "lớp 0 khách không được hiển thị");
  }

  await GymClass.deleteMany({ name: /^HER30/ }); // dọn — không ảnh hưởng test khác
});
