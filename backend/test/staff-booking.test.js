// Test her-39 — quầy (lễ tân/admin) ĐẶT LỊCH HỘ học viên + TẠO BUỔI TRONG QUÁ KHỨ.
// Xem docs-her/testcase/testcase_her-39_staff_booking.md
// DB riêng her_test_q (tự seed), server cổng 4251.

const { test, before, after } = require("node:test");
const assert = require("node:assert");
const { spawn, spawnSync } = require("node:child_process");
const path = require("node:path");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const ROOT = path.join(__dirname, "..");
const URI = "mongodb://localhost:27017/her_test_q";
const S = "http://localhost:4251/api";

const Booking = require("../src/models/Booking");
const GymClass = require("../src/models/GymClass");
const Package = require("../src/models/Package");
const User = require("../src/models/User");

let proc;
const tokens = {};
let linhTrainerId;
// HLV RIÊNG của suite này — seed có sẵn 50 buổi lịch sử của HLV seed, dùng chung sẽ đụng
// luật "1 HLV không dạy 2 nơi cùng lúc" một cách ngẫu nhiên
let coachId;
let coach2Id;

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

// Khách mới kèm gói khớp bộ môn + loại hình. pkg = null -> khách KHÔNG có gói nào.
let custSeq = 0;
async function makeCustomer({ format = "1:4", sessions = 10, withPackage = true, expiresInHours = 24 * 30 } = {}) {
  const phone = `0968${String(custSeq++).padStart(6, "0")}`;
  const passwordHash = await bcrypt.hash("123456", 10);
  const user = await User.create({ name: `Khach her39 ${custSeq}`, phone, passwordHash, role: "customer" });
  let pkg = null;
  if (withPackage) {
    pkg = await Package.create({
      userId: user._id,
      name: `Pilates ${format} her39`,
      serviceTypes: ["pilates"],
      format,
      price: 1000000,
      totalSessions: sessions,
      activatedAt: new Date(),
      expiresAt: hoursFromNow(expiresInHours),
    });
  }
  const { token } = await login(phone);
  return { user, pkg, token, phone };
}

// Buổi mới, giờ TƯƠNG LAI — phải nằm TRONG hạn gói mặc định (30 ngày = 720h) thì mới trừ
// được buổi, nên mỗi buổi cách nhau 2h và bắt đầu từ +2h
let classHour = 0;
async function makeClass({ format = "1:4", hours, coach } = {}) {
  const start = hours != null ? hoursFromNow(hours) : hoursFromNow((classHour += 2));
  const end = new Date(start.getTime() + 3600 * 1000);
  const r = await call("/schedule/classes", {
    method: "POST", token: tokens.staff,
    body: { serviceType: "pilates", format, coachId: String(coach || coachId), startAt: start, endAt: end },
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return { id: r.data.class._id, startAt: start, endAt: end };
}

// Buổi trong QUÁ KHỨ do quầy tạo (her-39). hoursAgo tính lùi từ bây giờ.
let pastHour = 0;
async function makePastClass({ format = "1:4", hoursAgo, token = tokens.staff, coach } = {}) {
  const ago = hoursAgo != null ? hoursAgo : (pastHour += 2);
  const start = hoursFromNow(-ago);
  const end = new Date(start.getTime() + 3600 * 1000);
  return {
    res: await call("/schedule/classes", {
      method: "POST", token,
      body: { serviceType: "pilates", format, coachId: String(coach || coachId), startAt: start, endAt: end },
    }),
    startAt: start,
    endAt: end,
  };
}

const book = (classId, token, body = {}) =>
  call("/bookings", { method: "POST", token, body: { classId: String(classId), ...body } });

const usedOf = async (pkgId) => (await Package.findById(pkgId)).usedSessions;

before(async () => {
  const seeded = spawnSync(process.execPath, ["src/scripts/seed.js"], {
    cwd: ROOT,
    env: { ...process.env, MONGODB_URI: URI },
    stdio: "ignore",
  });
  assert.equal(seeded.status, 0, "seed her_test_q thất bại");
  proc = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: "4251", MONGODB_URI: URI, JWT_SECRET: "testsecret", MIN_CANCEL_HOURS: "3" },
    stdio: "ignore",
  });
  await waitHealthy(S);
  await mongoose.connect(URI);

  tokens.admin = (await login("0999999999")).token;
  tokens.staff = (await login("0900000000")).token; // lễ tân
  tokens.trainer = (await login("0911111111")).token; // HLV Linh
  linhTrainerId = (await User.findOne({ phone: "0911111111" })).trainerId;

  // 2 HLV riêng cho suite — lịch sạch, không đụng 50 buổi lịch sử của seed
  for (const [name, phone, key] of [
    ["HLV her39 A", "0968900001", "coachId"],
    ["HLV her39 B", "0968900002", "coach2Id"],
  ]) {
    const r = await call("/accounts", {
      method: "POST", token: tokens.admin,
      body: { role: "trainer", name, phone, password: "123456", specialties: ["pilates"] },
    });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    const id = (await User.findOne({ phone })).trainerId;
    if (key === "coachId") coachId = id;
    else coach2Id = id;
  }
});

after(async () => {
  proc?.kill();
  await mongoose.disconnect();
});

// ---------- 1. Đặt hộ cơ bản: trừ đúng gói CỦA KHÁCH (case 1, 22) ----------

test("staff-book-basic: lễ tân đặt hộ -> booking của KHÁCH, trừ đúng 1 buổi gói KHÁCH; khách tự đặt vẫn chạy", async () => {
  const cls = await makeClass({ format: "1:4" });
  const a = await makeCustomer({ format: "1:4" });

  const r = await book(cls.id, tokens.staff, { userId: String(a.user._id) });
  assert.equal(r.status, 201, JSON.stringify(r.data));

  const bookingId = r.data.booking.id;
  const bk = await Booking.findById(bookingId);
  assert.equal(String(bk.userId), String(a.user._id), "booking phải thuộc về KHÁCH, không phải lễ tân");
  assert.equal(String(bk.packageId), String(a.pkg._id), "trừ đúng gói của khách");
  assert.equal(await usedOf(a.pkg._id), 1, "gói khách bị trừ đúng 1 buổi");
  assert.equal((await GymClass.findById(cls.id)).bookedCount, 1);

  // Không hồi quy: đường cũ (khách tự đặt, không gửi userId) vẫn nguyên
  const cls2 = await makeClass({ format: "1:4" });
  const rSelf = await book(cls2.id, a.token);
  assert.equal(rSelf.status, 201, JSON.stringify(rSelf.data));
  assert.equal(await usedOf(a.pkg._id), 2);
});

// ---------- 2. Ma trận role (case 2, 3, 4, 5) ----------

test("staff-book-role-matrix: admin đặt hộ 201; khách/HLV gửi userId người khác -> 403 không trừ gì; khách gửi userId CHÍNH MÌNH -> 201", async () => {
  const a = await makeCustomer({ format: "1:2" });
  const b = await makeCustomer({ format: "1:2" });

  // admin đặt hộ
  const clsAdmin = await makeClass({ format: "1:2" });
  const rAdmin = await book(clsAdmin.id, tokens.admin, { userId: String(a.user._id) });
  assert.equal(rAdmin.status, 201, JSON.stringify(rAdmin.data));
  assert.equal(await usedOf(a.pkg._id), 1);

  // khách B đặt hộ khách A -> 403, KHÔNG trừ gói của ai, không giữ chỗ
  const cls = await makeClass({ format: "1:2" });
  const rCust = await book(cls.id, b.token, { userId: String(a.user._id) });
  assert.equal(rCust.status, 403, JSON.stringify(rCust.data));
  assert.match(rCust.data.error, /đặt hộ/i);
  assert.equal(await usedOf(a.pkg._id), 1, "gói A không được đụng");
  assert.equal(await usedOf(b.pkg._id), 0, "gói B không được đụng");
  assert.equal((await GymClass.findById(cls.id)).bookedCount, 0, "không được giữ chỗ");
  assert.equal(await Booking.countDocuments({ classId: cls.id }), 0);

  // HLV đặt hộ -> 403
  const rTrainer = await book(cls.id, tokens.trainer, { userId: String(a.user._id) });
  assert.equal(rTrainer.status, 403, JSON.stringify(rTrainer.data));
  assert.ok(rTrainer.data.error);
  assert.equal(await Booking.countDocuments({ classId: cls.id }), 0);

  // 403 phải bắn TRƯỚC khi đụng dữ liệu (C8): classId rác cũng vẫn 403, không phải 404
  const rEarly = await call("/bookings", {
    method: "POST", token: b.token, body: { classId: "khong-phai-id", userId: String(a.user._id) },
  });
  assert.equal(rEarly.status, 403, JSON.stringify(rEarly.data));

  // Khách gửi userId = CHÍNH MÌNH -> hoạt động như tự đặt (quyết định 20/08)
  const rSelf = await book(cls.id, b.token, { userId: String(b.user._id) });
  assert.equal(rSelf.status, 201, JSON.stringify(rSelf.data));
  assert.equal(await usedOf(b.pkg._id), 1);
});

// ---------- 3. Khách không có gói khớp (case 6) ----------

test("staff-book-no-package: đặt hộ khách chưa có gói -> 400 message NÓI RÕ bộ môn/loại hình, ĐÚNG NGÔI (quầy đọc), không giữ chỗ", async () => {
  const cls = await makeClass({ format: "1:4" });
  const noPkg = await makeCustomer({ withPackage: false });

  const r = await book(cls.id, tokens.staff, { userId: String(noPkg.user._id) });
  assert.equal(r.status, 400, JSON.stringify(r.data));
  assert.match(r.data.error, /chưa có gói Pilates/, "message phải nói rõ thiếu gói bộ môn nào (C6)");
  // her-39: người đọc là QUẦY -> không được xưng "bạn" với chủ gói
  assert.match(r.data.error, /học viên này/, `đặt hộ phải đổi ngôi: ${r.data.error}`);
  assert.equal(/\bbạn\b/.test(r.data.error), false, `không được xưng "bạn" khi đặt hộ: ${r.data.error}`);
  assert.equal((await GymClass.findById(cls.id)).bookedCount, 0);
  assert.equal(await Booking.countDocuments({ classId: cls.id }), 0);

  // Có gói nhưng SAI loại hình -> message nêu loại hình, vẫn đúng ngôi
  const wrongFormat = await makeCustomer({ format: "1:1" });
  const r2 = await book(cls.id, tokens.staff, { userId: String(wrongFormat.user._id) });
  assert.equal(r2.status, 400, JSON.stringify(r2.data));
  assert.match(r2.data.error, /1:4/, "message phải nêu loại hình của buổi");
  assert.match(r2.data.error, /học viên này/, `đặt hộ phải đổi ngôi: ${r2.data.error}`);
  assert.equal(await usedOf(wrongFormat.pkg._id), 0, "gói sai loại hình không được trừ");

  // Gói đang BẢO LƯU: quầy đọc thì không có vế "liên hệ quầy lễ tân" (họ ĐANG là quầy)
  const paused = await makeCustomer({ format: "1:4" });
  await Package.updateOne({ _id: paused.pkg._id }, { $set: { pausedAt: new Date() } });
  const r3 = await book(cls.id, tokens.staff, { userId: String(paused.user._id) });
  assert.equal(r3.status, 400, JSON.stringify(r3.data));
  assert.match(r3.data.error, /bảo lưu/, "phải nói rõ gói đang bảo lưu (C6)");
  assert.match(r3.data.error, /của học viên/, `đặt hộ phải đổi ngôi: ${r3.data.error}`);
  assert.equal(/liên hệ quầy/i.test(r3.data.error), false, `quầy không tự bảo mình liên hệ quầy: ${r3.data.error}`);
  assert.equal(await usedOf(paused.pkg._id), 0, "gói bảo lưu không được trừ (Q11)");

  // Khách TỰ đặt thì giữ nguyên ngôi "bạn" như cũ (không hồi quy)
  const self = await makeCustomer({ withPackage: false });
  const r4 = await book(cls.id, self.token);
  assert.equal(r4.status, 400, JSON.stringify(r4.data));
  assert.match(r4.data.error, /bạn chưa có gói/, `khách tự đặt vẫn xưng "bạn": ${r4.data.error}`);
});

// ---------- 4. Target xấu: bị khoá / rác / không phải học viên / thiếu classId (case 7,8,9,20) ----------

test("staff-book-bad-target: khách bị khoá 400; userId rác/không tồn tại 404; target không phải học viên 400; thiếu classId 400", async () => {
  const cls = await makeClass({ format: "1:4" });

  // Khách bị khoá
  const locked = await makeCustomer({ format: "1:4" });
  await User.updateOne({ _id: locked.user._id }, { $set: { isActive: false } });
  const rLocked = await book(cls.id, tokens.staff, { userId: String(locked.user._id) });
  assert.equal(rLocked.status, 400, JSON.stringify(rLocked.data));
  assert.match(rLocked.data.error, /kho[áa]/i, "message phải nói tài khoản đang bị khoá");
  assert.equal(await usedOf(locked.pkg._id), 0, "khách khoá không được trừ buổi");
  assert.equal((await GymClass.findById(cls.id)).bookedCount, 0);

  // userId rác + userId không tồn tại
  const rTrash = await book(cls.id, tokens.staff, { userId: "khong-phai-id" });
  assert.equal(rTrash.status, 404, JSON.stringify(rTrash.data));
  assert.ok(rTrash.data.error);
  const rMissing = await book(cls.id, tokens.staff, { userId: String(new mongoose.Types.ObjectId()) });
  assert.equal(rMissing.status, 404, JSON.stringify(rMissing.data));
  assert.ok(rMissing.data.error);

  // Target là HLV / lễ tân -> 400
  const trainerUser = await User.findOne({ phone: "0911111111" });
  const rTrainer = await book(cls.id, tokens.staff, { userId: String(trainerUser._id) });
  assert.equal(rTrainer.status, 400, JSON.stringify(rTrainer.data));
  assert.match(rTrainer.data.error, /học viên/i);
  const receptionUser = await User.findOne({ phone: "0900000000" });
  const rRecept = await book(cls.id, tokens.admin, { userId: String(receptionUser._id) });
  assert.equal(rRecept.status, 400, JSON.stringify(rRecept.data));

  // Thiếu classId
  const a = await makeCustomer({ format: "1:4" });
  const rNoClass = await call("/bookings", {
    method: "POST", token: tokens.staff, body: { userId: String(a.user._id) },
  });
  assert.equal(rNoClass.status, 400, JSON.stringify(rNoClass.data));
  assert.match(rNoClass.data.error, /classId/i);
  assert.equal(await usedOf(a.pkg._id), 0);
});

// ---------- 5. Chặn trùng lớp (case 10) ----------

test("staff-book-duplicate: đặt hộ 2 lần cùng lớp -> lần 2 báo 400, gói chỉ trừ 1, chỗ chỉ giữ 1", async () => {
  const cls = await makeClass({ format: "1:4" });
  const a = await makeCustomer({ format: "1:4" });

  assert.equal((await book(cls.id, tokens.staff, { userId: String(a.user._id) })).status, 201);
  const r2 = await book(cls.id, tokens.staff, { userId: String(a.user._id) });
  assert.equal(r2.status, 400, JSON.stringify(r2.data));
  assert.match(r2.data.error, /đã đặt lịch này rồi/);
  assert.equal(await usedOf(a.pkg._id), 1, "không được trừ buổi lần 2 (C2)");
  assert.equal((await GymClass.findById(cls.id)).bookedCount, 1);

  // Bấm ĐÚP (2 request song song) cũng chỉ 1 booking
  const cls2 = await makeClass({ format: "1:4" });
  const b = await makeCustomer({ format: "1:4" });
  const both = await Promise.all([
    book(cls2.id, tokens.staff, { userId: String(b.user._id) }),
    book(cls2.id, tokens.staff, { userId: String(b.user._id) }),
  ]);
  assert.equal(both.filter((x) => x.status === 201).length, 1, `phải đúng 1 lần thành công: ${JSON.stringify(both.map((x) => x.status))}`);
  assert.equal(await Booking.countDocuments({ classId: cls2.id, status: { $ne: "cancelled" } }), 1);
  assert.equal(await usedOf(b.pkg._id), 1, "bấm đúp chỉ trừ 1 buổi (C2)");
  assert.equal((await GymClass.findById(cls2.id)).bookedCount, 1);
});

// ---------- 6. Chặn trùng GIỜ với buổi khác của khách (case 11) ----------

test("staff-book-overlap: đặt hộ vào buổi CHỒNG GIỜ với lịch khác của khách -> 400, không trừ thêm buổi", async () => {
  const a = await makeCustomer({ format: "1:4" });
  const cls = await makeClass({ format: "1:4" });
  const rFirst = await book(cls.id, tokens.staff, { userId: String(a.user._id) });
  assert.equal(rFirst.status, 201, JSON.stringify(rFirst.data));
  assert.equal(await usedOf(a.pkg._id), 1);

  // Buổi khác (HLV KHÁC để không vướng luật trùng giờ HLV) chồng 30' lên buổi trên
  const overlapStart = new Date(cls.startAt.getTime() + 30 * 60 * 1000);
  const cls2 = await call("/schedule/classes", {
    method: "POST", token: tokens.staff,
    body: {
      serviceType: "pilates", format: "1:4", coachId: String(coach2Id),
      startAt: overlapStart, endAt: new Date(overlapStart.getTime() + 3600 * 1000),
    },
  });
  assert.equal(cls2.status, 201, JSON.stringify(cls2.data));

  const r = await book(cls2.data.class._id, tokens.staff, { userId: String(a.user._id) });
  assert.equal(r.status, 400, JSON.stringify(r.data));
  assert.match(r.data.error, /trùng giờ/);
  assert.equal(await usedOf(a.pkg._id), 1, "buổi trùng giờ không được trừ thêm (C2)");
});

// ---------- 7. Lớp 1:1 đã đầy -> 400 + HOÀN buổi (case 12) ----------

test("staff-book-full: đặt hộ vào lớp 1:1 đã có khách -> 400, buổi đã trừ được HOÀN, bookedCount không tăng", async () => {
  const cls = await makeClass({ format: "1:1" });
  const a = await makeCustomer({ format: "1:1" });
  const b = await makeCustomer({ format: "1:1" });

  assert.equal((await book(cls.id, tokens.staff, { userId: String(a.user._id) })).status, 201);
  const r = await book(cls.id, tokens.staff, { userId: String(b.user._id) });
  assert.equal(r.status, 400, JSON.stringify(r.data));
  assert.equal(await usedOf(b.pkg._id), 0, "hết chỗ thì phải HOÀN buổi đã trừ (C2)");
  assert.equal(await usedOf(a.pkg._id), 1);
  assert.equal((await GymClass.findById(cls.id)).bookedCount, 1, "H4: không vượt sức chứa");
});

// ---------- 8. Tạo buổi QUÁ KHỨ: quầy được, HLV/khách không (case 13, 14, 15) ----------

test("past-class-create: lễ tân/admin tạo buổi quá khứ 201; HLV tự tạo 400 'quá khứ'; khách 403", async () => {
  const staffPast = await makePastClass({ format: "1:4" });
  assert.equal(staffPast.res.status, 201, JSON.stringify(staffPast.res.data));
  const created = await GymClass.findById(staffPast.res.data.class._id);
  assert.ok(created.startAt < new Date(), "lớp phải lưu đúng giờ quá khứ");

  const adminPast = await makePastClass({ format: "1:4", token: tokens.admin });
  assert.equal(adminPast.res.status, 201, JSON.stringify(adminPast.res.data));

  // HLV tự mở buổi 1:1 CỦA MÌNH trong quá khứ -> vẫn chặn
  const start = hoursFromNow(-5);
  const rTrainer = await call("/schedule/classes", {
    method: "POST", token: tokens.trainer,
    body: {
      serviceType: "pilates", format: "1:1", coachId: String(linhTrainerId),
      startAt: start, endAt: new Date(start.getTime() + 3600 * 1000),
    },
  });
  assert.equal(rTrainer.status, 400, JSON.stringify(rTrainer.data));
  assert.match(rTrainer.data.error, /quá khứ/);

  // Khách -> 403 (không có quyền xếp lịch)
  const kh = await makeCustomer({ format: "1:4" });
  const rCust = await call("/schedule/classes", {
    method: "POST", token: kh.token,
    body: {
      serviceType: "pilates", format: "1:4", coachId: String(linhTrainerId),
      startAt: start, endAt: new Date(start.getTime() + 3600 * 1000),
    },
  });
  assert.equal(rCust.status, 403, JSON.stringify(rCust.data));
  assert.ok(rCust.data.error);
});

// ---------- 9. Buổi quá khứ vẫn theo luật "1 HLV không dạy 2 nơi" (case 16) ----------

test("past-class-overlap: 2 buổi quá khứ chồng giờ cùng HLV -> buổi thứ 2 bị 400 trùng giờ", async () => {
  const first = await makePastClass({ format: "1:4", hoursAgo: 100 });
  assert.equal(first.res.status, 201, JSON.stringify(first.res.data));
  const dup = await call("/schedule/classes", {
    method: "POST", token: tokens.staff,
    body: {
      serviceType: "pilates", format: "1:4", coachId: String(coachId),
      startAt: new Date(first.startAt.getTime() + 30 * 60 * 1000),
      endAt: new Date(first.startAt.getTime() + 90 * 60 * 1000),
    },
  });
  assert.equal(dup.status, 400, JSON.stringify(dup.data));
  assert.match(dup.data.error, /trùng giờ/);
});

// ---------- 10. PATCH lớp đã kết thúc vẫn bị chặn (case 21) ----------

test("past-class-patch-still-blocked: quầy PATCH lớp quá khứ -> 400 'Lớp đã kết thúc'", async () => {
  const p = await makePastClass({ format: "1:4" });
  assert.equal(p.res.status, 201);
  const r = await call(`/schedule/classes/${p.res.data.class._id}`, {
    method: "PATCH", token: tokens.staff, body: { name: "Doi ten" },
  });
  assert.equal(r.status, 400, JSON.stringify(r.data));
  assert.match(r.data.error, /đã kết thúc/);
});

// ---------- 11. FLOW ĐỦ YÊU CẦU 2 (case 17, 18) ----------

test("past-class-flow: tạo buổi HÔM QUA -> đặt hộ (gói mua HÔM NAY) -> điểm danh Đến; khách TỰ đặt lớp quá khứ vẫn 400", async () => {
  // Buổi hôm qua
  const p = await makePastClass({ format: "1:4", hoursAgo: 24 });
  assert.equal(p.res.status, 201, JSON.stringify(p.res.data));
  const classId = p.res.data.class._id;

  // Khách có gói KÍCH HOẠT HÔM NAY (mua sau ngày tập) — hạn còn phủ ngày buổi tập
  const a = await makeCustomer({ format: "1:4" });
  assert.ok(a.pkg.activatedAt > p.startAt, "gói phải được mua SAU ngày buổi tập");

  const rBook = await book(classId, tokens.staff, { userId: String(a.user._id) });
  assert.equal(rBook.status, 201, JSON.stringify(rBook.data));
  assert.equal(await usedOf(a.pkg._id), 1, "gói mua sau ngày buổi vẫn trừ được cho buổi quá khứ");
  const bookingId = rBook.data.booking.id;

  // Roster của quầy thấy khách vừa add
  const roster = await call(`/management/classes/${classId}/roster`, { token: tokens.staff });
  assert.equal(roster.status, 200, JSON.stringify(roster.data));
  assert.equal(roster.data.customers.length, 1);
  assert.equal(roster.data.customers[0].name, a.user.name);

  // Quầy điểm danh Đến (buổi quá khứ — quầy không giới hạn thời gian)
  const rAtt = await call(`/management/bookings/${bookingId}/attendance`, {
    method: "PATCH", token: tokens.staff, body: { present: true },
  });
  assert.equal(rAtt.status, 200, JSON.stringify(rAtt.data));
  const bk = await Booking.findById(bookingId);
  assert.equal(bk.status, "completed");
  assert.ok(bk.attendanceAt, "phải ghi thời điểm điểm danh");
  assert.equal(await usedOf(a.pkg._id), 1, "điểm danh không trừ thêm buổi");

  // Khách TỰ đặt lớp quá khứ -> vẫn chặn như cũ
  const p2 = await makePastClass({ format: "1:4", hoursAgo: 26 });
  assert.equal(p2.res.status, 201);
  const b = await makeCustomer({ format: "1:4" });
  const rSelf = await book(p2.res.data.class._id, b.token);
  assert.equal(rSelf.status, 400, JSON.stringify(rSelf.data));
  assert.match(rSelf.data.error, /đã qua giờ/);
  assert.equal(await usedOf(b.pkg._id), 0, "buổi quá khứ khách tự đặt không được trừ gói");
});

// ---------- 12b. her-39 bổ sung: /eligible-customers — chỉ khách CÓ GÓI DÙNG ĐƯỢC ----------

test("eligible-matrix: lễ tân/admin 200; HLV 403; khách 403; lớp không tồn tại 404", async () => {
  const cls = await makeClass({ format: "1:4" });
  const path = `/management/classes/${cls.id}/eligible-customers`;
  for (const t of [tokens.staff, tokens.admin]) {
    const r = await call(path, { token: t });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.ok(Array.isArray(r.data.customers));
  }
  const rT = await call(path, { token: tokens.trainer });
  assert.equal(rT.status, 403, JSON.stringify(rT.data));
  assert.ok(rT.data.error);

  const kh = await makeCustomer({ format: "1:4" });
  const rC = await call(path, { token: kh.token });
  assert.equal(rC.status, 403, JSON.stringify(rC.data));

  const missing = await call(`/management/classes/${new mongoose.Types.ObjectId()}/eligible-customers`, {
    token: tokens.staff,
  });
  assert.equal(missing.status, 404, JSON.stringify(missing.data));
  assert.ok(missing.data.error);
});

test("eligible-filter: chỉ khách có gói DÙNG ĐƯỢC mới hiện — sai loại hình / bảo lưu / hết buổi đều bị loại", async () => {
  const cls = await makeClass({ format: "1:2" });
  const path = `/management/classes/${cls.id}/eligible-customers`;

  const ok = await makeCustomer({ format: "1:2" }); // gói khớp
  const wrongFormat = await makeCustomer({ format: "1:4" }); // sai loại hình
  const paused = await makeCustomer({ format: "1:2" });
  await Package.updateOne({ _id: paused.pkg._id }, { $set: { pausedAt: new Date() } });
  const usedUp = await makeCustomer({ format: "1:2", sessions: 1 });
  await Package.updateOne({ _id: usedUp.pkg._id }, { $set: { usedSessions: 1 } });
  const noPkg = await makeCustomer({ withPackage: false });

  const r = await call(path, { token: tokens.staff });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const ids = r.data.customers.map((u) => String(u.id));
  assert.ok(ids.includes(String(ok.user._id)), "khách có gói khớp PHẢI hiện");
  for (const [who, u] of [["sai loại hình", wrongFormat], ["bảo lưu", paused], ["hết buổi", usedUp], ["không gói", noPkg]]) {
    assert.equal(ids.includes(String(u.user._id)), false, `khách ${who} không được hiện`);
  }
  // Trả đủ tên + SĐT để quầy tìm; sort theo tên
  const row = r.data.customers.find((u) => String(u.id) === String(ok.user._id));
  assert.equal(row.name, ok.user.name);
  assert.equal(row.phone, ok.phone);

  // Khách BỊ KHOÁ cũng bị loại
  const locked = await makeCustomer({ format: "1:2" });
  await User.updateOne({ _id: locked.user._id }, { $set: { isActive: false } });
  const r2 = await call(path, { token: tokens.staff });
  assert.equal(
    r2.data.customers.some((u) => String(u.id) === String(locked.user._id)),
    false,
    "khách bị khoá không được gợi ý"
  );

  // Đặt hộ xong thì khách đó biến khỏi danh sách (không gợi ý người đã có trong buổi)
  assert.equal((await book(cls.id, tokens.staff, { userId: String(ok.user._id) })).status, 201);
  const r3 = await call(path, { token: tokens.staff });
  assert.equal(
    r3.data.customers.some((u) => String(u.id) === String(ok.user._id)),
    false,
    "khách đã có trong buổi không được gợi ý lại"
  );
});

test("eligible-past-class: buổi QUÁ KHỨ nhận gói đã hết hạn HÔM NAY miễn hạn cũ còn phủ ngày tập", async () => {
  const p = await makePastClass({ format: "1:4", hoursAgo: 24 * 5 });
  assert.equal(p.res.status, 201, JSON.stringify(p.res.data));
  const path = `/management/classes/${p.res.data.class._id}/eligible-customers`;

  // Gói HẾT HẠN 2 ngày trước (không dùng được hôm nay) nhưng còn phủ ngày tập (5 ngày trước)
  const oldPkg = await makeCustomer({ format: "1:4", expiresInHours: -48 });
  // Gói hết hạn TRƯỚC cả ngày tập -> không phủ, phải bị loại
  const tooOld = await makeCustomer({ format: "1:4", expiresInHours: -24 * 7 });

  const r = await call(path, { token: tokens.staff });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const ids = r.data.customers.map((u) => String(u.id));
  assert.ok(ids.includes(String(oldPkg.user._id)), "gói hết hạn hôm nay nhưng còn phủ NGÀY TẬP vẫn dùng được");
  assert.equal(ids.includes(String(tooOld.user._id)), false, "gói hết hạn TRƯỚC ngày tập phải bị loại");

  // Và đặt hộ thật cũng phải thành công đúng như danh sách hứa hẹn
  const rBook = await book(p.res.data.class._id, tokens.staff, { userId: String(oldPkg.user._id) });
  assert.equal(rBook.status, 201, JSON.stringify(rBook.data));
  assert.equal(await usedOf(oldPkg.pkg._id), 1);
});

// ---------- 12. Hủy booking đặt hộ -> hoàn ĐÚNG gói (case 19) ----------

test("staff-book-cancel-refund: quầy hủy booking vừa đặt hộ -> hoàn đúng gói khách, trả chỗ, roster sạch", async () => {
  const cls = await makeClass({ format: "1:2" });
  const a = await makeCustomer({ format: "1:2" });
  // Gói thứ 2 cùng loại, hạn XA hơn — để chắc chắn hoàn về đúng gói ĐÃ TRỪ (L3/C2)
  const far = await Package.create({
    userId: a.user._id, name: "Pilates 1:2 hạn xa", serviceTypes: ["pilates"], format: "1:2",
    price: 2000000, totalSessions: 10, activatedAt: new Date(), expiresAt: hoursFromNow(24 * 300),
  });

  const r = await book(cls.id, tokens.staff, { userId: String(a.user._id) });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(await usedOf(a.pkg._id), 1, "trừ gói hạn GẦN trước (Q4)");
  assert.equal(await usedOf(far._id), 0);

  const rCancel = await call(`/bookings/${r.data.booking.id}`, { method: "DELETE", token: tokens.staff });
  assert.equal(rCancel.status, 200, JSON.stringify(rCancel.data));
  assert.equal(await usedOf(a.pkg._id), 0, "hoàn về ĐÚNG gói đã trừ (C2/H1)");
  assert.equal(await usedOf(far._id), 0, "không được hoàn nhầm sang gói khác");
  assert.equal((await GymClass.findById(cls.id)).bookedCount, 0, "chỗ phải được trả lại");

  const roster = await call(`/management/classes/${cls.id}/roster`, { token: tokens.staff });
  assert.equal(roster.data.customers.length, 0);
});
