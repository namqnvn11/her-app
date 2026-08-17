// Test her-09 — Mục 4 app nội bộ: sửa khung giờ + đổi HLV khung đã đặt (quyết định 16/08).
// Xem docs-her/testcase/testcase_her-09_internal_schedule.md
// DB riêng her_test_g (tự seed), server cổng 4151.

const { test, before, after } = require("node:test");
const assert = require("node:assert");
const { spawn, spawnSync } = require("node:child_process");
const path = require("node:path");
const mongoose = require("mongoose");

const ROOT = path.join(__dirname, "..");
const URI = "mongodb://localhost:27017/her_test_g";
const S = "http://localhost:4151/api";

const Booking = require("../src/models/Booking");
const Package = require("../src/models/Package");
const PTSlot = require("../src/models/PTSlot");
const GymClass = require("../src/models/GymClass");
const User = require("../src/models/User");

let proc;
const tokens = {};
let coach; // { linh, thu, duc } -> id theo tên

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
  assert.equal(seeded.status, 0, "seed her_test_g thất bại");
  proc = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: "4151", MONGODB_URI: URI, JWT_SECRET: "testsecret", MIN_CANCEL_HOURS: "3" },
    stdio: "ignore",
  });
  await waitHealthy(S);
  await mongoose.connect(URI);
  // her-19: suite này test các bất biến CŨ với coach bất kỳ — gỡ ràng buộc chuyên môn của
  // seed (specialties rỗng = hồ sơ cũ, được phép dạy mọi lớp); luật chuyên môn có test riêng.
  await mongoose.connection.db.collection("trainers").updateMany({}, { $set: { specialties: [] } });

  tokens.admin = (await login("0999999999")).token;
  tokens.staff = (await login("0900000000")).token;
  tokens.trainer = (await login("0911111111")).token; // HLV Linh
  tokens.customer = (await login("0909090909")).token; // Minh Anh

  const t = await call("/schedule/trainers", { token: tokens.staff });
  coach = {};
  for (const x of t.data.trainers) {
    if (x.name.includes("Linh")) coach.linh = x.id;
    if (x.name.includes("Thu")) coach.thu = x.id;
    if (x.name.includes("Đức")) coach.duc = x.id;
  }
  assert.ok(coach.linh && coach.thu && coach.duc, "phải đủ 3 HLV seed");
});

after(async () => {
  proc?.kill();
  await mongoose.disconnect();
});

// Fixture: khung giờ xa ngoài lưới seed 168h; mỗi test dùng dải giờ riêng
async function createSlot(trainerId, hour) {
  const r = await call("/schedule/pt-slots", {
    method: "POST",
    token: tokens.staff,
    body: { trainerId, startAt: hoursFromNow(hour), endAt: hoursFromNow(hour + 1) },
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data.slot;
}

async function createClass(coachId, hour, serviceType = "pilates") {
  const r = await call("/schedule/classes", {
    method: "POST",
    token: tokens.staff,
    body: {
      name: "Lop test " + hour,
      serviceType,
      coachId,
      startAt: hoursFromNow(hour),
      endAt: hoursFromNow(hour + 1),
      capacity: 5,
    },
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data.class;
}

// Cho Minh Anh (gói pilates + pt seed) đặt 1 lớp/slot qua API thật
async function bookGroup(classId) {
  const r = await call("/bookings", { method: "POST", token: tokens.customer, body: { type: "group", classId } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data.booking;
}
async function bookPT(slotId) {
  const r = await call("/bookings", { method: "POST", token: tokens.customer, body: { type: "pt", slotId } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data.booking;
}

// ---------- 1. Ma trận role ----------

test("matrix: PATCH /schedule/pt-slots/:id — quầy được, HLV/khách 403, anon 401, id rác 400", async () => {
  const slot = await createSlot(coach.duc, 300);
  const body = { startAt: hoursFromNow(302), endAt: hoursFromNow(303) };
  assert.equal((await call(`/schedule/pt-slots/${slot._id}`, { method: "PATCH", body })).status, 401);
  assert.equal((await call(`/schedule/pt-slots/${slot._id}`, { method: "PATCH", token: tokens.customer, body })).status, 403);
  assert.equal((await call(`/schedule/pt-slots/${slot._id}`, { method: "PATCH", token: tokens.trainer, body })).status, 403);
  // her-11: id rác -> 404 "Không tìm thấy khung giờ" (validate id trước khi query)
  assert.equal((await call("/schedule/pt-slots/khong-id", { method: "PATCH", token: tokens.staff, body })).status, 404);
  assert.equal((await call(`/schedule/pt-slots/${slot._id}`, { method: "PATCH", token: tokens.staff, body })).status, 200);
  const admin = await call(`/schedule/pt-slots/${slot._id}`, { method: "PATCH", token: tokens.admin, body: { trainerId: coach.thu } });
  assert.equal(admin.status, 200, JSON.stringify(admin.data));
});

// ---------- 2-3. PT chưa đặt ----------

test("pt-trong: đổi giờ + đổi HLV được; giờ quá khứ / ngược / trùng lịch HLV -> 400 rõ", async () => {
  const slot = await createSlot(coach.duc, 310);

  const moved = await call(`/schedule/pt-slots/${slot._id}`, {
    method: "PATCH", token: tokens.staff,
    body: { startAt: hoursFromNow(312), endAt: hoursFromNow(313), trainerId: coach.thu },
  });
  assert.equal(moved.status, 200, JSON.stringify(moved.data));
  const db = await PTSlot.findById(slot._id);
  assert.equal(db.trainerId.toString(), coach.thu);
  assert.ok(Math.abs(db.startAt - hoursFromNow(312)) < 5000);

  const past = await call(`/schedule/pt-slots/${slot._id}`, {
    method: "PATCH", token: tokens.staff, body: { startAt: hoursFromNow(-5), endAt: hoursFromNow(-4) },
  });
  assert.equal(past.status, 400);
  assert.match(past.data.error, /quá khứ/);

  const reversed = await call(`/schedule/pt-slots/${slot._id}`, {
    method: "PATCH", token: tokens.staff, body: { startAt: hoursFromNow(314), endAt: hoursFromNow(313.5) },
  });
  assert.equal(reversed.status, 400);

  // Trùng giờ: HLV Thu đã có slot 312-313 (chính nó — exclude, không tự báo trùng);
  // tạo thêm lớp cho Thu 315-316 rồi dời slot vào đó -> 400
  await createClass(coach.thu, 315, "yoga");
  const overlap = await call(`/schedule/pt-slots/${slot._id}`, {
    method: "PATCH", token: tokens.staff, body: { startAt: hoursFromNow(315.5), endAt: hoursFromNow(316.5) },
  });
  assert.equal(overlap.status, 400);
  assert.match(overlap.data.error, /trùng giờ/);

  // Sửa chính nó không đổi gì (no-op giờ cũ) -> không tự báo trùng với chính mình
  const noop = await call(`/schedule/pt-slots/${slot._id}`, {
    method: "PATCH", token: tokens.staff, body: { startAt: hoursFromNow(312), endAt: hoursFromNow(313) },
  });
  assert.equal(noop.status, 200, JSON.stringify(noop.data));
});

// ---------- 4-5. PT đã đặt ----------

test("pt-da-dat: chặn đổi giờ; đổi HLV được + đồng bộ booking của khách (title + trainerId)", async () => {
  const slot = await createSlot(coach.duc, 320);
  await bookPT(slot._id);

  const moveTime = await call(`/schedule/pt-slots/${slot._id}`, {
    method: "PATCH", token: tokens.staff, body: { startAt: hoursFromNow(322), endAt: hoursFromNow(323) },
  });
  assert.equal(moveTime.status, 400);
  assert.match(moveTime.data.error, /chỉ đổi được HLV/);

  const swap = await call(`/schedule/pt-slots/${slot._id}`, {
    method: "PATCH", token: tokens.staff, body: { trainerId: coach.linh },
  });
  assert.equal(swap.status, 200, JSON.stringify(swap.data));

  const bk = await Booking.findOne({ slotId: slot._id, status: "booked" });
  assert.equal(bk.trainerId.toString(), coach.linh, "booking phải trỏ sang HLV mới");
  assert.match(bk.title, /HLV Linh/, "title buổi PT phải mang tên HLV mới");

  // Khách nhìn thấy HLV mới trong lịch của mình
  const mine = await call("/me/bookings", { token: tokens.customer });
  const row = mine.data.bookings.find((b) => String(b.slotId) === String(slot._id));
  assert.ok(row, "khách phải còn thấy buổi này");
  assert.match(row.coach, /Linh/);
});

// ---------- 6-7. Lớp có khách ----------

test("lop-co-khach: giờ/tên/bộ môn vẫn khoá; ĐỔI HLV được (16/08) + đồng bộ booking", async () => {
  const cls = await createClass(coach.linh, 330);
  await bookGroup(cls._id);

  for (const body of [
    { startAt: hoursFromNow(332), endAt: hoursFromNow(333) },
    { name: "Ten moi" },
    { serviceType: "yoga" },
  ]) {
    const r = await call(`/schedule/classes/${cls._id}`, { method: "PATCH", token: tokens.staff, body });
    assert.equal(r.status, 400, JSON.stringify({ body, r: r.data }));
    assert.match(r.data.error, /hủy lịch cho khách/i);
  }

  const swap = await call(`/schedule/classes/${cls._id}`, {
    method: "PATCH", token: tokens.staff, body: { coachId: coach.thu },
  });
  assert.equal(swap.status, 200, JSON.stringify(swap.data));
  assert.equal((await GymClass.findById(cls._id)).coachId.toString(), coach.thu);
  const bk = await Booking.findOne({ classId: cls._id, status: "booked" });
  assert.equal(bk.trainerId.toString(), coach.thu, "booking của khách phải theo HLV mới");

});

test("doi-hlv-trung-gio: HLV mới bận giờ đó -> 400; HLV cũ được giải phóng thật", async () => {
  const cls = await createClass(coach.linh, 340);
  await bookGroup(cls._id);
  // HLV Đức bận: có lớp 340-341
  await createClass(coach.duc, 340, "gym");
  const busySwap = await call(`/schedule/classes/${cls._id}`, {
    method: "PATCH", token: tokens.staff, body: { coachId: coach.duc },
  });
  assert.equal(busySwap.status, 400);
  assert.match(busySwap.data.error, /trùng giờ/);

  // Đổi sang Thu (rảnh) -> Linh rảnh giờ 340: giờ tạo được lớp khác cho Linh cùng khung
  const okSwap = await call(`/schedule/classes/${cls._id}`, {
    method: "PATCH", token: tokens.staff, body: { coachId: coach.thu },
  });
  assert.equal(okSwap.status, 200);
  const linhFree = await createClass(coach.linh, 340, "pilates");
  assert.ok(linhFree, "HLV cũ phải rảnh khung giờ đã nhả");
});

// ---------- 9. Roster đổi chủ ----------

test("roster-sau-doi: HLV cũ mất quyền xem roster, lớp chuyển sang HLV mới", async () => {
  // Lớp của Linh (HLV có tài khoản 0911111111) — đặt rồi đổi sang Thu
  const cls = await createClass(coach.linh, 350);
  await bookGroup(cls._id);
  assert.equal((await call(`/management/classes/${cls._id}/roster`, { token: tokens.trainer })).status, 200);

  const swap = await call(`/schedule/classes/${cls._id}`, {
    method: "PATCH", token: tokens.staff, body: { coachId: coach.thu },
  });
  assert.equal(swap.status, 200);

  const after = await call(`/management/classes/${cls._id}/roster`, { token: tokens.trainer });
  assert.equal(after.status, 403, "HLV cũ không còn phụ trách -> không xem được roster");
  assert.equal((await call(`/management/classes/${cls._id}/roster`, { token: tokens.staff })).status, 200);
});

// ---------- Vòng review độc lập her-09: các fix ----------

test("review-fix: PATCH pt-slot sang HLV bị KHOÁ -> 400 nêu lý do", async () => {
  const slot = await createSlot(coach.duc, 360);
  // Khoá tài khoản HLV Linh (0911111111) rồi thử gán khung cho Linh
  const linhAcc = (await call("/accounts?role=trainer", { token: tokens.admin })).data.accounts.find(
    (a) => a.phone === "0911111111"
  );
  await call(`/accounts/${linhAcc.id}`, { method: "PATCH", token: tokens.admin, body: { isActive: false } });
  try {
    const r = await call(`/schedule/pt-slots/${slot._id}`, {
      method: "PATCH", token: tokens.staff, body: { trainerId: coach.linh },
    });
    assert.equal(r.status, 400);
    assert.match(r.data.error, /khoá/);
  } finally {
    await call(`/accounts/${linhAcc.id}`, { method: "PATCH", token: tokens.admin, body: { isActive: true } });
  }
});

test("review-fix: khung/lớp ĐÃ KẾT THÚC không sửa được (lịch sử bất biến)", async () => {
  const trainerDoc = await mongoose.connection.db.collection("trainers").findOne({});
  const pastSlot = await mongoose.connection.db.collection("ptslots").insertOne({
    trainerId: trainerDoc._id, startAt: hoursFromNow(-5), endAt: hoursFromNow(-4), capacity: 1, bookedCount: 1,
  });
  const rSlot = await call(`/schedule/pt-slots/${pastSlot.insertedId}`, {
    method: "PATCH", token: tokens.staff, body: { trainerId: coach.thu },
  });
  assert.equal(rSlot.status, 400);
  assert.match(rSlot.data.error, /kết thúc/);

  const pastClass = await mongoose.connection.db.collection("gymclasses").insertOne({
    name: "Lop da xong", serviceType: "pilates", coachId: trainerDoc._id,
    startAt: hoursFromNow(-6), endAt: hoursFromNow(-5), capacity: 8, bookedCount: 1,
  });
  const rCls = await call(`/schedule/classes/${pastClass.insertedId}`, {
    method: "PATCH", token: tokens.staff, body: { coachId: coach.thu },
  });
  assert.equal(rCls.status, 400);
  assert.match(rCls.data.error, /kết thúc/);
});

test("review-fix (race #1): updateMany KHÔNG gate theo isBooked stale — booking lệch được đồng bộ khi đổi HLV", async () => {
  // Mô phỏng trạng thái giữa-race: slot hiển thị TRỐNG lúc PATCH đọc, nhưng đã có booking
  // "booked" trỏ slot (khách vừa claim + create xen giữa). Trước fix: updateMany bị bỏ qua
  // -> booking kẹt HLV cũ vĩnh viễn. Sau fix: PATCH đổi HLV phải đồng bộ booking này.
  const slot = await createSlot(coach.duc, 370);
  const kh = await mongoose.connection.db.collection("users").findOne({ phone: "0909090909" });
  await Booking.create({
    userId: kh._id, type: "pt", slotId: slot._id, trainerId: coach.duc,
    title: "1:1 PT — HLV Đức", startAt: hoursFromNow(370), endAt: hoursFromNow(371), status: "booked",
  });
  // Slot trong DB vẫn bookedCount:0 (đúng trạng thái stale mà PATCH sẽ đọc)
  const r = await call(`/schedule/pt-slots/${slot._id}`, {
    method: "PATCH", token: tokens.staff, body: { trainerId: coach.thu },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const bk = await Booking.findOne({ slotId: slot._id, status: "booked" });
  assert.equal(bk.trainerId.toString(), coach.thu, "booking lệch phải được đồng bộ sang HLV mới");
  assert.match(bk.title, /HLV Thu/);
});
