// Test her-11 — Mục 6: HLV tự mở lịch dạy + PT nhóm.
// Xem docs-her/testcase/testcase_her-11_pt_group.md
// DB riêng her_test_i (tự seed), server cổng 4171.

const { test, before, after } = require("node:test");
const assert = require("node:assert");
const { spawn, spawnSync } = require("node:child_process");
const path = require("node:path");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const ROOT = path.join(__dirname, "..");
const URI = "mongodb://localhost:27017/her_test_i";
const S = "http://localhost:4171/api";

const Booking = require("../src/models/Booking");
const Package = require("../src/models/Package");
const PTSlot = require("../src/models/PTSlot");
const GymClass = require("../src/models/GymClass");
const Trainer = require("../src/models/Trainer");
const User = require("../src/models/User");

let proc;
const tokens = {};
let linhTrainerId; // hồ sơ Trainer của HLV Linh (tài khoản 0911111111)
let otherTrainerId; // 1 HLV khác để test "không phải của mình"

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

// Tạo khách mới kèm gói PT còn hạn — cho các case cần nhiều khách đặt cùng khung
let custSeq = 0;
async function makeCustomerWithPT(sessions = 10) {
  const phone = `0971${String(custSeq++).padStart(6, "0")}`;
  const passwordHash = await bcrypt.hash("123456", 10);
  const u = await User.create({ name: `Khach PT ${custSeq}`, phone, passwordHash, role: "customer" });
  await Package.create({
    userId: u._id,
    name: "PT test",
    serviceType: "pt",
    price: 1000000,
    totalSessions: sessions,
    activatedAt: new Date(),
    expiresAt: hoursFromNow(24 * 30),
  });
  const { token } = await login(phone);
  return { user: u, token };
}

// Tạo khung PT qua API (mặc định bằng token quầy)
let slotHour = 170; // ngoài cửa sổ 7 ngày slot seed — tránh trùng giờ HLV; đẩy xa dần
async function makeSlot({ trainerId = linhTrainerId, capacity, token = tokens.staff, hoursAhead } = {}) {
  const start = hoursFromNow(hoursAhead ?? (slotHour += 2));
  const end = new Date(start.getTime() + 3600 * 1000);
  const body = { trainerId: trainerId.toString(), startAt: start, endAt: end };
  if (capacity !== undefined) body.capacity = capacity;
  return { r: await call("/schedule/pt-slots", { method: "POST", token, body }), start, end };
}

const book = (slotId, token) =>
  call("/bookings", { method: "POST", token, body: { type: "pt", slotId: slotId.toString() } });

before(async () => {
  const seeded = spawnSync(process.execPath, ["src/scripts/seed.js"], {
    cwd: ROOT,
    env: { ...process.env, MONGODB_URI: URI },
    stdio: "ignore",
  });
  assert.equal(seeded.status, 0, "seed her_test_i thất bại");
  proc = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: "4171", MONGODB_URI: URI, JWT_SECRET: "testsecret", MIN_CANCEL_HOURS: "3" },
    stdio: "ignore",
  });
  await waitHealthy(S);
  await mongoose.connect(URI);

  tokens.admin = (await login("0999999999")).token;
  tokens.staff = (await login("0900000000")).token;
  tokens.trainer = (await login("0911111111")).token; // HLV Linh
  tokens.customer = (await login("0909090909")).token; // Minh Anh
  linhTrainerId = (await User.findOne({ phone: "0911111111" })).trainerId;
  const other = await Trainer.findOne({ _id: { $ne: linhTrainerId } });
  otherTrainerId = other._id;
});

after(async () => {
  proc?.kill();
  await mongoose.disconnect();
});

// ---------- 1. Ma trận tạo khung ----------

test("matrix-create: quầy tạo cho HLV bất kỳ; HLV chỉ tạo cho mình; khách 403; anon 401", async () => {
  // Quầy + admin: tạo cho HLV bất kỳ
  assert.equal((await makeSlot({ token: tokens.staff })).r.status, 201);
  assert.equal((await makeSlot({ token: tokens.admin, trainerId: otherTrainerId })).r.status, 201);

  // HLV: tạo cho CHÍNH MÌNH được
  const own = await makeSlot({ token: tokens.trainer, trainerId: linhTrainerId });
  assert.equal(own.r.status, 201, JSON.stringify(own.r.data));

  // HLV tạo cho HLV KHÁC -> 403
  const forOther = await makeSlot({ token: tokens.trainer, trainerId: otherTrainerId });
  assert.equal(forOther.r.status, 403);

  // Khách -> 403; anon -> 401
  assert.equal((await makeSlot({ token: tokens.customer })).r.status, 403);
  assert.equal((await makeSlot({ token: null })).r.status, 401);
});

// ---------- 2. Validate capacity ----------

test("capacity-validate: 0/11/2.5/chữ -> 400; thiếu -> mặc định 1", async () => {
  for (const bad of [0, 11, 2.5, "abc", -1]) {
    const { r } = await makeSlot({ capacity: bad });
    assert.equal(r.status, 400, `capacity ${bad} phải bị chặn`);
    assert.ok(r.data.error, "phải có message tiếng Việt");
  }
  const { r } = await makeSlot({});
  assert.equal(r.status, 201);
  assert.equal(r.data.slot.capacity, 1, "thiếu capacity thì mặc định 1 (PT 1:1)");
});

// ---------- 3. HLV sửa/xoá khung trống của mình ----------

test("trainer-edit: khung trống của mình sửa/xoá được; của người khác 403; có khách 400; không đổi được trainerId", async () => {
  const { r } = await makeSlot({ token: tokens.trainer, trainerId: linhTrainerId, capacity: 2 });
  const slotId = r.data.slot._id || r.data.slot.id;

  // Sửa giờ + capacity khung trống của mình -> OK
  const newStart = hoursFromNow(600);
  const newEnd = new Date(newStart.getTime() + 3600 * 1000);
  const edit = await call(`/schedule/pt-slots/${slotId}`, {
    method: "PATCH", token: tokens.trainer, body: { startAt: newStart, endAt: newEnd, capacity: 3 },
  });
  assert.equal(edit.status, 200, JSON.stringify(edit.data));
  assert.equal(edit.data.slot.capacity, 3);

  // HLV gửi trainerId (kể cả của chính mình) -> từ chối, tránh lách đổi chủ khung
  const reassign = await call(`/schedule/pt-slots/${slotId}`, {
    method: "PATCH", token: tokens.trainer, body: { trainerId: otherTrainerId.toString() },
  });
  assert.equal(reassign.status, 403);

  // Khung của HLV khác -> 403 (cả sửa lẫn xoá)
  const { r: rOther } = await makeSlot({ trainerId: otherTrainerId });
  const otherId = rOther.data.slot._id || rOther.data.slot.id;
  assert.equal((await call(`/schedule/pt-slots/${otherId}`, { method: "PATCH", token: tokens.trainer, body: { capacity: 2 } })).status, 403);
  assert.equal((await call(`/schedule/pt-slots/${otherId}`, { method: "DELETE", token: tokens.trainer })).status, 403);

  // Khung ĐÃ có khách -> HLV không sửa/xoá được (400)
  const { token: c1 } = await makeCustomerWithPT();
  assert.equal((await book(slotId, c1)).status, 201);
  assert.equal((await call(`/schedule/pt-slots/${slotId}`, { method: "PATCH", token: tokens.trainer, body: { capacity: 4 } })).status, 400);
  assert.equal((await call(`/schedule/pt-slots/${slotId}`, { method: "DELETE", token: tokens.trainer })).status, 400);

  // Xoá khung trống của mình -> OK
  const { r: rEmpty } = await makeSlot({ token: tokens.trainer, trainerId: linhTrainerId });
  const emptyId = rEmpty.data.slot._id || rEmpty.data.slot.id;
  assert.equal((await call(`/schedule/pt-slots/${emptyId}`, { method: "DELETE", token: tokens.trainer })).status, 200);
});

// ---------- 4. PT nhóm đặt tới đủ người ----------

test("group-fill: capacity 3 — 3 khách OK (trừ gói pt), khách 4 bị 400 kín chỗ", async () => {
  const { r } = await makeSlot({ capacity: 3 });
  const slotId = r.data.slot._id || r.data.slot.id;

  const custs = await Promise.all([1, 2, 3, 4].map(() => makeCustomerWithPT()));
  for (let i = 0; i < 3; i++) {
    const b = await book(slotId, custs[i].token);
    assert.equal(b.status, 201, JSON.stringify(b.data));
    const pkg = await Package.findOne({ userId: custs[i].user._id });
    assert.equal(pkg.usedSessions, 1, "phải trừ 1 buổi gói PT thường");
  }
  const b4 = await book(slotId, custs[3].token);
  assert.equal(b4.status, 400);
  assert.match(b4.data.error, /kín|hết chỗ/i);
  // Khách 4 không bị trừ buổi oan (C2)
  assert.equal((await Package.findOne({ userId: custs[3].user._id })).usedSessions, 0);
  assert.equal((await PTSlot.findById(slotId)).bookedCount, 3);
});

// ---------- 5. RACE chỗ cuối (L2/C3) ----------

test("race: capacity 2 — 3 khách đặt SONG SONG, đúng 2 thành công, bookedCount không vượt", async () => {
  const { r } = await makeSlot({ capacity: 2 });
  const slotId = r.data.slot._id || r.data.slot.id;
  const custs = await Promise.all([1, 2, 3].map(() => makeCustomerWithPT()));

  const results = await Promise.all(custs.map((c) => book(slotId, c.token)));
  const ok = results.filter((x) => x.status === 201).length;
  const fail = results.filter((x) => x.status === 400).length;
  assert.equal(ok, 2, `đúng 2 người thắng (thực tế ${ok}): ${JSON.stringify(results.map((x) => x.status))}`);
  assert.equal(fail, 1);
  assert.equal((await PTSlot.findById(slotId)).bookedCount, 2, "bookedCount không được vượt capacity");

  // Người thua không mất buổi (C2)
  for (let i = 0; i < 3; i++) {
    const used = (await Package.findOne({ userId: custs[i].user._id })).usedSessions;
    assert.equal(used, results[i].status === 201 ? 1 : 0);
  }
});

// ---------- 6. Bấm đúp ----------

test("double-tap: 1 khách gửi 2 request song song cùng slot -> 1 booking, trừ 1 buổi", async () => {
  const { r } = await makeSlot({ capacity: 5 });
  const slotId = r.data.slot._id || r.data.slot.id;
  const { user, token } = await makeCustomerWithPT();

  const [a, b] = await Promise.all([book(slotId, token), book(slotId, token)]);
  const statuses = [a.status, b.status].sort();
  assert.deepEqual(statuses, [201, 400], `1 thành công 1 bị chặn: ${statuses}`);
  assert.equal(await Booking.countDocuments({ userId: user._id, slotId, status: "booked" }), 1);
  assert.equal((await Package.findOne({ userId: user._id })).usedSessions, 1, "chỉ trừ đúng 1 buổi");
  assert.equal((await PTSlot.findById(slotId)).bookedCount, 1, "bấm đúp không được chiếm 2 chỗ");
});

// ---------- 7. Đặt lại slot đã đặt ----------

test("re-book: đặt lại slot mình đã đặt -> 400 'đã đặt'; kể cả sau khi bị điểm danh sớm", async () => {
  // Khung 24' nữa (trong cửa điểm danh 30') — chèn DB trực tiếp để không vướng slot seed gần giờ
  const start = new Date(Date.now() + 24 * 60 * 1000);
  const slotDoc = await PTSlot.create({
    trainerId: linhTrainerId, startAt: start, endAt: new Date(start.getTime() + 50 * 60 * 1000), capacity: 3,
  });
  const slotId = slotDoc._id;
  const { user, token } = await makeCustomerWithPT();

  assert.equal((await book(slotId, token)).status, 201);
  const again = await book(slotId, token);
  assert.equal(again.status, 400);
  assert.match(again.data.error, /đã đặt/i);

  // Quầy điểm danh SỚM (status completed) -> vẫn không đặt lại được (bài học her-10 #2)
  const bk = await Booking.findOne({ userId: user._id, slotId });
  const att = await call(`/management/bookings/${bk._id}/attendance`, {
    method: "PATCH", token: tokens.staff, body: { present: true },
  });
  assert.equal(att.status, 200, JSON.stringify(att.data));
  const afterAtt = await book(slotId, token);
  assert.equal(afterAtt.status, 400, "điểm danh sớm không được mở khe đặt lại (trừ buổi kép)");
});

// ---------- 8. Hủy trả chỗ + hoàn đúng gói ----------

test("cancel-frees: hủy 1 người trong nhóm -> bookedCount -1, người mới đặt được, hoàn đúng gói", async () => {
  const { r } = await makeSlot({ capacity: 2 });
  const slotId = r.data.slot._id || r.data.slot.id;
  const [c1, c2, c3] = await Promise.all([1, 2, 3].map(() => makeCustomerWithPT()));

  assert.equal((await book(slotId, c1.token)).status, 201);
  assert.equal((await book(slotId, c2.token)).status, 201);
  assert.equal((await book(slotId, c3.token)).status, 400, "đã kín");

  const bk1 = await Booking.findOne({ userId: c1.user._id, slotId });
  assert.equal((await call(`/bookings/${bk1._id}`, { method: "DELETE", token: c1.token })).status, 200);

  assert.equal((await PTSlot.findById(slotId)).bookedCount, 1, "hủy phải trả chỗ");
  assert.equal((await Package.findOne({ userId: c1.user._id })).usedSessions, 0, "hoàn buổi về đúng gói (C2)");
  assert.equal((await book(slotId, c3.token)).status, 201, "chỗ vừa nhả phải đặt được ngay");
});

// ---------- 9. Title theo loại ----------

test("title: capacity 1 -> '1:1 PT — …'; capacity >1 -> 'PT nhóm — …'; đổi HLV giữ đúng dạng", async () => {
  const { r: r1 } = await makeSlot({ capacity: 1 });
  const { r: r3 } = await makeSlot({ capacity: 3 });
  const [c1, c2] = await Promise.all([makeCustomerWithPT(), makeCustomerWithPT()]);
  assert.equal((await book(r1.data.slot._id || r1.data.slot.id, c1.token)).status, 201);
  assert.equal((await book(r3.data.slot._id || r3.data.slot.id, c2.token)).status, 201);

  const b1 = await Booking.findOne({ userId: c1.user._id });
  const b3 = await Booking.findOne({ userId: c2.user._id });
  assert.match(b1.title, /^1:1 PT — /);
  assert.match(b3.title, /^PT nhóm — /);

  // Quầy đổi HLV khung nhóm -> title booking sync và GIỮ dạng "PT nhóm"
  const slot3Id = r3.data.slot._id || r3.data.slot.id;
  const sw = await call(`/schedule/pt-slots/${slot3Id}`, {
    method: "PATCH", token: tokens.staff, body: { trainerId: otherTrainerId.toString() },
  });
  assert.equal(sw.status, 200, JSON.stringify(sw.data));
  const b3after = await Booking.findById(b3._id);
  const otherName = (await Trainer.findById(otherTrainerId)).name;
  assert.equal(b3after.title, `PT nhóm — ${otherName}`);
  assert.equal(b3after.trainerId.toString(), otherTrainerId.toString());
});

// ---------- 10. Quầy sửa capacity ----------

test("staff-capacity: tăng capacity khung có khách OK; giảm dưới bookedCount -> 400", async () => {
  const { r } = await makeSlot({ capacity: 2 });
  const slotId = r.data.slot._id || r.data.slot.id;
  const [c1, c2] = await Promise.all([makeCustomerWithPT(), makeCustomerWithPT()]);
  assert.equal((await book(slotId, c1.token)).status, 201);
  assert.equal((await book(slotId, c2.token)).status, 201);

  // Tăng 2 -> 4: người mới đặt thêm được
  const up = await call(`/schedule/pt-slots/${slotId}`, { method: "PATCH", token: tokens.staff, body: { capacity: 4 } });
  assert.equal(up.status, 200, JSON.stringify(up.data));
  const { token: c3 } = await makeCustomerWithPT();
  assert.equal((await book(slotId, c3)).status, 201);

  // Giảm 4 -> 2 khi đã có 3 khách -> 400, không "đuổi" khách
  const down = await call(`/schedule/pt-slots/${slotId}`, { method: "PATCH", token: tokens.staff, body: { capacity: 2 } });
  assert.equal(down.status, 400);
  assert.equal((await PTSlot.findById(slotId)).capacity, 4, "capacity giữ nguyên khi giảm bị chặn");
});

// ---------- 11. Admin mở hồ sơ HLV ----------

test("admin-trainer: admin mở hồ sơ HLV 1 lần, xuất hiện trong danh sách, khách đặt được; role khác 403", async () => {
  // Role khác -> 403
  for (const t of [tokens.staff, tokens.trainer, tokens.customer]) {
    assert.equal((await call("/me/trainer-profile", { method: "POST", token: t, body: { name: "X" } })).status, 403);
  }

  const r1 = await call("/me/trainer-profile", {
    method: "POST", token: tokens.admin, body: { name: "Cô Chủ", specialties: ["pilates"] },
  });
  assert.equal(r1.status, 201, JSON.stringify(r1.data));
  const adminUser = await User.findOne({ phone: "0999999999" });
  assert.ok(adminUser.trainerId, "user admin phải được gán trainerId");

  // Lần 2 -> 400
  assert.equal((await call("/me/trainer-profile", { method: "POST", token: tokens.admin, body: { name: "Y", specialties: ["pilates"] } })).status, 400);

  // Xuất hiện trong danh sách HLV phía khách
  const list = await call("/trainers", { token: tokens.customer });
  const found = list.data.trainers.find((t) => t.name === "Cô Chủ");
  assert.ok(found, "admin kiêm HLV phải hiện trong danh sách");

  // Admin tự mở khung cho mình (qua API xếp lịch) và khách đặt được
  const { r: slotR } = await makeSlot({ token: tokens.admin, trainerId: adminUser.trainerId, capacity: 2 });
  assert.equal(slotR.status, 201);
  const { token: cust } = await makeCustomerWithPT();
  assert.equal((await book(slotR.data.slot._id || slotR.data.slot.id, cust)).status, 201);
});

// ---------- 12. HLV không trùng giờ chính mình ----------

test("self-overlap: HLV mở khung đè giờ khung sẵn có của mình -> 400", async () => {
  const first = await makeSlot({ token: tokens.trainer, trainerId: linhTrainerId });
  assert.equal(first.r.status, 201);
  const dup = await call("/schedule/pt-slots", {
    method: "POST", token: tokens.trainer,
    body: { trainerId: linhTrainerId.toString(), startAt: first.start, endAt: first.end },
  });
  assert.equal(dup.status, 400);
  assert.match(dup.data.error, /trùng giờ/i);
});

// ---------- 13. HLV chỉ thấy khung của mình ----------

test("trainer-list: GET /schedule/pt-slots — HLV chỉ thấy của mình; khách 403", async () => {
  await makeSlot({ trainerId: otherTrainerId });
  const r = await call(`/schedule/pt-slots?to=${hoursFromNow(24 * 30).toISOString()}`, { token: tokens.trainer });
  assert.equal(r.status, 200);
  assert.ok(r.data.slots.length > 0, "HLV phải thấy khung của mình");
  for (const s of r.data.slots) {
    assert.equal(s.trainerId.toString(), linhTrainerId.toString(), "không được lộ khung HLV khác");
  }
  assert.equal((await call("/schedule/pt-slots", { token: tokens.customer })).status, 403);
});

// ---------- 15. Điểm danh PT nhóm ----------

test("attendance-group: HLV điểm danh từng khách trong khung nhóm của mình, độc lập nhau", async () => {
  // Khung 21' nữa (trong cửa điểm danh) — chèn DB trực tiếp, giờ lệch để không đè khung của test re-book
  const start = new Date(Date.now() + 21 * 60 * 1000);
  const slotDoc = await PTSlot.create({
    trainerId: linhTrainerId, startAt: start, endAt: new Date(start.getTime() + 2 * 60 * 1000), capacity: 2,
  });
  const slotId = slotDoc._id;
  const [c1, c2] = await Promise.all([makeCustomerWithPT(), makeCustomerWithPT()]);
  assert.equal((await book(slotId, c1.token)).status, 201);
  assert.equal((await book(slotId, c2.token)).status, 201);

  const bk1 = await Booking.findOne({ userId: c1.user._id, slotId });
  const bk2 = await Booking.findOne({ userId: c2.user._id, slotId });
  assert.equal((await call(`/management/bookings/${bk1._id}/attendance`, { method: "PATCH", token: tokens.trainer, body: { present: true } })).status, 200);
  assert.equal((await call(`/management/bookings/${bk2._id}/attendance`, { method: "PATCH", token: tokens.trainer, body: { present: false } })).status, 200);
  assert.equal((await Booking.findById(bk1._id)).status, "completed");
  assert.equal((await Booking.findById(bk2._id)).status, "no_show");
});

// ---------- Vòng review độc lập her-11: regression cho các fix ----------

test("review-fix (V2): quầy nới capacity 1->3 — title booking cũ đổi thành 'PT nhóm — …'", async () => {
  const { r } = await makeSlot({ capacity: 1 });
  const slotId = r.data.slot._id || r.data.slot.id;
  const { user, token } = await makeCustomerWithPT();
  assert.equal((await book(slotId, token)).status, 201);
  assert.match((await Booking.findOne({ userId: user._id, slotId })).title, /^1:1 PT — /);

  const up = await call(`/schedule/pt-slots/${slotId}`, { method: "PATCH", token: tokens.staff, body: { capacity: 3 } });
  assert.equal(up.status, 200, JSON.stringify(up.data));
  const bk = await Booking.findOne({ userId: user._id, slotId });
  assert.match(bk.title, /^PT nhóm — /, "đổi dạng khung phải đồng bộ title booking cũ");

  // Thu về 1 (bookedCount=1, hợp lệ) -> title về lại 1:1
  const down = await call(`/schedule/pt-slots/${slotId}`, { method: "PATCH", token: tokens.staff, body: { capacity: 1 } });
  assert.equal(down.status, 200);
  assert.match((await Booking.findOne({ userId: user._id, slotId })).title, /^1:1 PT — /);
});

test("review-fix (N5-race): 2 request mở hồ sơ HLV song song — đúng 1 hồ sơ Trainer còn lại", async () => {
  // Admin mới toanh (admin seed đã có hồ sơ từ test admin-trainer)
  const passwordHash = await bcrypt.hash("123456", 10);
  await User.create({ name: "Admin 2", phone: "0972000001", passwordHash, role: "admin" });
  const { token } = await login("0972000001");
  const before = await Trainer.countDocuments();
  const [a, b] = await Promise.all([
    call("/me/trainer-profile", { method: "POST", token, body: { name: "Admin 2 HLV", specialties: ["gym"] } }),
    call("/me/trainer-profile", { method: "POST", token, body: { name: "Admin 2 HLV", specialties: ["gym"] } }),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [201, 400]);
  assert.equal(await Trainer.countDocuments(), before + 1, "request thua phải tự dọn hồ sơ thừa");
});

test("review-fix: hủy rồi ĐẶT LẠI cùng slot PT được (unique index chỉ chặn booking đang booked)", async () => {
  const { r } = await makeSlot({ capacity: 1 });
  const slotId = r.data.slot._id || r.data.slot.id;
  const { user, token } = await makeCustomerWithPT();
  assert.equal((await book(slotId, token)).status, 201);
  const bk = await Booking.findOne({ userId: user._id, slotId, status: "booked" });
  assert.equal((await call(`/bookings/${bk._id}`, { method: "DELETE", token })).status, 200);
  assert.equal((await book(slotId, token)).status, 201, "hủy xong phải đặt lại được");
  assert.equal((await PTSlot.findById(slotId)).bookedCount, 1);
  assert.equal((await Package.findOne({ userId: user._id })).usedSessions, 1);
});

test("review-fix: hủy 2 lần SONG SONG 1 booking PT nhóm — chỗ chỉ trả 1, buổi chỉ hoàn 1", async () => {
  const { r } = await makeSlot({ capacity: 3 });
  const slotId = r.data.slot._id || r.data.slot.id;
  const { user, token } = await makeCustomerWithPT();
  assert.equal((await book(slotId, token)).status, 201);
  const bk = await Booking.findOne({ userId: user._id, slotId });

  const results = await Promise.all([
    call(`/bookings/${bk._id}`, { method: "DELETE", token }),
    call(`/bookings/${bk._id}`, { method: "DELETE", token: tokens.staff }),
  ]);
  assert.deepEqual(results.map((x) => x.status).sort(), [200, 400], "chỉ 1 lần hủy có hiệu lực");
  assert.equal((await PTSlot.findById(slotId)).bookedCount, 0, "chỗ không được trả 2 lần (âm)");
  assert.equal((await Package.findOne({ userId: user._id })).usedSessions, 0, "buổi chỉ hoàn đúng 1 lần");
});

test("review-fix: đổi HLV khung PT sang HLV đang bận giờ đó -> 400 trùng giờ", async () => {
  // 2 khung CÙNG GIỜ của 2 HLV khác nhau -> đổi khung 1 sang HLV của khung 2 phải bị chặn
  const hoursAhead = 800;
  const s1 = await makeSlot({ trainerId: linhTrainerId, hoursAhead });
  const s2 = await makeSlot({ trainerId: otherTrainerId, hoursAhead });
  assert.equal(s1.r.status, 201);
  assert.equal(s2.r.status, 201);
  const sw = await call(`/schedule/pt-slots/${s1.r.data.slot._id || s1.r.data.slot.id}`, {
    method: "PATCH", token: tokens.staff, body: { trainerId: otherTrainerId.toString() },
  });
  assert.equal(sw.status, 400);
  assert.match(sw.data.error, /trùng giờ/i);
});

test("review-fix (ma trận bổ sung): khách PATCH/DELETE pt-slot -> 403; HLV PATCH khung người khác kèm trainerId mình -> 403; xoá 2 lần -> 404", async () => {
  const { r } = await makeSlot({ trainerId: otherTrainerId });
  const slotId = r.data.slot._id || r.data.slot.id;
  assert.equal((await call(`/schedule/pt-slots/${slotId}`, { method: "PATCH", token: tokens.customer, body: { capacity: 2 } })).status, 403);
  assert.equal((await call(`/schedule/pt-slots/${slotId}`, { method: "DELETE", token: tokens.customer })).status, 403);
  // HLV Linh cố "chiếm" khung của HLV khác bằng cách gửi trainerId của mình -> vẫn 403
  assert.equal((await call(`/schedule/pt-slots/${slotId}`, { method: "PATCH", token: tokens.trainer, body: { trainerId: linhTrainerId.toString() } })).status, 403);
  // Xoá thật rồi xoá lại -> 404 đúng lý do (review N2), không phải "đã có khách"
  assert.equal((await call(`/schedule/pt-slots/${slotId}`, { method: "DELETE", token: tokens.staff })).status, 200);
  assert.equal((await call(`/schedule/pt-slots/${slotId}`, { method: "DELETE", token: tokens.staff })).status, 404);
});

test("review-fix: sau khi quầy đổi HLV, HLV cũ hết quyền điểm danh booking đó; HLV mới có quyền", async () => {
  // Khung của HLV KHÁC trong cửa điểm danh (chèn DB), khách đặt (chèn DB cho chủ động thời gian)
  const start = new Date(Date.now() + 18 * 60 * 1000);
  // Dọn lịch seed của Linh quanh khung này để bước "đổi HLV sang Linh" không vướng trùng giờ
  const windowEnd = new Date(start.getTime() + 40 * 60 * 1000);
  await PTSlot.deleteMany({ trainerId: linhTrainerId, startAt: { $lt: windowEnd }, endAt: { $gt: start } });
  await GymClass.deleteMany({ coachId: linhTrainerId, startAt: { $lt: windowEnd }, endAt: { $gt: start } });
  const slot = await PTSlot.create({
    trainerId: otherTrainerId, startAt: start, endAt: new Date(start.getTime() + 40 * 60 * 1000), capacity: 1, bookedCount: 1,
  });
  const { user } = await makeCustomerWithPT();
  const bk = await Booking.create({
    userId: user._id, type: "pt", slotId: slot._id, trainerId: otherTrainerId,
    title: "1:1 PT — X", startAt: slot.startAt, endAt: slot.endAt,
  });
  // HLV Linh (không phải chủ buổi) -> 403
  assert.equal((await call(`/management/bookings/${bk._id}/attendance`, { method: "PATCH", token: tokens.trainer, body: { present: true } })).status, 403);
  // Quầy đổi HLV của khung sang Linh -> booking sync -> Linh điểm danh được
  const sw = await call(`/schedule/pt-slots/${slot._id}`, { method: "PATCH", token: tokens.staff, body: { trainerId: linhTrainerId.toString() } });
  assert.equal(sw.status, 200, JSON.stringify(sw.data));
  assert.equal((await call(`/management/bookings/${bk._id}/attendance`, { method: "PATCH", token: tokens.trainer, body: { present: true } })).status, 200);
});

test("review-fix (biên): capacity 10 hợp lệ; capacity gửi dạng chuỗi '3' vẫn nhận", async () => {
  const r10 = await makeSlot({ capacity: 10 });
  assert.equal(r10.r.status, 201);
  assert.equal(r10.r.data.slot.capacity, 10);
  const rs = await makeSlot({ capacity: "3" });
  assert.equal(rs.r.status, 201, JSON.stringify(rs.r.data));
  assert.equal(rs.r.data.slot.capacity, 3);
});
