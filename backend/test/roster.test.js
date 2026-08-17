// Test her-20 — danh sách khách 1 khung PT (roster) + slotId trong /management/bookings.
// Xem docs-her/testcase/testcase_her-20_roster_attendance.md
// DB riêng her_test_n (tự seed), server cổng 4221.

const { test, before, after } = require("node:test");
const assert = require("node:assert");
const { spawn, spawnSync } = require("node:child_process");
const path = require("node:path");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const ROOT = path.join(__dirname, "..");
const URI = "mongodb://localhost:27017/her_test_n";
const S = "http://localhost:4221/api";

const Booking = require("../src/models/Booking");
const Package = require("../src/models/Package");
const PTSlot = require("../src/models/PTSlot");
const User = require("../src/models/User");

let proc;
const tokens = {};
let linhTrainerId;

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

// Khách mới kèm gói PT còn hạn — mỗi case cần khách sạch để soi hoàn buổi chính xác
let custSeq = 0;
async function makeCustomerWithPT(sessions = 10) {
  const phone = `0972${String(custSeq++).padStart(6, "0")}`;
  const passwordHash = await bcrypt.hash("123456", 10);
  const u = await User.create({ name: `Khach Roster ${custSeq}`, phone, passwordHash, role: "customer" });
  const pkg = await Package.create({
    userId: u._id,
    name: "PT roster test",
    serviceType: "pt",
    price: 1000000,
    totalSessions: sessions,
    activatedAt: new Date(),
    expiresAt: hoursFromNow(24 * 30),
  });
  const { token } = await login(phone);
  return { user: u, pkg, token };
}

let slotHour = 300; // xa cửa sổ slot seed để không trùng giờ HLV
async function makeSlot({ capacity = 1 } = {}) {
  const start = hoursFromNow((slotHour += 2));
  const end = new Date(start.getTime() + 3600 * 1000);
  const r = await call("/schedule/pt-slots", {
    method: "POST", token: tokens.staff,
    body: { trainerId: linhTrainerId.toString(), startAt: start, endAt: end, capacity },
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data.slot._id || r.data.slot.id;
}

const book = (slotId, token) =>
  call("/bookings", { method: "POST", token, body: { type: "pt", slotId: slotId.toString() } });

before(async () => {
  const seeded = spawnSync(process.execPath, ["src/scripts/seed.js"], {
    cwd: ROOT,
    env: { ...process.env, MONGODB_URI: URI },
    stdio: "ignore",
  });
  assert.equal(seeded.status, 0, "seed her_test_n thất bại");
  proc = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: "4221", MONGODB_URI: URI, JWT_SECRET: "testsecret", MIN_CANCEL_HOURS: "3" },
    stdio: "ignore",
  });
  await waitHealthy(S);
  await mongoose.connect(URI);

  tokens.admin = (await login("0999999999")).token;
  tokens.staff = (await login("0900000000")).token;
  tokens.trainer = (await login("0911111111")).token; // HLV Linh
  tokens.customer = (await login("0909090909")).token; // Minh Anh
  linhTrainerId = (await User.findOne({ phone: "0911111111" })).trainerId;

  // HLV thứ 2 CÓ TÀI KHOẢN (seed chỉ Linh có login) — để test "không phải khung của mình"
  const r = await call("/accounts", {
    method: "POST", token: tokens.admin,
    body: { role: "trainer", name: "HLV Khac", phone: "0972999999", password: "123456", specialties: ["gym"] },
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  tokens.otherTrainer = (await login("0972999999")).token;
});

after(async () => {
  proc?.kill();
  await mongoose.disconnect();
});

// ---------- 1. Ma trận role ----------

test("roster-matrix: quầy/admin 200 kèm SĐT; HLV chủ khung 200 KHÔNG SĐT; HLV khác 403; khách 403; anon 401", async () => {
  const slotId = await makeSlot({ capacity: 3 });
  const { user: kh } = await makeCustomerWithPT();
  const khToken = (await login(kh.phone)).token;
  assert.equal((await book(slotId, khToken)).status, 201);

  for (const t of [tokens.staff, tokens.admin]) {
    const r = await call(`/management/pt-slots/${slotId}/roster`, { token: t });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.customers.length, 1);
    assert.ok(r.data.customers[0].phone, "quầy/admin phải thấy SĐT khách");
  }

  const rT = await call(`/management/pt-slots/${slotId}/roster`, { token: tokens.trainer });
  assert.equal(rT.status, 200, JSON.stringify(rT.data));
  assert.equal("phone" in rT.data.customers[0], false, "HLV KHÔNG được nhận field SĐT (B15)");

  assert.equal((await call(`/management/pt-slots/${slotId}/roster`, { token: tokens.otherTrainer })).status, 403);
  assert.equal((await call(`/management/pt-slots/${slotId}/roster`, { token: tokens.customer })).status, 403);
  assert.equal((await call(`/management/pt-slots/${slotId}/roster`, {})).status, 401);
});

// ---------- 2. Input bất thường (L1) ----------

test("roster-bad-input: ObjectId rác 400, id không tồn tại 404 — đều có { error }", async () => {
  const bad = await call("/management/pt-slots/khong-phai-id/roster", { token: tokens.staff });
  assert.equal(bad.status, 400);
  assert.ok(bad.data.error, "phải có message tiếng Việt");
  const missing = await call(`/management/pt-slots/${new mongoose.Types.ObjectId()}/roster`, { token: tokens.staff });
  assert.equal(missing.status, 404);
  assert.ok(missing.data.error);
});

// ---------- 3. Nội dung roster ----------

test("roster-content: chỉ hiện khách chưa hủy; slot trả capacity/bookedCount/title PT nhóm", async () => {
  const slotId = await makeSlot({ capacity: 3 });
  const a = await makeCustomerWithPT();
  const b = await makeCustomerWithPT();
  const rA = await book(slotId, a.token);
  assert.equal(rA.status, 201);
  assert.equal((await book(slotId, b.token)).status, 201);

  // Khách A hủy (còn xa giờ tập — tự hủy được)
  const bookingAId = rA.data.booking.id || rA.data.booking._id;
  assert.equal((await call(`/bookings/${bookingAId}`, { method: "DELETE", token: a.token })).status, 200);

  const r = await call(`/management/pt-slots/${slotId}/roster`, { token: tokens.staff });
  assert.equal(r.status, 200);
  assert.equal(r.data.customers.length, 1, "khách đã hủy không được hiện trong roster");
  assert.equal(r.data.customers[0].name, b.user.name);
  assert.equal(r.data.slot.capacity, 3);
  assert.equal(r.data.slot.bookedCount, 1);
  assert.match(r.data.slot.title, /^PT nhóm/, "khung capacity>1 phải mang tên PT nhóm");
  assert.ok(r.data.slot.startAt && r.data.slot.coach);
});

// ---------- 4. /management/bookings trả slotId ----------

test("bookings-slotid: booking PT có slotId, booking group có classId (để app gộp theo buổi)", async () => {
  const slotId = await makeSlot({ capacity: 2 });
  const { token } = await makeCustomerWithPT();
  assert.equal((await book(slotId, token)).status, 201);

  const r = await call("/management/bookings?range=upcoming&limit=200", { token: tokens.staff });
  assert.equal(r.status, 200);
  const pt = r.data.bookings.find((x) => String(x.slotId) === String(slotId));
  assert.ok(pt, "booking PT phải trả slotId");
  assert.equal(pt.type, "pt");
  const group = r.data.bookings.find((x) => x.type === "group");
  assert.ok(group, "seed phải có booking group sắp tới");
  assert.ok(group.classId, "booking group phải trả classId");
});

// ---------- 4b. her-22: bookings trả serviceType (ô tìm theo bộ môn ở màn Lịch tập) ----------

test("bookings-servicetype: group = bộ môn lớp (classId vẫn là ID), pt = 'pt'", async () => {
  const r = await call("/management/bookings?range=all&limit=200", { token: tokens.staff });
  assert.equal(r.status, 200);
  const group = r.data.bookings.find((x) => x.type === "group");
  assert.ok(group, "seed phải có booking group");
  assert.ok(["gym", "pilates", "yoga"].includes(group.serviceType), `serviceType lớp sai: ${group.serviceType}`);
  // populate không được làm classId thành object — app đang so sánh/gộp theo ID
  assert.equal(typeof group.classId, "string", `classId phải là ID chuỗi, nhận: ${JSON.stringify(group.classId)}`);
  const pt = r.data.bookings.find((x) => x.type === "pt");
  assert.ok(pt, "phải có booking PT (test trước đã tạo)");
  assert.equal(pt.serviceType, "pt");
});

// ---------- 4c. her-25: range=past — tab Lịch sử (chỉ buổi đã qua, mới nhất trước) ----------

test("bookings-past: chỉ buổi ĐÃ KẾT THÚC — buổi ĐANG DIỄN RA nằm ở Hôm nay, không vào Lịch sử", async () => {
  // Chốt 16/08: đang diễn ra chưa phải lịch sử — tạo 1 buổi startAt -30' endAt +30'
  const ongoing = await Booking.create({
    userId: (await User.findOne({ phone: "0909090909" }))._id,
    type: "pt", title: "PT dang dien ra", trainerId: linhTrainerId,
    startAt: new Date(Date.now() - 30 * 60 * 1000),
    endAt: new Date(Date.now() + 30 * 60 * 1000),
    status: "booked",
  });
  const r = await call("/management/bookings?range=past&limit=200", { token: tokens.staff });
  assert.equal(r.status, 200);
  const now = Date.now();
  assert.ok(
    !r.data.bookings.some((b) => String(b.id) === String(ongoing._id)),
    "buổi đang diễn ra KHÔNG được nằm trong Lịch sử"
  );
  for (const b of r.data.bookings) {
    assert.ok(new Date(b.endAt).getTime() < now, `buổi chưa kết thúc lẫn vào past: ${b.endAt}`);
  }
  const today = await call("/management/bookings?range=today&limit=200", { token: tokens.staff });
  assert.ok(
    today.data.bookings.some((b) => String(b.id) === String(ongoing._id)),
    "buổi đang diễn ra phải nằm ở Hôm nay"
  );
  await Booking.deleteOne({ _id: ongoing._id }); // dọn — không ảnh hưởng test sau
  assert.ok(r.data.bookings.length > 0, "seed có lịch sử điểm danh — past không được rỗng");
  for (const b of r.data.bookings) {
    assert.ok(new Date(b.startAt).getTime() < now, `buổi tương lai lẫn vào past: ${b.startAt}`);
  }
  for (let i = 1; i < r.data.bookings.length; i++) {
    assert.ok(
      new Date(r.data.bookings[i - 1].startAt) >= new Date(r.data.bookings[i].startAt),
      "past phải sort MỚI NHẤT trước (giảm dần)"
    );
  }
  // Buổi tương lai (thấy được ở upcoming) không có trong past
  const up = await call("/management/bookings?range=upcoming&limit=200", { token: tokens.staff });
  const pastIds = new Set(r.data.bookings.map((b) => String(b.id)));
  for (const b of up.data.bookings) {
    assert.ok(!pastIds.has(String(b.id)), "booking sắp tới không được nằm trong past");
  }
});

// ---------- 4d. her-28: /me/history phân trang (mục "Đã qua" của khách tải dần) ----------

test("me-history-paging: 25 buổi lịch sử — limit 20 trang 1 + hasMore, trang 2 = 5; sort mới nhất trước", async () => {
  const phone = "0975000030";
  const passwordHash = await bcrypt.hash("123456", 10);
  const u = await User.create({ name: "Khach Nhieu Lich Su", phone, passwordHash, role: "customer" });
  const docs = [];
  for (let i = 0; i < 25; i++) {
    const start = new Date(Date.now() - (i + 1) * 24 * 3600 * 1000);
    docs.push({
      userId: u._id, type: "group", title: `Buoi cu ${i}`, trainerId: linhTrainerId,
      startAt: start, endAt: new Date(start.getTime() + 3600 * 1000),
      status: "completed", attendanceAt: start,
    });
  }
  await Booking.insertMany(docs);
  const { token } = await login(phone);

  const p1 = await call("/me/history?limit=20&page=1", { token });
  assert.equal(p1.status, 200);
  assert.equal(p1.data.bookings.length, 20);
  assert.equal(p1.data.hasMore, true, "còn trang sau");
  for (let i = 1; i < p1.data.bookings.length; i++) {
    assert.ok(
      new Date(p1.data.bookings[i - 1].startAt) >= new Date(p1.data.bookings[i].startAt),
      "phải sort mới nhất trước"
    );
  }
  const p2 = await call("/me/history?limit=20&page=2", { token });
  assert.equal(p2.data.bookings.length, 5);
  assert.equal(p2.data.hasMore, false);
  // Không truyền gì -> mặc định như cũ (50) — client cũ không vỡ
  const legacy = await call("/me/history", { token });
  assert.equal(legacy.status, 200);
  assert.equal(legacy.data.bookings.length, 25);

  // Chốt 16/08: buổi điểm danh SỚM (completed nhưng CHƯA kết thúc) chưa phải lịch sử —
  // vẫn nằm ở "Sắp tới"; buổi ĐÃ HỦY (kể cả buổi tương lai) thì vào lịch sử ngay
  const early = await Booking.create({
    userId: u._id, type: "group", title: "Diem danh som", trainerId: linhTrainerId,
    startAt: new Date(Date.now() - 10 * 60 * 1000), endAt: new Date(Date.now() + 50 * 60 * 1000),
    status: "completed", attendanceAt: new Date(),
  });
  const futureCancelled = await Booking.create({
    userId: u._id, type: "group", title: "Huy buoi mai", trainerId: linhTrainerId,
    startAt: new Date(Date.now() + 24 * 3600 * 1000), endAt: new Date(Date.now() + 25 * 3600 * 1000),
    status: "cancelled", cancelledAt: new Date(),
  });
  const h = await call("/me/history?limit=100", { token });
  const ids = h.data.bookings.map((b) => String(b.id));
  assert.ok(!ids.includes(String(early._id)), "buổi điểm danh sớm chưa kết thúc KHÔNG vào lịch sử");
  assert.ok(ids.includes(String(futureCancelled._id)), "buổi đã hủy vào lịch sử ngay");
  const mine = await call("/me/bookings", { token });
  assert.ok(
    mine.data.bookings.some((b) => String(b.id) === String(early._id)),
    "buổi điểm danh sớm vẫn nằm ở Sắp tới"
  );
});

// ---------- 4e. her-31: mine=1 — admin kiêm HLV xem "lịch của tôi" ----------

test("her-31 mine: admin kiêm HLV ?mine=1 chỉ thấy lịch/khung của MÌNH; lễ tân mine=1 vô hại", async () => {
  // Admin mở hồ sơ HLV (nếu suite khác chưa mở trong DB này)
  const opened = await call("/me/trainer-profile", {
    method: "POST", token: tokens.admin, body: { name: "Chu Kiem HLV", specialties: ["pilates"] },
  });
  assert.ok([200, 201, 400].includes(opened.status)); // 400 = đã mở từ trước
  const adminTrainerId = (await User.findOne({ phone: "0999999999" })).trainerId;
  assert.ok(adminTrainerId, "admin phải có trainerId sau khi mở hồ sơ");

  // Khung PT của admin + 1 khách đặt (để có booking coach = admin)
  const start = hoursFromNow(500);
  const end = new Date(start.getTime() + 3600 * 1000);
  const slotRes = await call("/schedule/pt-slots", {
    method: "POST", token: tokens.admin,
    body: { trainerId: adminTrainerId.toString(), startAt: start, endAt: end, capacity: 1 },
  });
  assert.equal(slotRes.status, 201, JSON.stringify(slotRes.data));
  const kh = await makeCustomerWithPT();
  assert.equal((await book(slotRes.data.slot._id || slotRes.data.slot.id, kh.token)).status, 201);

  // mine=1: bookings chỉ của mình
  const mineBk = await call("/management/bookings?range=upcoming&mine=1&limit=200", { token: tokens.admin });
  assert.equal(mineBk.status, 200);
  assert.ok(mineBk.data.bookings.length >= 1, "phải thấy booking khung của mình");
  for (const b of mineBk.data.bookings) {
    assert.equal(b.coach, "Chu Kiem HLV", `lẫn buổi của HLV khác: ${b.coach}`);
  }
  // không mine: thấy cả HLV khác (seed có lịch của Linh/Đức/Thu)
  const allBk = await call("/management/bookings?range=upcoming&limit=200", { token: tokens.admin });
  assert.ok(allBk.data.bookings.some((b) => b.coach !== "Chu Kiem HLV"), "không mine phải thấy tất cả");

  // mine=1: pt-slots chỉ khung của mình
  const to = hoursFromNow(24 * 366).toISOString();
  const mineSlots = await call(`/schedule/pt-slots?mine=1&to=${to}`, { token: tokens.admin });
  assert.ok(mineSlots.data.slots.length >= 1);
  for (const sl of mineSlots.data.slots) {
    assert.equal(String(sl.trainerId), String(adminTrainerId), "lẫn khung HLV khác");
  }
  const allSlots = await call(`/schedule/pt-slots?to=${to}`, { token: tokens.admin });
  assert.ok(allSlots.data.slots.some((sl) => String(sl.trainerId) !== String(adminTrainerId)));

  // Lễ tân (không trainerId) mine=1 → bỏ qua filter, không lỗi
  const staffMine = await call("/management/bookings?range=upcoming&mine=1&limit=200", { token: tokens.staff });
  assert.equal(staffMine.status, 200);
  assert.ok(staffMine.data.bookings.some((b) => b.coach !== "Chu Kiem HLV"), "lễ tân mine=1 vẫn thấy tất cả");
});

// ---------- 5. Hủy từ roster → hoàn buổi đúng gói + trả chỗ (C2/H1) ----------

test("roster-cancel-refund: quầy hủy khách trong khung nhóm — hoàn buổi đúng gói, bookedCount giảm, roster sạch", async () => {
  const slotId = await makeSlot({ capacity: 2 });
  const kh = await makeCustomerWithPT();
  const rBook = await book(slotId, kh.token);
  assert.equal(rBook.status, 201);
  const after1 = await Package.findById(kh.pkg._id);
  assert.equal(after1.usedSessions, 1, "đặt xong phải trừ 1 buổi");

  const bookingId = rBook.data.booking.id || rBook.data.booking._id;
  const rCancel = await call(`/bookings/${bookingId}`, { method: "DELETE", token: tokens.staff });
  assert.equal(rCancel.status, 200, JSON.stringify(rCancel.data));

  const after2 = await Package.findById(kh.pkg._id);
  assert.equal(after2.usedSessions, 0, "hủy phải hoàn buổi về ĐÚNG gói đã trừ (C2)");
  const slot = await PTSlot.findById(slotId);
  assert.equal(slot.bookedCount, 0, "chỗ trong khung phải được trả lại");

  const roster = await call(`/management/pt-slots/${slotId}/roster`, { token: tokens.staff });
  assert.equal(roster.data.customers.length, 0, "roster không còn khách đã hủy");
});

// ---------- 6. Review-fix (N5): HLV không hủy hộ được — kể cả khách trong khung của MÌNH ----------

test("roster-trainer-no-cancel: HLV chủ khung DELETE booking của khách -> 403, booking còn nguyên", async () => {
  const slotId = await makeSlot({ capacity: 2 });
  const kh = await makeCustomerWithPT();
  const rBook = await book(slotId, kh.token);
  assert.equal(rBook.status, 201);
  const bookingId = rBook.data.booking.id || rBook.data.booking._id;

  // App ẩn nút (canCancel=false) nhưng phân quyền thật phải nằm ở server (H5/C1)
  const r = await call(`/bookings/${bookingId}`, { method: "DELETE", token: tokens.trainer });
  assert.equal(r.status, 403, JSON.stringify(r.data));
  assert.ok(r.data.error);
  const still = await Booking.findById(bookingId);
  assert.equal(still.status, "booked", "booking không được đổi trạng thái");
});
