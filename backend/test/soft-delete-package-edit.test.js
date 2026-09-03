// her-53: xoá MỀM tài khoản + sửa gói tập — xem
// docs-her/testcase/testcase_her-53_soft_delete_account_edit_package.md
// DB riêng her_test_v (tự seed), server cổng 4301.

const { test, before, after } = require("node:test");
const assert = require("node:assert");
const { spawn, spawnSync } = require("node:child_process");
const path = require("node:path");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const ROOT = path.join(__dirname, "..");
const URI = "mongodb://localhost:27017/her_test_v";
const S = "http://localhost:4301/api";

const User = require("../src/models/User");
const Package = require("../src/models/Package");
const Booking = require("../src/models/Booking");
const GymClass = require("../src/models/GymClass");
const { isTrainerLocked } = require("../src/utils/activeTrainers");

let proc;
const tokens = {};
const SERVER_ENV = { ...process.env, PORT: "4301", MONGODB_URI: URI, JWT_SECRET: "testsecret", MIN_CANCEL_HOURS: "3" };
const startServer = () => spawn(process.execPath, ["server.js"], { cwd: ROOT, env: SERVER_ENV, stdio: "ignore" });
let coachId; // HLV seed 0911111111

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
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

async function login(phone, password = "123456") {
  return call("/auth/login", { method: "POST", body: { phone, password } });
}
async function loginOk(phone, password = "123456") {
  const r = await login(phone, password);
  assert.equal(r.status, 200, `login ${phone}: ${JSON.stringify(r.data)}`);
  return r.data;
}

const hoursFromNow = (h) => new Date(Date.now() + h * 3600 * 1000);
const daysFromNow = (d) => new Date(Date.now() + d * 24 * 3600 * 1000);

// Khách mới chèn thẳng DB + 1 gói Pilates 1:1 (10 buổi, hạn 30 ngày)
let custSeq = 0;
async function makeCustomer({ withPackage = true } = {}) {
  const phone = `0968${String(custSeq++).padStart(6, "0")}`;
  const passwordHash = await bcrypt.hash("123456", 10);
  const user = await User.create({ name: `Khach her53 ${custSeq}`, phone, passwordHash, role: "customer" });
  let pkg = null;
  if (withPackage) {
    const soldAt = new Date(); // dòng thu lúc bán mang ĐÚNG thời điểm bán (như route POST /packages)
    pkg = await Package.create({
      userId: user._id, name: "Pilates 1:1 her53", serviceTypes: ["pilates"], format: "1:1",
      price: 1000000, paidAmount: 1000000, totalSessions: 10, activatedAt: soldAt, expiresAt: daysFromNow(30),
      payments: [{ amount: 1000000, at: soldAt, by: null }],
    });
  }
  const { token } = await loginOk(phone);
  return { user, pkg, token, phone, id: user._id.toString() };
}

// Buổi 1:1 chèn thẳng DB, cách `hours` giờ (âm = quá khứ)
let clsSeq = 0;
async function makeClass(hours, coach = coachId) {
  const startAt = hoursFromNow(hours);
  const r = await mongoose.connection.db.collection("gymclasses").insertOne({
    name: `Buoi her53 ${clsSeq++}`, serviceType: "pilates", format: "1:1", coachId: coach,
    startAt, endAt: new Date(startAt.getTime() + 3600 * 1000), capacity: 1, bookedCount: 0,
  });
  return r.insertedId;
}

// her-56: sửa/xoá chỉ ADMIN — mặc định thao tác bằng admin, lễ tân kiểm 403 ở ma trận
const del = (id, token = tokens.admin) => call(`/accounts/${id}`, { method: "DELETE", token });
const patchPkg = (id, body, token = tokens.admin) => call(`/packages/${id}`, { method: "PATCH", token, body });

before(async () => {
  const seeded = spawnSync(process.execPath, ["src/scripts/seed.js"], {
    cwd: ROOT, env: { ...process.env, MONGODB_URI: URI }, stdio: "ignore",
  });
  assert.equal(seeded.status, 0, "seed her_test_v thất bại");

  // Giả lập DB prod: index SĐT còn là bản unique THƯỜNG (trước her-53). autoIndex tắt để chính
  // tiến trình test không tự build index mới — việc đó là của server lúc khởi động (row 4).
  await mongoose.connect(URI, { autoIndex: false });
  const users = mongoose.connection.db.collection("users");
  await users.dropIndexes();
  await users.createIndex({ phone: 1 }, { unique: true });

  proc = startServer();
  await waitHealthy(S);

  tokens.admin = (await loginOk("0999999999")).token;
  tokens.reception = (await loginOk("0900000000")).token;
  tokens.trainer = (await loginOk("0911111111")).token;
  tokens.customer = (await loginOk("0909090909")).token;
  coachId = (await User.findOne({ phone: "0911111111" })).trainerId;
});

after(async () => {
  proc?.kill();
  await mongoose.disconnect();
});

// ---------- 4. Index SĐT được chuyển sang partial khi server khởi động ----------

test("index-migration: server khởi động thay index phone unique thường bằng bản partial { deletedAt: null }", async () => {
  const idx = await mongoose.connection.db.collection("users").indexes();
  const phoneIdx = idx.filter((i) => i.key && i.key.phone === 1);
  assert.equal(phoneIdx.length, 1, JSON.stringify(idx));
  assert.equal(phoneIdx[0].unique, true);
  assert.deepEqual(phoneIdx[0].partialFilterExpression, { deletedAt: null });
  // Trùng SĐT với tài khoản ĐANG dùng vẫn bị chặn
  const r = await call("/accounts", { method: "POST", token: tokens.reception, body: { name: "Trung", phone: "0909090909", password: "123456", role: "customer" } });
  assert.equal(r.status, 409, JSON.stringify(r.data));
});

// ---------- 1 + 10. Ma trận role ----------

test("delete-role-matrix: HLV/khách/LỄ TÂN không xoá được (her-56: chỉ admin); admin không tự xoá mình; admin xoá được lễ tân", async () => {
  const cust = await makeCustomer({ withPackage: false });
  for (const role of ["trainer", "customer", "reception"]) {
    const r = await del(cust.id, tokens[role]);
    assert.equal(r.status, 403, `${role} phải 403: ${JSON.stringify(r.data)}`);
    assert.ok(r.data.error);
  }
  const noTok = await call(`/accounts/${cust.id}`, { method: "DELETE" });
  assert.equal(noTok.status, 401);

  const trainerUser = await User.findOne({ phone: "0911111111" });
  const rTrainer = await del(trainerUser._id, tokens.reception);
  assert.equal(rTrainer.status, 403, "lễ tân xoá HLV phải 403");

  const receptionUser = await User.findOne({ phone: "0900000000" });
  const rSelf = await del(receptionUser._id, tokens.reception);
  assert.equal(rSelf.status, 403, "lễ tân không xoá được ai (her-56)");
  const adminUser = await User.findOne({ phone: "0999999999" });
  const rAdminSelf = await del(adminUser._id, tokens.admin);
  assert.equal(rAdminSelf.status, 403, "admin tự xoá mình phải 403");

  // Sau loạt tấn công: không ai bị xoá
  for (const id of [cust.id, trainerUser._id, receptionUser._id, adminUser._id]) {
    assert.equal((await User.findById(id)).deletedAt, null);
  }

  // Admin tạo lễ tân mới rồi xoá được (D4)
  const created = await call("/accounts", { method: "POST", token: tokens.admin, body: { name: "Le tan tam", phone: "0968999001", password: "123456", role: "reception" } });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const rDel = await del(created.data.account.id, tokens.admin);
  assert.equal(rDel.status, 200, JSON.stringify(rDel.data));
  const lg = await login("0968999001");
  assert.equal(lg.status, 403);
  assert.match(lg.data.error, /đã bị xoá/);
});

// ---------- 2. Xoá thành công: ẩn, không đăng nhập, token cũ chết, không thao tác được ----------

test("delete-happy: admin xoá học viên -> ẩn khỏi danh sách, login 403 'đã bị xoá', token cũ 401, PATCH/DELETE/packages 404, đặt hộ 400", async () => {
  const cust = await makeCustomer();
  const r = await del(cust.id);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.ok, true);

  const doc = await User.findById(cust.id);
  assert.ok(doc, "bản ghi vẫn còn trong DB (xoá mềm)");
  assert.ok(doc.deletedAt instanceof Date);
  assert.equal(doc.isActive, false);
  assert.ok(await Package.findById(cust.pkg._id), "gói của khách vẫn còn");

  const list = await call("/accounts?role=customer", { token: tokens.reception });
  assert.ok(!list.data.accounts.some((a) => a.id === cust.id), "đã xoá thì không còn trong danh sách");

  const lg = await login(cust.phone);
  assert.equal(lg.status, 403);
  assert.match(lg.data.error, /đã bị xoá/);
  // Sai mật khẩu thì KHÔNG lộ tình trạng tài khoản
  const lgWrong = await login(cust.phone, "saimatkhau");
  assert.equal(lgWrong.status, 401);
  assert.doesNotMatch(lgWrong.data.error, /xoá/);

  const me = await call("/me", { token: cust.token });
  assert.equal(me.status, 401, JSON.stringify(me.data));
  assert.match(me.data.error, /đã bị xoá/);

  const p = await call(`/accounts/${cust.id}`, { method: "PATCH", token: tokens.reception, body: { name: "X" } });
  assert.equal(p.status, 404);
  const again = await del(cust.id);
  assert.equal(again.status, 404);
  const pk = await call(`/packages/customer/${cust.id}`, { token: tokens.reception });
  assert.equal(pk.status, 404);
  assert.match(pk.data.error, /đã bị xoá/);

  const classId = await makeClass(30);
  const bk = await call("/bookings", { method: "POST", token: tokens.reception, body: { classId, userId: cust.id } });
  assert.equal(bk.status, 400, JSON.stringify(bk.data));
  assert.match(bk.data.error, /đã bị xoá/);
});

// ---------- 3. Dùng lại SĐT ----------

test("delete-reuse-phone: sau khi xoá tạo lại được tài khoản cùng SĐT; login trả tài khoản MỚI", async () => {
  const cust = await makeCustomer({ withPackage: false });
  assert.equal((await del(cust.id)).status, 200);
  const created = await call("/accounts", { method: "POST", token: tokens.reception, body: { name: "Khach tao lai", phone: cust.phone, password: "654321", role: "customer" } });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.notEqual(created.data.account.id, cust.id);

  const lg = await loginOk(cust.phone, "654321");
  assert.equal(lg.user.id, created.data.account.id);
  assert.equal(lg.user.name, "Khach tao lai");
  // Mật khẩu của tài khoản cũ không còn mở được gì
  const old = await login(cust.phone, "123456");
  assert.equal(old.status, 401);

  assert.equal(await User.countDocuments({ phone: cust.phone }), 2);
  assert.equal(await User.countDocuments({ phone: cust.phone, deletedAt: null }), 1);
});

// ---------- 5. Chặn xoá khi còn lịch tương lai ----------

test("delete-blocked-future-booking: khách còn buổi sắp tới -> 400 nói rõ số buổi; hủy xong -> xoá được", async () => {
  const cust = await makeCustomer();
  const classId = await makeClass(30);
  const bk = await call("/bookings", { method: "POST", token: cust.token, body: { classId } });
  assert.equal(bk.status, 201, JSON.stringify(bk.data));

  const r1 = await del(cust.id);
  assert.equal(r1.status, 400, JSON.stringify(r1.data));
  assert.match(r1.data.error, /1 buổi sắp tới/);
  assert.equal((await User.findById(cust.id)).deletedAt, null);

  const cancel = await call(`/bookings/${bk.data.booking.id}`, { method: "DELETE", token: tokens.reception });
  assert.equal(cancel.status, 200, JSON.stringify(cancel.data));
  const r2 = await del(cust.id);
  assert.equal(r2.status, 200, JSON.stringify(r2.data));
});

// ---------- 6. Lịch sử giữ nguyên ----------

test("delete-keeps-history: khách chỉ có buổi đã qua -> xoá được; lịch sử vẫn hiện đúng tên", async () => {
  const cust = await makeCustomer();
  const classId = await makeClass(-48);
  const cls = await GymClass.findById(classId);
  await Booking.create({
    userId: cust.user._id, classId, trainerId: coachId, title: cls.name, serviceType: "pilates", format: "1:1",
    startAt: cls.startAt, endAt: cls.endAt, status: "completed", attendanceAt: cls.startAt, packageId: cust.pkg._id,
  });
  const r = await del(cust.id);
  assert.equal(r.status, 200, JSON.stringify(r.data));

  const hist = await call(`/management/bookings?range=past&search=${encodeURIComponent(cust.user.name)}`, { token: tokens.reception });
  assert.equal(hist.status, 200);
  const row = hist.data.bookings.find((b) => b.customer.id === cust.id);
  assert.ok(row, "booking lịch sử vẫn hiện");
  assert.equal(row.customer.name, cust.user.name);
  assert.equal(await Booking.countDocuments({ userId: cust.user._id }), 1);
});

// ---------- 7 + 11. HLV ----------

test("delete-trainer: HLV còn buổi dạy sắp tới -> 400; hết lớp -> 200, biến mất khỏi mọi danh sách HLV", async () => {
  const created = await call("/accounts", {
    method: "POST", token: tokens.admin,
    body: { name: "HLV tam her53", phone: "0968999002", password: "123456", role: "trainer", specialties: ["pilates"] },
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const acc = created.data.account;
  const trainerId = new mongoose.Types.ObjectId(acc.trainerId);
  const classId = await makeClass(48, trainerId);

  const r1 = await del(acc.id, tokens.admin);
  assert.equal(r1.status, 400, JSON.stringify(r1.data));
  assert.match(r1.data.error, /buổi dạy sắp tới/);

  await GymClass.deleteOne({ _id: classId });
  const r2 = await del(acc.id, tokens.admin);
  assert.equal(r2.status, 200, JSON.stringify(r2.data));

  const pub = await call("/trainers", { token: tokens.customer });
  assert.ok(!pub.data.trainers.some((t) => t.id === acc.trainerId), "khách không còn thấy HLV đã xoá");
  const sched = await call("/schedule/trainers", { token: tokens.reception });
  assert.ok(!sched.data.trainers.some((t) => t.id === acc.trainerId), "quầy xếp lịch không còn thấy HLV đã xoá");
  const pay = await call("/payroll/settings", { token: tokens.admin });
  assert.equal(pay.status, 200);
  assert.ok(!pay.data.trainers.some((t) => t.id === acc.trainerId), "thiết lập thù lao không còn HLV đã xoá");
  assert.equal(await isTrainerLocked(trainerId), true, "lịch tự động phải bỏ qua HLV đã xoá");
});

// ---------- 8. Song song ----------

test("delete-parallel: 2 DELETE cùng lúc -> đúng 1 cái 200, cái kia 404", async () => {
  const cust = await makeCustomer({ withPackage: false });
  const [a, b] = await Promise.all([del(cust.id), del(cust.id)]);
  const statuses = [a.status, b.status].sort();
  assert.deepEqual(statuses, [200, 404], JSON.stringify([a.data, b.data]));
});

// ---------- 9. Input rác ----------

test("delete-bad-id: id sai kiểu 400, id không tồn tại 404", async () => {
  const bad = await del("abc");
  assert.equal(bad.status, 400);
  assert.ok(bad.data.error);
  const missing = await del(new mongoose.Types.ObjectId().toString());
  assert.equal(missing.status, 404);
  assert.ok(missing.data.error);
});

// ================= SỬA GÓI =================

// ---------- 12. Ma trận role ----------

test("pkg-role-matrix: HLV/khách/lễ tân 403 (her-56: chỉ admin sửa gói), không token 401; admin 200", async () => {
  const cust = await makeCustomer();
  for (const role of ["trainer", "customer", "reception"]) {
    const r = await patchPkg(cust.pkg._id, { name: "Hack" }, tokens[role]);
    assert.equal(r.status, 403, `${role}: ${JSON.stringify(r.data)}`);
  }
  const noTok = await call(`/packages/${cust.pkg._id}`, { method: "PATCH", body: { name: "Hack" } });
  assert.equal(noTok.status, 401);
  assert.equal((await Package.findById(cust.pkg._id)).name, "Pilates 1:1 her53");

  const r2 = await patchPkg(cust.pkg._id, { name: "Admin sua" }, tokens.admin);
  assert.equal(r2.status, 200, JSON.stringify(r2.data));
  assert.equal(r2.data.package.name, "Admin sua");
});

// ---------- 13. Sửa cơ bản ----------

test("pkg-edit-basic: sửa tên/giá/số buổi/hạn/hình thức TT trên gói chưa dùng", async () => {
  const cust = await makeCustomer();
  const target = daysFromNow(60);
  const r = await patchPkg(cust.pkg._id, {
    name: "  Pilates 20 buoi  ", price: 2000000, paidAmount: 2000000, totalSessions: 20,
    expiresAt: target.toISOString(), paymentMethod: "transfer",
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const p = r.data.package;
  assert.equal(p.name, "Pilates 20 buoi");
  assert.equal(p.price, 2000000);
  assert.equal(p.totalSessions, 20);
  assert.equal(p.remainingSessions, 20);
  assert.equal(p.paymentMethod, "transfer");
  assert.equal(p.status, "active");
  const exp = new Date(p.expiresAt);
  assert.equal(exp.getDate(), target.getDate());
  assert.equal(exp.getHours(), 23);
  assert.equal(exp.getMinutes(), 59);
  const db = await Package.findById(cust.pkg._id);
  assert.equal(db.totalSessions, 20);
  assert.equal(db.price, 2000000);
  assert.equal(db.usedSessions, 0);
  // Bỏ hạn (gói buổi không thời hạn) — hợp lệ
  const r2 = await patchPkg(cust.pkg._id, { expiresAt: null });
  assert.equal(r2.status, 200, JSON.stringify(r2.data));
  assert.equal(r2.data.package.expiresAt, null);
});

// ---------- 14. Sàn số buổi ----------

test("pkg-edit-sessions-floor: đã dùng 3 -> totalSessions 2 bị chặn, 3 và 4 được", async () => {
  const cust = await makeCustomer();
  await Package.updateOne({ _id: cust.pkg._id }, { $set: { usedSessions: 3 } });
  const r1 = await patchPkg(cust.pkg._id, { totalSessions: 2 });
  assert.equal(r1.status, 400, JSON.stringify(r1.data));
  assert.match(r1.data.error, /3 buổi/);
  assert.equal((await Package.findById(cust.pkg._id)).totalSessions, 10);
  const r2 = await patchPkg(cust.pkg._id, { totalSessions: 3 });
  assert.equal(r2.status, 200, JSON.stringify(r2.data));
  assert.equal(r2.data.package.status, "used_up");
  assert.equal(r2.data.package.remainingSessions, 0);
  const r3 = await patchPkg(cust.pkg._id, { totalSessions: 4 });
  assert.equal(r3.status, 200);
  assert.equal(r3.data.package.status, "active");
});

// ---------- 15. Khoá bộ môn / loại hình khi đã dùng ----------

// her-55 (03/09): chủ dự án đổi luật — gói đã dùng buổi VẪN đổi được bộ môn/loại hình khi không còn
// buổi sắp tới không khớp (case chặn khi còn buổi sắp tới nằm ở test/package-edit-delete.test.js)
test("pkg-edit-format-lock: gói đã dùng buổi (không còn buổi sắp tới) vẫn đổi được bộ môn/loại hình; gửi lại giá trị cũ OK; gói chưa dùng đổi được", async () => {
  const used = await makeCustomer();
  await Package.updateOne({ _id: used.pkg._id }, { $set: { usedSessions: 1 } });
  const r1 = await patchPkg(used.pkg._id, { format: "1:2" });
  assert.equal(r1.status, 200, JSON.stringify(r1.data));
  assert.equal(r1.data.package.format, "1:2");
  const r2 = await patchPkg(used.pkg._id, { serviceTypes: ["pilates", "gym"] });
  assert.equal(r2.status, 200, JSON.stringify(r2.data));
  const r3 = await patchPkg(used.pkg._id, { serviceTypes: ["pilates", "gym"], format: "1:2", name: "Van sua ten duoc" });
  assert.equal(r3.status, 200, JSON.stringify(r3.data));
  assert.equal(r3.data.package.name, "Van sua ten duoc");
  assert.equal(r3.data.package.usedSessions, 1, "số buổi đã dùng giữ nguyên");

  const fresh = await makeCustomer();
  const r4 = await patchPkg(fresh.pkg._id, { format: "1:2", serviceTypes: ["gym", "pilates"] });
  assert.equal(r4.status, 200, JSON.stringify(r4.data));
  assert.equal(r4.data.package.format, "1:2");
  assert.deepEqual(r4.data.package.serviceTypes, ["gym", "pilates"]);
});

// ---------- 16. Hình dạng gói (H7) ----------

test("pkg-edit-shape: mọi cách sửa vi phạm luật gói buổi/gói thời hạn đều 400", async () => {
  const cust = await makeCustomer();
  const cases = [
    [{ format: "1:8" }, /1:1, 1:2 hoặc 1:4/],
    [{ serviceTypes: [] }, /ít nhất 1 bộ môn/],
    [{ serviceTypes: ["pilates", "pilates"] }, /trùng/],
    [{ serviceTypes: ["khongco"] }, /không hợp lệ/],
  ];
  for (const [body, rx] of cases) {
    const r = await patchPkg(cust.pkg._id, body);
    assert.equal(r.status, 400, `${JSON.stringify(body)} -> ${JSON.stringify(r.data)}`);
    assert.match(r.data.error, rx);
  }
  // Gói buổi không hạn -> bỏ số buổi = không còn gì giới hạn
  const noExp = await makeCustomer();
  await Package.updateOne({ _id: noExp.pkg._id }, { $set: { expiresAt: null } });
  const r1 = await patchPkg(noExp.pkg._id, { totalSessions: null });
  assert.equal(r1.status, 400, JSON.stringify(r1.data));
  assert.match(r1.data.error, /số buổi hoặc ngày hết hạn/);

  // Gói thời hạn yoga 1:8 -> thêm số buổi thì thành gói buổi loại hình 1:8 (cấm)
  const yoga = await Package.create({
    userId: cust.user._id, name: "Yoga thang", serviceTypes: ["yoga"], format: "1:8",
    price: 500000, paidAmount: 500000, totalSessions: null, activatedAt: new Date(), expiresAt: daysFromNow(30),
  });
  const r2 = await patchPkg(yoga._id, { totalSessions: 5 });
  assert.equal(r2.status, 400, JSON.stringify(r2.data));
  const r3 = await patchPkg(yoga._id, { serviceTypes: ["pilates"] });
  assert.equal(r3.status, 400);
  assert.match(r3.data.error, /Yoga, loại hình 1:8/);
  assert.equal((await Package.findById(yoga._id)).totalSessions, null);
});

// ---------- 17. Thanh toán ----------

test("pkg-edit-payment: sửa số đã thu ghi đè dòng thu lúc bán (giữ thời điểm); có lần thu nợ thì chặn; giá < đã thu chặn", async () => {
  const cust = await makeCustomer({ withPackage: false });
  const sold = await call("/packages", {
    method: "POST", token: tokens.reception,
    body: { userId: cust.id, name: "Goi no", serviceTypes: ["pilates"], format: "1:1", price: 1000000, totalSessions: 10, paidAmount: 400000 },
  });
  assert.equal(sold.status, 201, JSON.stringify(sold.data));
  const pkgId = sold.data.package.id;
  assert.equal(sold.data.package.paymentCount, 1);
  const soldAt = (await Package.findById(pkgId)).payments[0].at.getTime();

  const r1 = await patchPkg(pkgId, { paidAmount: 600000 });
  assert.equal(r1.status, 200, JSON.stringify(r1.data));
  assert.equal(r1.data.package.paidAmount, 600000);
  assert.equal(r1.data.package.debt, 400000);
  let db = await Package.findById(pkgId);
  assert.equal(db.payments.length, 1);
  assert.equal(db.payments[0].amount, 600000);
  assert.equal(db.payments[0].at.getTime(), soldAt, "thời điểm bán giữ nguyên để doanh thu tháng không nhảy");

  const r2 = await patchPkg(pkgId, { price: 500000 });
  assert.equal(r2.status, 400, JSON.stringify(r2.data));
  assert.match(r2.data.error, /đã thu/);
  const r3 = await patchPkg(pkgId, { paidAmount: 1200000 });
  assert.equal(r3.status, 400);
  assert.match(r3.data.error, /không được lớn hơn giá/);
  // Hạ giá kèm số đã thu mới hợp lệ thì được
  const r4 = await patchPkg(pkgId, { price: 800000, paidAmount: 500000 });
  assert.equal(r4.status, 200, JSON.stringify(r4.data));
  assert.equal(r4.data.package.debt, 300000);

  // Thu nợ 1 lần -> sổ có 2 dòng -> không sửa tay số đã thu nữa, nhưng tên vẫn sửa được
  const pay = await call(`/packages/${pkgId}/pay`, { method: "PATCH", token: tokens.reception, body: { amount: 100000 } });
  assert.equal(pay.status, 200, JSON.stringify(pay.data));
  assert.equal(pay.data.package.paymentCount, 2);
  const r5 = await patchPkg(pkgId, { paidAmount: 700000 });
  assert.equal(r5.status, 400, JSON.stringify(r5.data));
  assert.match(r5.data.error, /Thu tiền/);
  // Gửi đúng số hiện tại (không đổi) thì không tính là sửa
  const r6 = await patchPkg(pkgId, { paidAmount: 600000, name: "Goi no da sua" });
  assert.equal(r6.status, 200, JSON.stringify(r6.data));
  db = await Package.findById(pkgId);
  assert.equal(db.payments.length, 2);
  assert.equal(db.paidAmount, 600000);

  // paidAmount về 0 -> sổ thu rỗng
  const other = await makeCustomer();
  const r7 = await patchPkg(other.pkg._id, { paidAmount: 0 });
  assert.equal(r7.status, 200, JSON.stringify(r7.data));
  assert.equal(r7.data.package.debt, 1000000);
  assert.equal((await Package.findById(other.pkg._id)).payments.length, 0);
});

// ---------- 18. Input bất thường ----------

test("pkg-edit-bad-input: id rác/không tồn tại, body rỗng, từng field sai kiểu -> 4xx { error }, gói không đổi", async () => {
  const cust = await makeCustomer();
  assert.equal((await patchPkg("abc", { name: "x" })).status, 400);
  assert.equal((await patchPkg(new mongoose.Types.ObjectId().toString(), { name: "x" })).status, 404);
  const empty = await patchPkg(cust.pkg._id, {});
  assert.equal(empty.status, 400);
  assert.match(empty.data.error, /Không có thông tin nào để sửa/);
  const unknownOnly = await patchPkg(cust.pkg._id, { pausedAt: null, userId: "x" });
  assert.equal(unknownOnly.status, 400, "field không được phép sửa bị bỏ qua -> coi như body rỗng");

  const bad = [
    { name: "" }, { name: "x".repeat(201) }, { price: "abc" }, { price: -1 }, { price: 1.5 },
    { serviceTypes: "gym" }, { format: "1:3" }, { expiresAt: "xyz" }, { expiresAt: daysFromNow(-1).toISOString() },
    { expiresAt: daysFromNow(4000).toISOString() }, { paymentMethod: "momo" }, { totalSessions: 2.5 }, { totalSessions: 10001 },
    { totalSessions: 0 }, { paidAmount: -5 }, { paidAmount: "100" },
  ];
  for (const body of bad) {
    const r = await patchPkg(cust.pkg._id, body);
    assert.equal(r.status, 400, `${JSON.stringify(body)} -> ${JSON.stringify(r.data)}`);
    assert.ok(r.data && r.data.error, `${JSON.stringify(body)} phải có { error }`);
  }
  const db = await Package.findById(cust.pkg._id);
  assert.equal(db.name, "Pilates 1:1 her53");
  assert.equal(db.price, 1000000);
  assert.equal(db.totalSessions, 10);
  assert.equal(db.paidAmount, 1000000);
});

// ---------- 19. Gói của khách đã xoá ----------

test("pkg-edit-deleted-owner: gói của tài khoản đã xoá -> 400 'đã bị xoá'", async () => {
  const cust = await makeCustomer();
  assert.equal((await del(cust.id)).status, 200);
  const r = await patchPkg(cust.pkg._id, { name: "x" });
  assert.equal(r.status, 400, JSON.stringify(r.data));
  assert.match(r.data.error, /đã bị xoá/);
});

// ---------- 20. Race PATCH ↔ đặt lịch ----------

test("pkg-edit-race: PATCH totalSessions=used và đặt lịch chạy cùng lúc -> không bao giờ usedSessions > totalSessions", async () => {
  for (let i = 0; i < 4; i++) {
    const cust = await makeCustomer();
    await Package.updateOne({ _id: cust.pkg._id }, { $set: { usedSessions: 9 } });
    const classId = await makeClass(24 + i);
    const [edit, book] = await Promise.all([
      patchPkg(cust.pkg._id, { totalSessions: 9 }),
      call("/bookings", { method: "POST", token: cust.token, body: { classId } }),
    ]);
    const db = await Package.findById(cust.pkg._id);
    assert.ok(db.usedSessions <= db.totalSessions, `vòng ${i}: used ${db.usedSessions} > total ${db.totalSessions} (${JSON.stringify([edit, book])})`);
    // Không thể cả hai cùng thành công
    assert.ok(!(edit.status === 200 && book.status === 201), `vòng ${i}: cả PATCH lẫn đặt lịch cùng thành công`);
    assert.ok([200, 400, 409].includes(edit.status), JSON.stringify(edit.data));
    assert.ok(edit.data && (edit.status === 200 || edit.data.error));
  }
});

// ================= Bổ sung sau review độc lập 03/09 =================

// ---------- 28. Race sửa GIÁ ↔ Thu tiền (review #1) ----------

test("pkg-edit-pay-race: PATCH price và /pay chạy cùng lúc -> không bao giờ paidAmount > price", async () => {
  for (let i = 0; i < 6; i++) {
    const cust = await makeCustomer({ withPackage: false });
    const sold = await call("/packages", {
      method: "POST", token: tokens.reception,
      body: { userId: cust.id, name: "Race tien", serviceTypes: ["pilates"], format: "1:1", price: 1000000, totalSessions: 10, paidAmount: 600000 },
    });
    assert.equal(sold.status, 201);
    const id = sold.data.package.id;
    const [edit, pay] = await Promise.all([
      patchPkg(id, { price: 700000 }),
      call(`/packages/${id}/pay`, { method: "PATCH", token: tokens.reception, body: { amount: 400000 } }),
    ]);
    const db = await Package.findById(id);
    assert.ok(db.paidAmount <= db.price, `vòng ${i}: paid ${db.paidAmount} > price ${db.price} (${JSON.stringify([edit.data, pay.data])})`);
    assert.ok(!(edit.status === 200 && pay.status === 200), `vòng ${i}: cả sửa giá lẫn thu tiền cùng 200`);
    if (edit.status !== 200) assert.ok([400, 409].includes(edit.status) && edit.data.error, JSON.stringify(edit.data));
  }
});

// ---------- 29. D9 với gói bán chưa thu đồng nào (review #2) ----------

test("pkg-edit-debt-after-zero-sale: bán paid 0 rồi thu nợ 1 lần -> sổ chỉ có 1 dòng nhưng vẫn KHÔNG sửa tay số đã thu; paidLocked=true", async () => {
  const cust = await makeCustomer({ withPackage: false });
  const sold = await call("/packages", {
    method: "POST", token: tokens.reception,
    body: { userId: cust.id, name: "Goi no toan bo", serviceTypes: ["pilates"], format: "1:1", price: 1000000, totalSessions: 10, paidAmount: 0 },
  });
  assert.equal(sold.status, 201);
  const id = sold.data.package.id;
  assert.equal(sold.data.package.paidLocked, false);
  // Chưa thu lần nào thì sửa tay được (sửa nhầm lúc bán)
  const ok = await patchPkg(id, { paidAmount: 100000 });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal((await Package.findById(id)).payments.length, 1);
  const back = await patchPkg(id, { paidAmount: 0 });
  assert.equal(back.status, 200);
  assert.equal((await Package.findById(id)).payments.length, 0);

  const pay = await call(`/packages/${id}/pay`, { method: "PATCH", token: tokens.reception, body: { amount: 400000 } });
  assert.equal(pay.status, 200, JSON.stringify(pay.data));
  assert.equal(pay.data.package.paymentCount, 1);
  assert.equal(pay.data.package.paidLocked, true);
  const r = await patchPkg(id, { paidAmount: 50000 });
  assert.equal(r.status, 400, JSON.stringify(r.data));
  assert.match(r.data.error, /Thu tiền/);
  const db = await Package.findById(id);
  assert.equal(db.paidAmount, 400000);
  assert.equal(db.payments[0].amount, 400000, "dòng thu nợ không bị ghi đè");
  // Các mục khác vẫn sửa được
  assert.equal((await patchPkg(id, { name: "Van sua ten" })).status, 200);
});

// ---------- 30. Race xoá tài khoản ↔ khách tự đặt lịch (review #3) ----------

test("delete-race-booking: DELETE và POST /bookings của chính khách chạy cùng lúc -> không bao giờ 'đã xoá' mà còn giữ chỗ", async () => {
  for (let i = 0; i < 6; i++) {
    const cust = await makeCustomer();
    const classId = await makeClass(40 + i);
    const [d, b] = await Promise.all([
      del(cust.id),
      call("/bookings", { method: "POST", token: cust.token, body: { classId } }),
    ]);
    const user = await User.findById(cust.id);
    const held = await Booking.countDocuments({ userId: cust.user._id, status: { $ne: "cancelled" } });
    const cls = await GymClass.findById(classId);
    if (user.deletedAt) {
      assert.equal(held, 0, `vòng ${i}: đã xoá nhưng còn ${held} booking (${JSON.stringify([d.data, b.data])})`);
      assert.equal(cls.bookedCount, 0, `vòng ${i}: đã xoá nhưng lớp vẫn giữ chỗ`);
      assert.equal((await Package.findById(cust.pkg._id)).usedSessions, 0, `vòng ${i}: đã xoá nhưng buổi không được hoàn`);
    } else {
      assert.equal(d.status, 400, `vòng ${i}: không xoá được thì phải 400 nói rõ (${JSON.stringify(d.data)})`);
      assert.match(d.data.error, /buổi sắp tới/);
      assert.equal(held, 1);
      assert.equal(cls.bookedCount, 1);
    }
    assert.ok(!(d.status === 200 && b.status === 201), `vòng ${i}: cả xoá lẫn đặt cùng thành công`);
  }
});

// ---------- 31. Chặn xoá khi buổi được điểm danh sớm nhưng chưa kết thúc (review #5) ----------

test("delete-blocked-early-attended: booking completed (điểm danh sớm) nhưng endAt còn ở tương lai -> vẫn chặn xoá", async () => {
  const cust = await makeCustomer();
  const classId = await makeClass(0.5);
  const cls = await GymClass.findById(classId);
  await Booking.create({
    userId: cust.user._id, classId, trainerId: coachId, title: cls.name, serviceType: "pilates", format: "1:1",
    startAt: cls.startAt, endAt: cls.endAt, status: "completed", attendanceAt: new Date(), packageId: cust.pkg._id,
  });
  const r = await del(cust.id);
  assert.equal(r.status, 400, JSON.stringify(r.data));
  assert.match(r.data.error, /1 buổi sắp tới/);
});

// ---------- 32. Sửa hạn khi đang bảo lưu (review #6) ----------

test("pkg-edit-paused-expiry: gói đang bảo lưu -> sửa ngày hết hạn 400, sửa tên vẫn 200", async () => {
  const cust = await makeCustomer();
  const pause = await call(`/packages/${cust.pkg._id}/pause`, { method: "PATCH", token: tokens.reception });
  assert.equal(pause.status, 200, JSON.stringify(pause.data));
  const r = await patchPkg(cust.pkg._id, { expiresAt: daysFromNow(90).toISOString() });
  assert.equal(r.status, 400, JSON.stringify(r.data));
  assert.match(r.data.error, /bảo lưu/);
  const ok = await patchPkg(cust.pkg._id, { name: "Sua ten khi bao luu" });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.package.status, "paused");
});
