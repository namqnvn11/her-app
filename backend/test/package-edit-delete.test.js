// her-55: sửa gói không khoá bộ môn/loại hình (chỉ chặn khi còn buổi sắp tới không khớp),
// XOÁ MỀM gói, trường "số buổi đã tập" — xem docs-her/testcase/testcase_her-55_package_edit_delete_used.md
// DB riêng her_test_w (tự seed), server cổng 4311.

const { test, before, after } = require("node:test");
const assert = require("node:assert");
const { spawn, spawnSync } = require("node:child_process");
const path = require("node:path");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const ROOT = path.join(__dirname, "..");
const URI = "mongodb://localhost:27017/her_test_w";
const S = "http://localhost:4311/api";

const User = require("../src/models/User");
const Package = require("../src/models/Package");
const Booking = require("../src/models/Booking");
const GymClass = require("../src/models/GymClass");

let proc;
const tokens = {};
const SERVER_ENV = { ...process.env, PORT: "4311", MONGODB_URI: URI, JWT_SECRET: "testsecret", MIN_CANCEL_HOURS: "3" };
let coachId;

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
async function loginOk(phone, password = "123456") {
  const r = await call("/auth/login", { method: "POST", body: { phone, password } });
  assert.equal(r.status, 200, `login ${phone}: ${JSON.stringify(r.data)}`);
  return r.data;
}
const hoursFromNow = (h) => new Date(Date.now() + h * 3600 * 1000);
const daysFromNow = (d) => new Date(Date.now() + d * 24 * 3600 * 1000);

let custSeq = 0;
async function makeCustomer() {
  const phone = `0967${String(custSeq++).padStart(6, "0")}`;
  const passwordHash = await bcrypt.hash("123456", 10);
  const user = await User.create({ name: `Khach her55 ${custSeq}`, phone, passwordHash, role: "customer" });
  const { token } = await loginOk(phone);
  return { user, token, phone, id: user._id.toString() };
}
// Bán gói qua API thật (usedSessions, paidAmount tuỳ chọn)
async function sell(userId, extra = {}) {
  const r = await call("/packages", {
    method: "POST", token: tokens.reception,
    body: { userId, name: "Pilates 10 buổi", serviceTypes: ["pilates"], format: "1:1", price: 1000000, totalSessions: 10, ...extra },
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data.package;
}
let clsSeq = 0;
async function makeClass(hours, { serviceType = "pilates", format = "1:1" } = {}) {
  const startAt = hoursFromNow(hours);
  const r = await mongoose.connection.db.collection("gymclasses").insertOne({
    name: `Buoi her55 ${clsSeq++}`, serviceType, format, coachId,
    startAt, endAt: new Date(startAt.getTime() + 3600 * 1000), capacity: 1, bookedCount: 0,
  });
  return r.insertedId;
}
// her-56: sửa/xoá gói chỉ ADMIN — mặc định thao tác bằng admin; lễ tân kiểm 403 ở ma trận
const patchPkg = (id, body, token = tokens.admin) => call(`/packages/${id}`, { method: "PATCH", token, body });
const delPkg = (id, token = tokens.admin) => call(`/packages/${id}`, { method: "DELETE", token });
const book = (token, classId) => call("/bookings", { method: "POST", token, body: { classId } });
const usedOf = async (id) => (await Package.findById(id)).usedSessions;

before(async () => {
  const seeded = spawnSync(process.execPath, ["src/scripts/seed.js"], { cwd: ROOT, env: { ...process.env, MONGODB_URI: URI }, stdio: "ignore" });
  assert.equal(seeded.status, 0, "seed her_test_w thất bại");
  proc = spawn(process.execPath, ["server.js"], { cwd: ROOT, env: SERVER_ENV, stdio: "ignore" });
  await waitHealthy(S);
  await mongoose.connect(URI);
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

// ---------- 1 + 2. Số buổi đã tập khi tạo ----------

test("create-used: POST usedSessions -> còn lại đúng; = tổng -> used_up; sai kiểu/quá tổng -> 400; gói thời hạn nhận được", async () => {
  const cust = await makeCustomer();
  const p1 = await sell(cust.id, { usedSessions: 1 });
  assert.equal(p1.usedSessions, 1);
  assert.equal(p1.remainingSessions, 9);
  assert.equal(p1.status, "active");
  const p2 = await sell(cust.id, { usedSessions: 10 });
  assert.equal(p2.status, "used_up");
  const p3 = await sell(cust.id);
  assert.equal(p3.usedSessions, 0);
  const dur = await call("/packages", {
    method: "POST", token: tokens.reception,
    body: { userId: cust.id, name: "Yoga thang", serviceTypes: ["yoga"], format: "1:8", price: 500000, totalSessions: null, expiresAt: daysFromNow(30).toISOString(), usedSessions: 3 },
  });
  assert.equal(dur.status, 201, JSON.stringify(dur.data));
  assert.equal(dur.data.package.usedSessions, 3);
  assert.equal(dur.data.package.remainingSessions, null);

  const before = await Package.countDocuments({ userId: cust.user._id });
  for (const bad of [11, -1, 1.5, "2"]) {
    const r = await call("/packages", {
      method: "POST", token: tokens.reception,
      body: { userId: cust.id, name: "Sai", serviceTypes: ["pilates"], format: "1:1", price: 1, totalSessions: 10, usedSessions: bad },
    });
    assert.equal(r.status, 400, `usedSessions ${JSON.stringify(bad)} -> ${JSON.stringify(r.data)}`);
    assert.ok(r.data.error);
  }
  assert.equal(await Package.countDocuments({ userId: cust.user._id }), before);
});

// ---------- 3. Số buổi đã tập khi sửa + hoàn buổi vẫn đối xứng ----------

test("edit-used: PATCH usedSessions; > tổng -> 400; kèm totalSessions -> used_up; hủy buổi đã đặt vẫn -1", async () => {
  const cust = await makeCustomer();
  const p = await sell(cust.id);
  const classId = await makeClass(30);
  const bk = await book(cust.token, classId);
  assert.equal(bk.status, 201, JSON.stringify(bk.data));
  assert.equal(await usedOf(p.id), 1);

  const r1 = await patchPkg(p.id, { usedSessions: 4 });
  assert.equal(r1.status, 200, JSON.stringify(r1.data));
  assert.equal(r1.data.package.remainingSessions, 6);
  const r2 = await patchPkg(p.id, { usedSessions: 11 });
  assert.equal(r2.status, 400, JSON.stringify(r2.data));
  assert.match(r2.data.error, /đã tập/);
  const r3 = await patchPkg(p.id, { totalSessions: 5, usedSessions: 5 });
  assert.equal(r3.status, 200, JSON.stringify(r3.data));
  assert.equal(r3.data.package.status, "used_up");
  const r4 = await patchPkg(p.id, { usedSessions: -1 });
  assert.equal(r4.status, 400);

  const cancel = await call(`/bookings/${bk.data.booking.id}`, { method: "DELETE", token: tokens.reception });
  assert.equal(cancel.status, 200, JSON.stringify(cancel.data));
  assert.equal(await usedOf(p.id), 4, "hủy vẫn hoàn -1 vào gói (5 -> 4)");
});

// ---------- 4. Đổi bộ môn/loại hình khi còn buổi sắp tới ----------

test("edit-type-upcoming: còn buổi Pilates 1:1 sắp tới -> bỏ pilates 400, thêm gym 200, đổi 1:2 400; hủy buổi -> đổi 1:2 200", async () => {
  const cust = await makeCustomer();
  const p = await sell(cust.id);
  const classId = await makeClass(48);
  const bk = await book(cust.token, classId);
  assert.equal(bk.status, 201);

  const r1 = await patchPkg(p.id, { serviceTypes: ["gym"] });
  assert.equal(r1.status, 400, JSON.stringify(r1.data));
  assert.match(r1.data.error, /1 buổi sắp tới/);
  const r2 = await patchPkg(p.id, { serviceTypes: ["pilates", "gym"] });
  assert.equal(r2.status, 200, JSON.stringify(r2.data));
  assert.deepEqual(r2.data.package.serviceTypes, ["pilates", "gym"]);
  const r3 = await patchPkg(p.id, { format: "1:2" });
  assert.equal(r3.status, 400, JSON.stringify(r3.data));
  assert.match(r3.data.error, /không hợp với gói mới/);
  assert.equal((await Package.findById(p.id)).format, "1:1");

  const cancel = await call(`/bookings/${bk.data.booking.id}`, { method: "DELETE", token: tokens.reception });
  assert.equal(cancel.status, 200);
  const r4 = await patchPkg(p.id, { format: "1:2" });
  assert.equal(r4.status, 200, JSON.stringify(r4.data));
  assert.equal(r4.data.package.format, "1:2");
  assert.equal(await usedOf(p.id), 0);
});

// ---------- 5. Chỉ có buổi quá khứ -> đổi thoải mái ----------

test("edit-type-past: gói chỉ có buổi ĐÃ TẬP (quá khứ) -> đổi bộ môn 200, booking cũ giữ packageId", async () => {
  const cust = await makeCustomer();
  const p = await sell(cust.id, { usedSessions: 1 });
  const classId = await makeClass(-48);
  const cls = await GymClass.findById(classId);
  const old = await Booking.create({
    userId: cust.user._id, classId, trainerId: coachId, title: cls.name, serviceType: "pilates", format: "1:1",
    startAt: cls.startAt, endAt: cls.endAt, status: "completed", attendanceAt: cls.startAt, packageId: p.id,
  });
  const r = await patchPkg(p.id, { serviceTypes: ["gym"], format: "1:4" });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(String((await Booking.findById(old._id)).packageId), String(p.id));
});

// ---------- 6. Đổi kiểu gói ----------

test("edit-kind: gói buổi đã dùng 1 -> đổi thành gói thời hạn Yoga 1:8 (không còn buổi sắp tới) -> 200; ngược lại thiếu số buổi -> 400", async () => {
  const cust = await makeCustomer();
  const p = await sell(cust.id, { usedSessions: 1 });
  const r = await patchPkg(p.id, { totalSessions: null, serviceTypes: ["yoga"], format: "1:8", expiresAt: daysFromNow(30).toISOString() });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.package.remainingSessions, null);
  assert.equal(r.data.package.usedSessions, 1);
  // Quay lại gói buổi mà quên số buổi -> luật hình dạng chặn
  const back = await patchPkg(p.id, { serviceTypes: ["pilates"], format: "1:1" });
  assert.equal(back.status, 400, JSON.stringify(back.data));
  const back2 = await patchPkg(p.id, { serviceTypes: ["pilates"], format: "1:1", totalSessions: 8 });
  assert.equal(back2.status, 200, JSON.stringify(back2.data));
  assert.equal(back2.data.package.remainingSessions, 7);
});

// ---------- 7. Ma trận xoá gói ----------

test("delete-matrix: HLV/khách/lễ tân 403 (her-56: chỉ admin), không token 401; admin 200", async () => {
  const cust = await makeCustomer();
  const a = await sell(cust.id);
  for (const role of ["trainer", "customer", "reception"]) {
    const r = await delPkg(a.id, tokens[role]);
    assert.equal(r.status, 403, `${role}: ${JSON.stringify(r.data)}`);
  }
  assert.equal((await call(`/packages/${a.id}`, { method: "DELETE" })).status, 401);
  assert.equal((await Package.findById(a.id)).deletedAt, null);
  assert.equal((await delPkg(a.id, tokens.admin)).status, 200);
});

// ---------- 8. Xoá xong biến mất, không thao tác được ----------

test("delete-happy: ẩn khỏi danh sách quầy/khách; khách đặt lớp bị 'chưa có gói'; pay/pause/resume/PATCH/DELETE lần 2 -> 404; doc còn trong DB", async () => {
  const cust = await makeCustomer();
  const p = await sell(cust.id, { paidAmount: 400000 });
  const r = await delPkg(p.id);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.ok, true);
  const db = await Package.findById(p.id);
  assert.ok(db && db.deletedAt, "xoá mềm: doc còn, có deletedAt");

  const staffList = await call(`/packages/customer/${cust.id}`, { token: tokens.reception });
  assert.equal(staffList.data.packages.length, 0);
  const mine = await call("/me/packages", { token: cust.token });
  assert.equal(mine.data.packages.length, 0);
  const one = await call("/me/package", { token: cust.token });
  assert.equal(one.data.package, null);

  const classId = await makeClass(30);
  const bk = await book(cust.token, classId);
  assert.equal(bk.status, 400, JSON.stringify(bk.data));
  assert.match(bk.data.error, /chưa có gói/);
  assert.equal(await usedOf(p.id), 0);

  for (const [m, pth, body] of [
    ["PATCH", "/pay", { amount: 1000 }], ["PATCH", "/pause"], ["PATCH", "/resume"], ["PATCH", "", { name: "x" }], ["DELETE", ""],
  ]) {
    // her-56: sửa/xoá là quyền admin — dùng admin để chắc chắn 404 là do gói đã xoá, không phải 403 quyền
    const rr = await call(`/packages/${p.id}${pth}`, { method: m, token: tokens.admin, body });
    assert.equal(rr.status, 404, `${m} ${pth}: ${JSON.stringify(rr.data)}`);
  }
});

// ---------- 9. Cờ nợ + đặt hộ ----------

test("delete-flags: gói nợ đã xoá -> khách rời danh sách nợ và rời danh sách đủ điều kiện đặt hộ", async () => {
  const cust = await makeCustomer();
  const p = await sell(cust.id, { paidAmount: 0 });
  const classId = await makeClass(50);
  let debt = await call("/accounts?role=customer&flag=debt", { token: tokens.reception });
  assert.ok(debt.data.accounts.some((a) => a.id === cust.id), "trước khi xoá: có trong danh sách nợ");
  let elig = await call(`/management/classes/${classId}/eligible-customers`, { token: tokens.reception });
  assert.ok(elig.data.customers.some((c) => c.id === cust.id), "trước khi xoá: đủ điều kiện đặt hộ");

  assert.equal((await delPkg(p.id)).status, 200);
  debt = await call("/accounts?role=customer&flag=debt", { token: tokens.reception });
  assert.ok(!debt.data.accounts.some((a) => a.id === cust.id), "sau khi xoá: hết nợ");
  elig = await call(`/management/classes/${classId}/eligible-customers`, { token: tokens.reception });
  assert.ok(!elig.data.customers.some((c) => c.id === cust.id), "sau khi xoá: không còn đủ điều kiện");
});

// ---------- 10. Doanh thu / số gói bán / nợ tồn ----------

test("delete-dashboard: bán gói làm revenue/packagesSold/debt tăng; xoá gói thì các số này quay về như cũ", async () => {
  const base = (await call("/dashboard", { token: tokens.admin })).data;
  const cust = await makeCustomer();
  const paid = await sell(cust.id, { price: 500000, paidAmount: 500000 });
  const owed = await sell(cust.id, { price: 300000, paidAmount: 100000 });
  const after = (await call("/dashboard", { token: tokens.admin })).data;
  assert.equal(after.revenue, base.revenue + 600000);
  assert.equal(after.packagesSold, base.packagesSold + 2);
  assert.equal(after.debt, base.debt + 200000);

  assert.equal((await delPkg(paid.id)).status, 200);
  assert.equal((await delPkg(owed.id)).status, 200);
  const back = (await call("/dashboard", { token: tokens.admin })).data;
  assert.equal(back.revenue, base.revenue, "doanh thu không tính gói đã xoá");
  assert.equal(back.packagesSold, base.packagesSold);
  assert.equal(back.debt, base.debt, "nợ tồn không tính gói đã xoá");
});

// ---------- 11. Chặn xoá khi còn buổi sắp tới ----------

test("delete-blocked-upcoming: gói còn buổi sắp tới đã trừ -> 400; hủy buổi -> xoá được", async () => {
  const cust = await makeCustomer();
  const p = await sell(cust.id);
  const classId = await makeClass(30);
  const bk = await book(cust.token, classId);
  assert.equal(bk.status, 201);
  const r1 = await delPkg(p.id);
  assert.equal(r1.status, 400, JSON.stringify(r1.data));
  assert.match(r1.data.error, /1 buổi sắp tới/);
  assert.equal((await Package.findById(p.id)).deletedAt, null);
  assert.equal((await call(`/bookings/${bk.data.booking.id}`, { method: "DELETE", token: tokens.reception })).status, 200);
  assert.equal((await delPkg(p.id)).status, 200);
});

// ---------- 12. Hoàn buổi vào gói đã xoá vẫn đối xứng ----------

test("delete-refund: booking sắp tới trỏ gói ĐÃ XOÁ (dữ liệu lọt qua khe/di sản) -> quầy hủy vẫn 200 và hoàn -1 đúng gói đã xoá", async () => {
  const cust = await makeCustomer();
  const p = await sell(cust.id, { usedSessions: 2 });
  assert.equal((await delPkg(p.id)).status, 200);
  // Chèn thẳng DB booking tương lai trỏ gói đã xoá (API không tạo được — đó là điều đúng)
  const classId = await makeClass(30);
  const cls = await GymClass.findById(classId);
  const bk = await Booking.create({
    userId: cust.user._id, classId, trainerId: coachId, title: cls.name, serviceType: "pilates", format: "1:1",
    startAt: cls.startAt, endAt: cls.endAt, status: "booked", packageId: p.id,
  });
  await GymClass.updateOne({ _id: classId }, { $inc: { bookedCount: 1 } });
  const cancel = await call(`/bookings/${bk._id}`, { method: "DELETE", token: tokens.reception });
  assert.equal(cancel.status, 200, JSON.stringify(cancel.data));
  assert.equal(await usedOf(p.id), 1, "hoàn -1 vào đúng gói dù gói đã xoá (E5, C2)");
  assert.equal((await GymClass.findById(classId)).bookedCount, 0);
});

// ---------- 13. Song song ----------

test("delete-parallel: 2 DELETE cùng gói -> 1 × 200, 1 × 404", async () => {
  const cust = await makeCustomer();
  const p = await sell(cust.id);
  const [a, b] = await Promise.all([delPkg(p.id), delPkg(p.id)]);
  assert.deepEqual([a.status, b.status].sort(), [200, 404], JSON.stringify([a.data, b.data]));
});

// ---------- 14. Input rác ----------

test("delete-bad-id: id rác 400; không tồn tại 404; gói của khách đã xoá tài khoản -> vẫn 200 (quầy dọn được qua API)", async () => {
  assert.equal((await delPkg("abc")).status, 400);
  assert.equal((await delPkg(new mongoose.Types.ObjectId().toString())).status, 404);
  const cust = await makeCustomer();
  const p = await sell(cust.id);
  assert.equal((await call(`/accounts/${cust.id}`, { method: "DELETE", token: tokens.admin })).status, 200);
  const r = await delPkg(p.id);
  assert.equal(r.status, 200, JSON.stringify(r.data));
});

// ================= Bổ sung sau review độc lập her-55 (03/09) =================

// ---------- 17. Race xoá gói ∥ khách đặt lịch (review #1) ----------

test("delete-race-booking: DELETE gói và POST /bookings cùng lúc -> không bao giờ 'gói đã xoá' mà còn buổi sắp tới trỏ vào nó", async () => {
  for (let i = 0; i < 6; i++) {
    const cust = await makeCustomer();
    const p = await sell(cust.id);
    const classId = await makeClass(60 + i);
    const [d, b] = await Promise.all([delPkg(p.id), book(cust.token, classId)]);
    const db = await Package.findById(p.id);
    const held = await Booking.countDocuments({ packageId: p.id, status: { $ne: "cancelled" }, endAt: { $gt: new Date() } });
    const cls = await GymClass.findById(classId);
    if (db.deletedAt) {
      assert.equal(held, 0, `vòng ${i}: gói đã xoá nhưng còn ${held} buổi sắp tới (${JSON.stringify([d.data, b.data])})`);
      assert.equal(cls.bookedCount, 0, `vòng ${i}: gói đã xoá nhưng lớp vẫn giữ chỗ`);
      assert.equal(db.usedSessions, 0, `vòng ${i}: gói đã xoá nhưng buổi không được hoàn`);
      assert.notEqual(b.status, 201, `vòng ${i}: khách nhận 201 dù gói đã xoá`);
    } else {
      assert.equal(d.status, 400, `vòng ${i}: không xoá được thì phải 400 nói rõ (${JSON.stringify(d.data)})`);
      assert.match(d.data.error, /buổi sắp tới/);
      assert.equal(held, 1);
      assert.equal(db.usedSessions, 1);
    }
  }
});

// ---------- 18. Race sửa loại hình ∥ khách đặt lịch (review #2) ----------

test("edit-race-booking: PATCH format 1:2 và POST /bookings lớp 1:1 cùng lúc -> không bao giờ buổi sắp tới lệch với gói", async () => {
  for (let i = 0; i < 6; i++) {
    const cust = await makeCustomer();
    const p = await sell(cust.id);
    const classId = await makeClass(80 + i);
    const [e, b] = await Promise.all([patchPkg(p.id, { format: "1:2" }), book(cust.token, classId)]);
    const db = await Package.findById(p.id);
    const upcoming = await Booking.find({ packageId: p.id, status: { $ne: "cancelled" }, endAt: { $gt: new Date() } });
    for (const bk of upcoming) {
      assert.equal(bk.format, db.format, `vòng ${i}: buổi ${bk.format} sắp tới trỏ gói ${db.format} (${JSON.stringify([e.data, b.data])})`);
    }
    assert.ok(!(e.status === 200 && b.status === 201), `vòng ${i}: cả sửa loại hình lẫn đặt buổi 1:1 cùng thành công`);
    if (b.status !== 201) assert.equal(db.usedSessions, 0, `vòng ${i}: đặt thất bại thì buổi phải được hoàn`);
  }
});

// ---------- 19. Rút ngắn hạn xuống trước buổi sắp tới (review #6) ----------

test("edit-expiry-upcoming: hạn mới sớm hơn ngày buổi sắp tới -> 400; hạn mới sau buổi -> 200", async () => {
  const cust = await makeCustomer();
  const p = await sell(cust.id, { expiresAt: daysFromNow(60).toISOString() });
  const classId = await makeClass(24 * 20);
  assert.equal((await book(cust.token, classId)).status, 201);
  const r1 = await patchPkg(p.id, { expiresAt: daysFromNow(10).toISOString() });
  assert.equal(r1.status, 400, JSON.stringify(r1.data));
  assert.match(r1.data.error, /1 buổi sắp tới/);
  const r2 = await patchPkg(p.id, { expiresAt: daysFromNow(30).toISOString() });
  assert.equal(r2.status, 200, JSON.stringify(r2.data));
});

// ---------- 20. Trần số buổi đã tập (review #11) ----------

test("used-cap: usedSessions 10001 trên gói thời hạn -> 400", async () => {
  const cust = await makeCustomer();
  const r = await call("/packages", {
    method: "POST", token: tokens.reception,
    body: { userId: cust.id, name: "Yoga", serviceTypes: ["yoga"], format: "1:8", price: 1, totalSessions: null, expiresAt: daysFromNow(30).toISOString(), usedSessions: 10001 },
  });
  assert.equal(r.status, 400, JSON.stringify(r.data));
  assert.match(r.data.error, /10\.000/);
});

// ================= her-56 (03/09): NGÀY BÁN — gói cũ nhập lùi, doanh thu vào đúng tháng =================

const ym = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const dash = async (month) => (await call(`/dashboard${month ? `?month=${month}` : ""}`, { token: tokens.admin })).data;

test("sold-at-create: lễ tân bán gói với soldAt tháng trước -> activatedAt + dòng thu = ngày đó; doanh thu/số gói bán vào THÁNG TRƯỚC, tháng này không đổi", async () => {
  const now = new Date();
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 15, 12, 0, 0);
  const baseLast = await dash(ym(lastMonth));
  const baseNow = await dash();
  const cust = await makeCustomer();
  const r = await call("/packages", {
    method: "POST", token: tokens.reception,
    body: { userId: cust.id, name: "Goi cu", serviceTypes: ["pilates"], format: "1:1", price: 800000, totalSessions: 10, usedSessions: 4, soldAt: lastMonth.toISOString(), durationDays: 90 },
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const p = r.data.package;
  assert.equal(new Date(p.activatedAt).getTime(), lastMonth.getTime());
  assert.equal(new Date(p.expiresAt).getTime(), lastMonth.getTime() + 90 * 24 * 3600 * 1000, "hạn tính từ NGÀY BÁN");
  const db = await Package.findById(p.id);
  assert.equal(db.payments.length, 1);
  assert.equal(db.payments[0].at.getTime(), lastMonth.getTime(), "dòng thu lúc bán mang ngày bán");
  assert.equal(p.paidLocked, false);

  const afterLast = await dash(ym(lastMonth));
  const afterNow = await dash();
  assert.equal(afterLast.revenue, baseLast.revenue + 800000, "doanh thu vào tháng bán");
  assert.equal(afterLast.packagesSold, baseLast.packagesSold + 1);
  assert.equal(afterNow.revenue, baseNow.revenue, "tháng này không tăng");
  assert.equal(afterNow.packagesSold, baseNow.packagesSold);
  // Đặt lịch bằng gói cũ vẫn bình thường (còn 6 buổi, còn hạn)
  const classId = await makeClass(24);
  assert.equal((await book(cust.token, classId)).status, 201);
});

test("sold-at-validate: tương lai / rác / quá 10 năm -> 400; hạn trước ngày bán -> 400; gói ĐÃ HẾT HẠN nhập lùi được (hạn sau ngày bán)", async () => {
  const cust = await makeCustomer();
  const base = { userId: cust.id, name: "X", serviceTypes: ["pilates"], format: "1:1", price: 1, totalSessions: 10 };
  const post = (extra) => call("/packages", { method: "POST", token: tokens.reception, body: { ...base, ...extra } });
  for (const bad of [daysFromNow(2).toISOString(), "xyz", daysFromNow(-3700).toISOString()]) {
    const r = await post({ soldAt: bad });
    assert.equal(r.status, 400, `${bad} -> ${JSON.stringify(r.data)}`);
    assert.match(r.data.error, /Ngày bán/);
  }
  const sold = daysFromNow(-100).toISOString();
  const r1 = await post({ soldAt: sold, expiresAt: daysFromNow(-120).toISOString() });
  assert.equal(r1.status, 400, JSON.stringify(r1.data));
  assert.match(r1.data.error, /sau ngày bán/);
  const r2 = await post({ soldAt: sold, expiresAt: daysFromNow(-10).toISOString() });
  assert.equal(r2.status, 201, JSON.stringify(r2.data));
  assert.equal(r2.data.package.status, "expired");
  // Không có soldAt thì hạn vẫn phải ở tương lai như cũ
  const r3 = await post({ expiresAt: daysFromNow(-10).toISOString() });
  assert.equal(r3.status, 400);
  assert.match(r3.data.error, /tương lai/);
});

test("sold-at-edit: admin đổi ngày bán -> dòng thu dời theo, doanh thu chuyển tháng; đã có thu nợ -> 400; ngày bán tương lai -> 400", async () => {
  const now = new Date();
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 10, 12, 0, 0);
  const baseLast = await dash(ym(lastMonth));
  const cust = await makeCustomer();
  const p = await sell(cust.id, { price: 600000, paidAmount: 600000 });
  const r = await patchPkg(p.id, { soldAt: lastMonth.toISOString() });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const db = await Package.findById(p.id);
  assert.equal(db.activatedAt.getTime(), lastMonth.getTime());
  assert.equal(db.payments[0].at.getTime(), lastMonth.getTime());
  assert.equal((await dash(ym(lastMonth))).revenue, baseLast.revenue + 600000);

  const bad = await patchPkg(p.id, { soldAt: daysFromNow(3).toISOString() });
  assert.equal(bad.status, 400);
  const withExp = await sell(cust.id, { expiresAt: daysFromNow(30).toISOString() });
  const r2 = await patchPkg(withExp.id, { soldAt: daysFromNow(-1).toISOString() });
  assert.equal(r2.status, 200, JSON.stringify(r2.data));

  const owed = await sell(cust.id, { paidAmount: 100000 });
  assert.equal((await call(`/packages/${owed.id}/pay`, { method: "PATCH", token: tokens.reception, body: { amount: 50000 } })).status, 200);
  const r3 = await patchPkg(owed.id, { soldAt: lastMonth.toISOString() });
  assert.equal(r3.status, 400, JSON.stringify(r3.data));
  assert.match(r3.data.error, /thu nợ/);
});
