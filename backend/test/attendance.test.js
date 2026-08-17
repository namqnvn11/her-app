// Test her-10 — Mục 5: điểm danh từng buổi. Xem docs-her/testcase/testcase_her-10_attendance.md
// DB riêng her_test_h (tự seed), server cổng 4161.

const { test, before, after } = require("node:test");
const assert = require("node:assert");
const { spawn, spawnSync } = require("node:child_process");
const path = require("node:path");
const mongoose = require("mongoose");

const ROOT = path.join(__dirname, "..");
const URI = "mongodb://localhost:27017/her_test_h";
const S = "http://localhost:4161/api";

const Booking = require("../src/models/Booking");
const Package = require("../src/models/Package");
const GymClass = require("../src/models/GymClass");
const User = require("../src/models/User");

let proc;
const tokens = {};
let linhTrainerId; // Trainer._id của HLV Linh (tài khoản 0911111111)

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

const hoursFromNow = (h) => new Date(Date.now() + h * 3600 * 1000);

before(async () => {
  const seeded = spawnSync(process.execPath, ["src/scripts/seed.js"], {
    cwd: ROOT,
    env: { ...process.env, MONGODB_URI: URI },
    stdio: "ignore",
  });
  assert.equal(seeded.status, 0, "seed her_test_h thất bại");
  proc = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: "4161", MONGODB_URI: URI, JWT_SECRET: "testsecret", MIN_CANCEL_HOURS: "3" },
    stdio: "ignore",
  });
  await waitHealthy(S);
  await mongoose.connect(URI);

  tokens.admin = (await login("0999999999")).token;
  tokens.staff = (await login("0900000000")).token;
  tokens.trainer = (await login("0911111111")).token; // HLV Linh
  tokens.customer = (await login("0909090909")).token; // Minh Anh
  linhTrainerId = (await User.findOne({ phone: "0911111111" })).trainerId;
});

after(async () => {
  proc?.kill();
  await mongoose.disconnect();
});

// Fixture: booking "đang trong giờ điểm danh" — chèn DB (API không cho tạo lớp quá khứ/sát giờ)
let seq = 0;
async function makeBooking({ trainerId = linhTrainerId, startInMinutes = -10, status = "booked" } = {}) {
  const customer = await User.findOne({ phone: "0909090909" });
  const start = new Date(Date.now() + startInMinutes * 60 * 1000);
  const end = new Date(start.getTime() + 3600 * 1000);
  const cls = await GymClass.create({
    name: `Lop diem danh ${seq++}`,
    serviceType: "pilates",
    coachId: trainerId,
    startAt: start,
    endAt: end,
    capacity: 8,
    bookedCount: 1,
  });
  const bk = await Booking.create({
    userId: customer._id,
    type: "group",
    classId: cls._id,
    trainerId,
    title: cls.name,
    startAt: start,
    endAt: end,
    status,
  });
  return { cls, bk };
}

const mark = (id, present, token) =>
  call(`/management/bookings/${id}/attendance`, { method: "PATCH", token, body: { present } });

// ---------- 1. Ma trận ----------

test("matrix: quầy + HLV(buổi mình) điểm danh được; HLV buổi người khác 403; khách 403; anon 401; id rác 400", async () => {
  const { bk } = await makeBooking();
  assert.equal((await mark(bk._id, true)).status, 401);
  assert.equal((await mark(bk._id, true, tokens.customer)).status, 403);
  assert.equal((await call("/management/bookings/khong-id/attendance", { method: "PATCH", token: tokens.staff, body: { present: true } })).status, 400);

  // HLV Linh với buổi của chính mình -> được
  assert.equal((await mark(bk._id, true, tokens.trainer)).status, 200);

  // Buổi của HLV khác -> 403
  const trainerDocs = await mongoose.connection.db.collection("trainers").find({}).toArray();
  const other = trainerDocs.find((t) => t._id.toString() !== linhTrainerId.toString());
  const { bk: bkOther } = await makeBooking({ trainerId: other._id });
  assert.equal((await mark(bkOther._id, true, tokens.trainer)).status, 403);
  assert.equal((await mark(bkOther._id, true, tokens.staff)).status, 200);
  assert.equal((await mark(bkOther._id, false, tokens.admin)).status, 200);
});

// ---------- 2. Toggle + dấu vết ----------

test("toggle: Đến -> Vắng -> Đến; attendanceAt/By ghi đúng", async () => {
  const { bk } = await makeBooking();
  const r1 = await mark(bk._id, true, tokens.trainer);
  assert.equal(r1.status, 200);
  assert.equal(r1.data.booking.status, "completed");

  let db = await Booking.findById(bk._id);
  assert.equal(db.status, "completed");
  assert.ok(db.attendanceAt, "phải ghi thời điểm điểm danh");
  const linhUser = await User.findOne({ phone: "0911111111" });
  assert.equal(db.attendanceBy.toString(), linhUser._id.toString(), "phải ghi ai điểm danh");

  const r2 = await mark(bk._id, false, tokens.staff);
  assert.equal(r2.status, 200);
  db = await Booking.findById(bk._id);
  assert.equal(db.status, "no_show");
  const staffUser = await User.findOne({ phone: "0900000000" });
  assert.equal(db.attendanceBy.toString(), staffUser._id.toString(), "sửa lại thì ghi người sửa");

  assert.equal((await mark(bk._id, true, tokens.staff)).status, 200);
  assert.equal((await Booking.findById(bk._id)).status, "completed");
});

// ---------- 3-4. Chặn ----------

test("chua-toi-gio: ngoài cửa điểm danh -> 400; trong cửa (trước giờ vài phút) -> được", async () => {
  // Biên tính theo hằng số cấu hình — không ghi cứng số phút trong test (C5)
  const { ATTENDANCE_OPEN_BEFORE_MINUTES } = require("../src/utils/attendanceRule");
  const { bk: far } = await makeBooking({ startInMinutes: ATTENDANCE_OPEN_BEFORE_MINUTES + 10 });
  const r = await mark(far._id, true, tokens.staff);
  assert.equal(r.status, 400);
  assert.match(r.data.error, /chưa tới giờ/i);

  const { bk: soon } = await makeBooking({ startInMinutes: ATTENDANCE_OPEN_BEFORE_MINUTES - 5 });
  assert.equal((await mark(soon._id, true, tokens.staff)).status, 200);
});

test("config: server công bố attendanceOpenBeforeMinutes qua /me — app không ghi cứng số phút (C5)", async () => {
  const { ATTENDANCE_OPEN_BEFORE_MINUTES } = require("../src/utils/attendanceRule");
  const r = await call("/me", { token: tokens.staff });
  assert.equal(r.status, 200);
  assert.equal(r.data.config.attendanceOpenBeforeMinutes, ATTENDANCE_OPEN_BEFORE_MINUTES);
});

test("cancelled: buổi đã hủy không điểm danh được", async () => {
  const { bk } = await makeBooking({ status: "cancelled" });
  const r = await mark(bk._id, true, tokens.staff);
  assert.equal(r.status, 400);
  assert.match(r.data.error, /hủy/);
});

// ---------- 5. C2 ----------

test("khong-dung-goi: điểm danh Đến rồi Vắng — usedSessions của khách không đổi", async () => {
  const customer = await User.findOne({ phone: "0909090909" });
  const before = (await Package.find({ userId: customer._id })).map((p) => p.usedSessions).join(",");
  const { bk } = await makeBooking();
  await mark(bk._id, true, tokens.staff);
  await mark(bk._id, false, tokens.staff);
  const after = (await Package.find({ userId: customer._id })).map((p) => p.usedSessions).join(",");
  assert.equal(after, before, "điểm danh không được trừ/hoàn buổi (C2)");
});

// ---------- 6. Sweep ----------

test("sweep: không đè no_show / completed đã điểm danh (sweep chỉ đụng booked, không có dấu điểm danh)", async () => {
  const { bk: bkNoShow } = await makeBooking({ startInMinutes: -120 });
  await mark(bkNoShow._id, false, tokens.staff);
  const { bk: bkDone } = await makeBooking({ startInMinutes: -120 });
  await mark(bkDone._id, true, tokens.staff);

  // Sweep chạy lúc boot — mô phỏng bằng cách gọi thẳng hàm sweep của server code
  const { sweepCompletedBookings } = require("../src/utils/completeSweep");
  await sweepCompletedBookings();

  const noShow = await Booking.findById(bkNoShow._id);
  assert.equal(noShow.status, "no_show", "sweep không được đè điểm danh Vắng");
  const done = await Booking.findById(bkDone._id);
  assert.equal(done.status, "completed");
  assert.ok(done.attendanceAt, "dấu điểm danh thật phải còn nguyên sau sweep");
});

// ---------- 7. Hiển thị ----------

test("hien-thi: /management/bookings + roster vẫn hiện buổi đã điểm danh (kèm status), loại cancelled", async () => {
  const { cls, bk } = await makeBooking();
  await mark(bk._id, true, tokens.staff);
  const { bk: bkCancelled } = await makeBooking({ status: "cancelled" });

  const list = await call("/management/bookings?range=today", { token: tokens.staff });
  assert.equal(list.status, 200);
  const row = list.data.bookings.find((b) => String(b.id) === String(bk._id));
  assert.ok(row, "buổi đã điểm danh phải còn trong danh sách hôm nay");
  assert.equal(row.status, "completed");
  assert.ok(!list.data.bookings.some((b) => String(b.id) === String(bkCancelled._id)), "buổi hủy không hiện");

  const roster = await call(`/management/classes/${cls._id}/roster`, { token: tokens.staff });
  assert.equal(roster.status, 200);
  const kh = roster.data.customers.find((k) => String(k.bookingId) === String(bk._id));
  assert.ok(kh, "khách đã điểm danh vẫn trong roster");
  assert.equal(kh.status, "completed");
  assert.ok(kh.attendanceAt, "roster phải trả dấu điểm danh để app hiện trạng thái");
});

// ---------- Vòng review độc lập her-10: regression cho các fix ----------

test("review-fix (#2): điểm danh SỚM xong khách KHÔNG đặt lại được lớp đó / lớp chồng giờ", async () => {
  // Lớp bắt đầu sau 10' (trong cửa điểm danh) — quầy tích Đến trước giờ
  const { cls, bk } = await makeBooking({ startInMinutes: 10 });
  assert.equal((await mark(bk._id, true, tokens.staff)).status, 200);

  // Đặt lại đúng lớp đó -> phải bị chặn "đã đặt" dù booking cũ đã completed
  const again = await call("/bookings", {
    method: "POST", token: tokens.customer, body: { type: "group", classId: cls._id.toString() },
  });
  assert.equal(again.status, 400, JSON.stringify(again.data));
  assert.match(again.data.error, /đã đặt/);

  // Lớp KHÁC chồng giờ với buổi vừa điểm danh sớm -> cũng bị chặn trùng giờ
  const trainerDocs = await mongoose.connection.db.collection("trainers").find({}).toArray();
  const other = trainerDocs.find((t) => t._id.toString() !== linhTrainerId.toString());
  const cls2 = await GymClass.create({
    name: "Lop chong gio diem danh som", serviceType: "pilates", coachId: other._id,
    startAt: bk.startAt, endAt: bk.endAt, capacity: 8, bookedCount: 0,
  });
  const overlap = await call("/bookings", {
    method: "POST", token: tokens.customer, body: { type: "group", classId: cls2._id.toString() },
  });
  assert.equal(overlap.status, 400);
  assert.match(overlap.data.error, /trùng giờ/);
});

test("review-fix (#6): quầy BỎ điểm danh (present:null) -> về 'đã đặt', xoá dấu vết; HLV không được", async () => {
  const { bk } = await makeBooking();
  await mark(bk._id, true, tokens.staff);
  assert.equal((await mark(bk._id, null, tokens.trainer)).status, 403);

  const r = await mark(bk._id, null, tokens.staff);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const db = await Booking.findById(bk._id);
  assert.equal(db.status, "booked");
  assert.equal(db.attendanceAt, null);
  assert.equal(db.attendanceBy, null);
});

test("review-fix (#3): HLV không retro-mark buổi quá 1 ngày; quầy vẫn sửa được", async () => {
  const { bk } = await makeBooking({ startInMinutes: -60 * 24 * 3 }); // buổi 3 ngày trước
  const r = await mark(bk._id, true, tokens.trainer);
  assert.equal(r.status, 400);
  assert.match(r.data.error, /quá/);
  assert.equal((await mark(bk._id, true, tokens.staff)).status, 200, "quầy không bị giới hạn");
});

// her-26 (chốt 16/08): hạn HLV tự điểm danh/sửa = 24 GIỜ kể từ giờ bắt đầu buổi
// (luật cũ "hết ngày hôm sau" bị chê xa — buổi sáng hôm qua tối nay vẫn sửa được)

test("her-26 (24h qua han): buổi bắt đầu 25 giờ trước — HLV 400, quầy vẫn 200", async () => {
  const { bk } = await makeBooking({ startInMinutes: -60 * 25 });
  const r = await mark(bk._id, true, tokens.trainer);
  assert.equal(r.status, 400, JSON.stringify(r.data));
  assert.match(r.data.error, /24 giờ/);
  assert.equal((await mark(bk._id, true, tokens.staff)).status, 200, "quầy không bị giới hạn");
});

test("her-26 (24h con han): buổi bắt đầu 23 giờ trước — HLV vẫn sửa được", async () => {
  const { bk } = await makeBooking({ startInMinutes: -60 * 23 });
  const r = await mark(bk._id, true, tokens.trainer);
  assert.equal(r.status, 200, JSON.stringify(r.data));
});

test("her-26 (biên đúng phút): 23h59' -> 200; 24h01' -> 400", async () => {
  const ok = await makeBooking({ startInMinutes: -(60 * 24 - 1) });
  const rOk = await mark(ok.bk._id, true, tokens.trainer);
  assert.equal(rOk.status, 200, `còn 1 phút trong hạn phải sửa được: ${JSON.stringify(rOk.data)}`);

  const late = await makeBooking({ startInMinutes: -(60 * 24 + 1) });
  const rLate = await mark(late.bk._id, true, tokens.trainer);
  assert.equal(rLate.status, 400, "quá hạn 1 phút phải bị chặn");
  assert.match(rLate.data.error, /24 giờ/);
});

test("review-fix (#10a): buổi KHÔNG điểm danh bị sweep -> completed nhưng attendanceAt vẫn null (mục 7 không tính hoa hồng)", async () => {
  const { bk } = await makeBooking({ startInMinutes: -180 });
  const { sweepCompletedBookings } = require("../src/utils/completeSweep");
  await sweepCompletedBookings();
  const db = await Booking.findById(bk._id);
  assert.equal(db.status, "completed", "sweep vẫn tự hoàn tất buổi quá giờ");
  assert.equal(db.attendanceAt, null, "KHÔNG được có dấu điểm danh thật");
});

test("review-fix: khách vẫn thấy buổi điểm danh sớm trong 'Sắp tới' (/me/bookings)", async () => {
  const { bk } = await makeBooking({ startInMinutes: 10 });
  await mark(bk._id, true, tokens.staff);
  const mine = await call("/me/bookings", { token: tokens.customer });
  const row = mine.data.bookings.find((x) => String(x.id) === String(bk._id));
  assert.ok(row, "buổi chưa diễn ra không được biến mất khỏi Sắp tới của khách");
  assert.equal(row.status, "completed");
});
