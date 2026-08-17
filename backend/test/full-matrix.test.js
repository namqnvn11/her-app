// Test tổng lực her-04 — xem docs-her/testcase/testcase_her-04_full_audit.md
// Phần A: ma trận phân quyền TOÀN BỘ endpoint × 5 danh tính (admin/reception/trainer/customer/anon)
// Phần B: các luồng & biên chưa được cover ở her-01/02/03.
// DB riêng her_test_e (tự seed), server cổng 4131.

const { test, before, after } = require("node:test");
const assert = require("node:assert");
const { spawn, spawnSync } = require("node:child_process");
const path = require("node:path");
const mongoose = require("mongoose");

const ROOT = path.join(__dirname, "..");
const URI = "mongodb://localhost:27017/her_test_e";
const S = "http://localhost:4131/api";

const Booking = require("../src/models/Booking");
const Package = require("../src/models/Package");
const GymClass = require("../src/models/GymClass");
const PTSlot = require("../src/models/PTSlot");
const Trainer = require("../src/models/Trainer");
const User = require("../src/models/User");

let proc;
const tokens = {}; // admin, reception, trainer, customer (+ anon = không gửi token)

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
  assert.equal(seeded.status, 0, "seed her_test_e thất bại");
  proc = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: "4131", MONGODB_URI: URI, JWT_SECRET: "testsecret", MIN_CANCEL_HOURS: "3" },
    stdio: "ignore",
  });
  await waitHealthy(S);
  await mongoose.connect(URI);
  // her-19: suite này test các bất biến CŨ với coach bất kỳ — gỡ ràng buộc chuyên môn của
  // seed (specialties rỗng = hồ sơ cũ, được phép dạy mọi lớp); luật chuyên môn có test riêng.
  await mongoose.connection.db.collection("trainers").updateMany({}, { $set: { specialties: [] } });

  tokens.admin = (await login("0999999999")).token;
  tokens.reception = (await login("0900000000")).token;
  tokens.trainer = (await login("0911111111")).token;
  tokens.customer = (await login("0909090909")).token;
});

after(async () => {
  proc?.kill();
  await mongoose.disconnect();
});

// ================= PHẦN A — MA TRẬN PHÂN QUYỀN =================
// exp = { admin, reception, trainer, customer, anon } — status kỳ vọng cho từng danh tính.
// Body/ID cố tình sai để route được phép trả 400/404/410 (chứng minh đã vượt qua tầng quyền
// mà không tạo dữ liệu thật).

const MATRIX = [
  { m: "GET", p: "/health", exp: { admin: 200, reception: 200, trainer: 200, customer: 200, anon: 200 } },
  { m: "POST", p: "/auth/login", body: {}, exp: { admin: 400, reception: 400, trainer: 400, customer: 400, anon: 400 } },
  { m: "POST", p: "/auth/register", body: { name: "x", phone: "0912312312", password: "matkhau6" }, exp: { admin: 403, reception: 403, trainer: 403, customer: 403, anon: 403 } },

  { m: "GET", p: "/me", exp: { admin: 200, reception: 200, trainer: 200, customer: 200, anon: 401 } },
  { m: "PATCH", p: "/me", body: {}, exp: { admin: 200, reception: 200, trainer: 200, customer: 200, anon: 401 } },
  { m: "GET", p: "/me/package", exp: { admin: 200, reception: 200, trainer: 200, customer: 200, anon: 401 } },
  { m: "GET", p: "/me/bookings", exp: { admin: 200, reception: 200, trainer: 200, customer: 200, anon: 401 } },
  { m: "GET", p: "/me/history", exp: { admin: 200, reception: 200, trainer: 200, customer: 200, anon: 401 } },

  { m: "GET", p: "/classes", exp: { admin: 200, reception: 200, trainer: 200, customer: 200, anon: 401 } },
  { m: "GET", p: "/trainers", exp: { admin: 200, reception: 200, trainer: 200, customer: 200, anon: 401 } },

  { m: "POST", p: "/bookings", body: { type: "xxx" }, exp: { admin: 400, reception: 400, trainer: 400, customer: 400, anon: 401 } },
  { m: "DELETE", p: "/bookings/khong-id", exp: { admin: 400, reception: 400, trainer: 400, customer: 400, anon: 401 } },

  { m: "GET", p: "/management/bookings", exp: { admin: 200, reception: 200, trainer: 200, customer: 403, anon: 401 } },
  // her-05: module gói tập (body rỗng/id rác -> 400 với role được phép; role khác giữ 403/401)
  { m: "POST", p: "/packages", body: {}, exp: { admin: 400, reception: 400, trainer: 403, customer: 403, anon: 401 } },
  { m: "GET", p: "/packages/customer/khong-id", exp: { admin: 400, reception: 400, trainer: 403, customer: 403, anon: 401 } },
  { m: "PATCH", p: "/packages/khong-id/pay", body: {}, exp: { admin: 400, reception: 400, trainer: 403, customer: 403, anon: 401 } },
  { m: "PATCH", p: "/packages/khong-id/pause", body: {}, exp: { admin: 400, reception: 400, trainer: 403, customer: 403, anon: 401 } },
  { m: "PATCH", p: "/packages/khong-id/resume", body: {}, exp: { admin: 400, reception: 400, trainer: 403, customer: 403, anon: 401 } },
  { m: "GET", p: "/management/customers/khong-id/bookings", exp: { admin: 400, reception: 400, trainer: 403, customer: 403, anon: 401 } },
  { m: "GET", p: "/management/classes/khong-id/roster", exp: { admin: 400, reception: 400, trainer: 400, customer: 403, anon: 401 } },

  { m: "GET", p: "/schedule/trainers", exp: { admin: 200, reception: 200, trainer: 403, customer: 403, anon: 401 } },
  { m: "GET", p: "/schedule/classes", exp: { admin: 200, reception: 200, trainer: 403, customer: 403, anon: 401 } },
  { m: "GET", p: "/schedule/pt-slots", exp: { admin: 200, reception: 200, trainer: 200, customer: 403, anon: 401 } }, // her-11: HLV thấy khung CỦA MÌNH
  { m: "POST", p: "/schedule/classes", body: {}, exp: { admin: 400, reception: 400, trainer: 403, customer: 403, anon: 401 } },
  { m: "PATCH", p: "/schedule/classes/khong-id", body: {}, exp: { admin: 400, reception: 400, trainer: 403, customer: 403, anon: 401 } },
  { m: "DELETE", p: "/schedule/classes/khong-id", exp: { admin: 400, reception: 400, trainer: 403, customer: 403, anon: 401 } },
  { m: "POST", p: "/schedule/pt-slots", body: {}, exp: { admin: 400, reception: 400, trainer: 400, customer: 403, anon: 401 } }, // her-11: HLV được tạo (thiếu field -> 400)
  { m: "DELETE", p: "/schedule/pt-slots/khong-id", exp: { admin: 404, reception: 404, trainer: 404, customer: 403, anon: 401 } }, // her-11: id rác -> 404 (role gate trước)

  { m: "GET", p: "/accounts", exp: { admin: 200, reception: 200, trainer: 403, customer: 403, anon: 401 } },
  { m: "POST", p: "/accounts", body: { name: "x", phone: "abc", password: "matkhau6", role: "customer" }, exp: { admin: 400, reception: 400, trainer: 403, customer: 403, anon: 401 } },
  { m: "POST", p: "/accounts", body: { name: "x", phone: "0977777777", password: "matkhau6", role: "admin" }, exp: { admin: 403, reception: 403, trainer: 403, customer: 403, anon: 401 } },
  { m: "PATCH", p: "/accounts/khong-id", body: { name: "x" }, exp: { admin: 400, reception: 400, trainer: 403, customer: 403, anon: 401 } },
  { m: "DELETE", p: "/accounts/khong-id", exp: { admin: 410, reception: 410, trainer: 403, customer: 403, anon: 401 } },
];

test("A: ma trận phân quyền toàn bộ endpoint × 5 danh tính", async () => {
  const failures = [];
  for (const c of MATRIX) {
    for (const who of ["admin", "reception", "trainer", "customer", "anon"]) {
      const r = await call(c.p, { method: c.m, token: tokens[who], body: c.body });
      if (r.status !== c.exp[who]) {
        failures.push(`${c.m} ${c.p} [${who}]: kỳ vọng ${c.exp[who]}, nhận ${r.status} ${JSON.stringify(r.data)}`);
      }
      // Mọi response phải là JSON có nội dung — không được treo/rỗng
      if (r.data === null) failures.push(`${c.m} ${c.p} [${who}]: response không phải JSON`);
    }
  }
  assert.deepEqual(failures, [], `\n${failures.join("\n")}`);
});

// ================= PHẦN B — LUỒNG & BIÊN BỔ SUNG =================

test("B1+B2: token giả mạo / token của user đã xoá -> 401", async () => {
  const tampered = await call("/me", { token: tokens.customer.slice(0, -2) + "xx" });
  assert.equal(tampered.status, 401);

  const noBearer = await fetch(`${S}/me`, { headers: { Authorization: tokens.customer } });
  assert.equal(noBearer.status, 401);

  // User bị xoá thẳng trong DB nhưng token còn sống
  const reception = tokens.reception;
  await call("/accounts", {
    method: "POST", token: reception,
    body: { name: "Se bi xoa", phone: "0944444444", password: "matkhau6", role: "customer" },
  });
  const ghostToken = (await login("0944444444", "matkhau6")).token;
  await User.deleteOne({ phone: "0944444444" });
  const ghost = await call("/me", { token: ghostToken });
  assert.equal(ghost.status, 401);
  assert.match(ghost.data.error, /không còn tồn tại/);
});

test("B3: mọi gói hết hạn -> /me/package trả null", async () => {
  const vy = await login("0912345678");
  const userId = (await User.findOne({ phone: "0912345678" }))._id;
  await Package.updateMany({ userId }, { $set: { expiresAt: hoursFromNow(-1) } });
  const r = await call("/me/package", { token: vy.token });
  assert.equal(r.data.package, null);
  await Package.updateMany({ userId }, { $set: { expiresAt: hoursFromNow(24 * 25) } });
});

test("B4+B5: /me/bookings vs /me/history phân loại đúng; PATCH /me đổi tên", async () => {
  const minh = await login("0909090909");
  const up = await call("/me/bookings", { token: minh.token });
  for (const b of up.data.bookings) {
    assert.equal(b.status, "booked");
    assert.ok(new Date(b.startAt) >= new Date(Date.now() - 60 * 1000), "sắp tới không được chứa buổi quá khứ");
  }
  const his = await call("/me/history", { token: minh.token });
  assert.ok(his.data.bookings.some((b) => b.status === "completed"), "history phải có buổi đã tập (seed)");
  assert.ok(his.data.bookings.some((b) => b.status === "cancelled"), "history phải có buổi đã hủy (seed)");

  const renamed = await call("/me", { method: "PATCH", token: minh.token, body: { name: "Minh Anh Updated" } });
  assert.equal(renamed.data.user.name, "Minh Anh Updated");
  await call("/me", { method: "PATCH", token: minh.token, body: { name: "Minh Anh" } });
});

test("B6: khách bị chặn hủy buổi sát giờ (403) nhưng lễ tân hủy được (200) và buổi được hoàn", async () => {
  const minh = await login("0909090909");
  const soon = (await call("/me/bookings", { token: minh.token })).data.bookings.find(
    (b) => (new Date(b.startAt) - Date.now()) / 3600000 < 3
  );
  assert.ok(soon, "seed phải có buổi sát giờ");

  const denied = await call(`/bookings/${soon.id}`, { method: "DELETE", token: minh.token });
  assert.equal(denied.status, 403);
  assert.match(denied.data.error, /3 tiếng/);

  const minhId = (await User.findOne({ phone: "0909090909" }))._id;
  const before = (await Package.findOne({ userId: minhId, serviceType: "pt" })).usedSessions;
  const staffCancel = await call(`/bookings/${soon.id}`, { method: "DELETE", token: tokens.reception });
  assert.equal(staffCancel.status, 200);
  assert.equal(
    (await Package.findOne({ userId: minhId, serviceType: "pt" })).usedSessions,
    before - 1,
    "lễ tân hủy hộ phải hoàn buổi cho khách (về đúng gói PT — H7)"
  );
});

test("B7: roster — HLV xem lớp mình 200, lớp HLV khác 403", async () => {
  const linhId = (await User.findOne({ phone: "0911111111" })).trainerId;
  const own = await GymClass.findOne({ coachId: linhId });
  const other = await GymClass.findOne({ coachId: { $ne: linhId } });

  assert.equal((await call(`/management/classes/${own._id}/roster`, { token: tokens.trainer })).status, 200);
  assert.equal((await call(`/management/classes/${other._id}/roster`, { token: tokens.trainer })).status, 403);
  assert.equal((await call(`/management/classes/${other._id}/roster`, { token: tokens.reception })).status, 200);
});

test("B8+B9: guard vai trò trên dữ liệu — id HLV vào endpoint customer 404; reception hỏi role ngoài phạm vi chỉ nhận customer", async () => {
  const trainerUser = await User.findOne({ phone: "0911111111" });
  const r = await call(`/management/customers/${trainerUser._id}/bookings`, { token: tokens.reception });
  assert.equal(r.status, 404);

  const list = await call("/accounts?role=trainer", { token: tokens.reception });
  assert.equal(list.status, 200);
  assert.ok(list.data.accounts.every((a) => a.role === "customer"), "không được lộ tài khoản ngoài phạm vi quản lý");
});

test("B10: classId là ID của PT slot (nhầm collection) -> 404, không mất buổi", async () => {
  const minh = await login("0909090909");
  const before = (await call("/me/package", { token: minh.token })).data.package.usedSessions;
  const slot = await PTSlot.findOne();
  const r = await call("/bookings", { method: "POST", token: minh.token, body: { type: "group", classId: slot._id } });
  assert.equal(r.status, 404);
  assert.equal((await call("/me/package", { token: minh.token })).data.package.usedSessions, before);
});

test("B11: đặt PT trùng giờ với lớp group đã đặt -> 400 'trùng giờ'", async () => {
  const vy = await login("0912345678");
  const trainers = (await call("/schedule/trainers", { token: tokens.reception })).data.trainers;

  // Lớp và slot cùng khung giờ xa (tránh đụng dữ liệu khác)
  const cls = await call("/schedule/classes", {
    method: "POST", token: tokens.reception,
    body: { name: "Overlap G", serviceType: "yoga", coachId: trainers[0].id, startAt: hoursFromNow(260), endAt: hoursFromNow(261) },
  });
  const slot = await call("/schedule/pt-slots", {
    method: "POST", token: tokens.reception,
    body: { trainerId: trainers[1].id, startAt: hoursFromNow(260.5), endAt: hoursFromNow(261.5) },
  });

  const bookG = await call("/bookings", { method: "POST", token: vy.token, body: { type: "group", classId: cls.data.class._id } });
  assert.equal(bookG.status, 201, JSON.stringify(bookG.data));
  const bookPT = await call("/bookings", { method: "POST", token: vy.token, body: { type: "pt", slotId: slot.data.slot._id } });
  assert.equal(bookPT.status, 400);
  assert.match(bookPT.data.error, /trùng giờ/);
  // Buổi bị từ chối không được trừ vào gói
  await call(`/bookings/${bookG.data.booking.id}`, { method: "DELETE", token: vy.token });
});

test("B12: xoá lớp/slot trống được, có khách thì bị chặn", async () => {
  const vy = await login("0912345678");
  const trainers = (await call("/schedule/trainers", { token: tokens.reception })).data.trainers;

  const freeCls = await call("/schedule/classes", {
    method: "POST", token: tokens.reception,
    body: { name: "Xoa duoc", serviceType: "yoga", coachId: trainers[0].id, startAt: hoursFromNow(270), endAt: hoursFromNow(271) },
  });
  assert.equal((await call(`/schedule/classes/${freeCls.data.class._id}`, { method: "DELETE", token: tokens.reception })).status, 200);

  const bookedCls = await call("/schedule/classes", {
    method: "POST", token: tokens.reception,
    body: { name: "Khong xoa duoc", serviceType: "yoga", coachId: trainers[0].id, startAt: hoursFromNow(272), endAt: hoursFromNow(273) },
  });
  const bk = await call("/bookings", { method: "POST", token: vy.token, body: { type: "group", classId: bookedCls.data.class._id } });
  assert.equal(bk.status, 201, JSON.stringify(bk.data));
  const del = await call(`/schedule/classes/${bookedCls.data.class._id}`, { method: "DELETE", token: tokens.reception });
  assert.equal(del.status, 400);
  await call(`/bookings/${bk.data.booking.id}`, { method: "DELETE", token: vy.token });

  const freeSlot = await call("/schedule/pt-slots", {
    method: "POST", token: tokens.reception,
    body: { trainerId: trainers[0].id, startAt: hoursFromNow(274), endAt: hoursFromNow(275) },
  });
  assert.equal((await call(`/schedule/pt-slots/${freeSlot.data.slot._id}`, { method: "DELETE", token: tokens.reception })).status, 200);

  const bookedSlot = await call("/schedule/pt-slots", {
    method: "POST", token: tokens.reception,
    body: { trainerId: trainers[0].id, startAt: hoursFromNow(276), endAt: hoursFromNow(277) },
  });
  // H7: đặt PT cần gói loại pt — Thảo Vy seed chỉ có yoga/gym
  const vyId = (await User.findOne({ phone: "0912345678" }))._id;
  await Package.create({
    userId: vyId, name: "PT test B12", serviceType: "pt", price: 1,
    totalSessions: 5, activatedAt: new Date(), expiresAt: null,
  });
  const bkPt = await call("/bookings", { method: "POST", token: vy.token, body: { type: "pt", slotId: bookedSlot.data.slot._id } });
  assert.equal(bkPt.status, 201, JSON.stringify(bkPt.data));
  assert.equal((await call(`/schedule/pt-slots/${bookedSlot.data.slot._id}`, { method: "DELETE", token: tokens.reception })).status, 400);
  await call(`/bookings/${bkPt.data.booking.id}`, { method: "DELETE", token: vy.token });
});

test("B13+B14: đổi tên tài khoản HLV đồng bộ Trainer.name; SĐT trùng -> 409", async () => {
  const linhUser = await User.findOne({ phone: "0911111111" });
  const renamed = await call(`/accounts/${linhUser._id}`, {
    method: "PATCH", token: tokens.admin, body: { name: "HLV Linh Moi" },
  });
  assert.equal(renamed.status, 200);
  assert.equal((await Trainer.findById(linhUser.trainerId)).name, "HLV Linh Moi", "hồ sơ Trainer phải đổi tên theo");
  await call(`/accounts/${linhUser._id}`, { method: "PATCH", token: tokens.admin, body: { name: "HLV Linh" } });
  await Trainer.updateOne({ _id: linhUser.trainerId }, { $set: { name: "HLV Linh" } });

  const dup = await call("/accounts", {
    method: "POST", token: tokens.reception,
    body: { name: "Trung SDT", phone: "0909090909", password: "matkhau6", role: "customer" },
  });
  assert.equal(dup.status, 409);
});

// ================= PHẦN C — CÁC FIX SAU VÒNG AUDIT TOÀN DỰ ÁN =================

test("C1: MỘT HLV không thể bị xếp 2 lịch trùng giờ (lớp đè lớp, PT đè lớp, PATCH dời vào giờ bận)", async () => {
  const trainers = (await call("/schedule/trainers", { token: tokens.reception })).data.trainers;
  const coach = trainers[0];

  const first = await call("/schedule/classes", {
    method: "POST", token: tokens.reception,
    body: { name: "Goc lich", serviceType: "pilates", coachId: coach.id, startAt: hoursFromNow(300), endAt: hoursFromNow(301) },
  });
  assert.equal(first.status, 201, JSON.stringify(first.data));

  // Lớp thứ hai đè giờ cùng HLV -> 400
  const dupClass = await call("/schedule/classes", {
    method: "POST", token: tokens.reception,
    body: { name: "De len", serviceType: "pilates", coachId: coach.id, startAt: hoursFromNow(300.5), endAt: hoursFromNow(301.5) },
  });
  assert.equal(dupClass.status, 400);
  assert.match(dupClass.data.error, /trùng giờ/);

  // PT slot đè lên lớp cùng HLV -> 400
  const dupSlot = await call("/schedule/pt-slots", {
    method: "POST", token: tokens.reception,
    body: { trainerId: coach.id, startAt: hoursFromNow(300), endAt: hoursFromNow(301) },
  });
  assert.equal(dupSlot.status, 400);
  assert.match(dupSlot.data.error, /trùng giờ/);

  // HLV khác cùng khung giờ thì vẫn được
  const other = await call("/schedule/classes", {
    method: "POST", token: tokens.reception,
    body: { name: "HLV khac cung gio", serviceType: "pilates", coachId: trainers[1].id, startAt: hoursFromNow(300), endAt: hoursFromNow(301) },
  });
  assert.equal(other.status, 201, JSON.stringify(other.data));

  // PATCH dời lớp trống vào giờ bận của chính HLV -> 400
  const free = await call("/schedule/classes", {
    method: "POST", token: tokens.reception,
    body: { name: "Sap bi doi", serviceType: "pilates", coachId: coach.id, startAt: hoursFromNow(305), endAt: hoursFromNow(306) },
  });
  const moved = await call(`/schedule/classes/${free.data.class._id}`, {
    method: "PATCH", token: tokens.reception,
    body: { startAt: hoursFromNow(300.25), endAt: hoursFromNow(300.75) },
  });
  assert.equal(moved.status, 400);
  assert.match(moved.data.error, /trùng giờ/);
});

test("C2: gói còn hạn hôm nay nhưng HẾT HẠN TRƯỚC NGÀY buổi tập -> không cho đặt, báo đúng lý do", async () => {
  const vy = await login("0912345678");
  const userId = (await User.findOne({ phone: "0912345678" }))._id;
  const cls = await call("/schedule/classes", {
    method: "POST", token: tokens.reception,
    body: { name: "Sau khi goi het han", serviceType: "yoga", coachId: (await call("/schedule/trainers", { token: tokens.reception })).data.trainers[1].id, startAt: hoursFromNow(310), endAt: hoursFromNow(311) },
  });
  // Gói còn hạn 24h nữa (còn hiệu lực HÔM NAY) nhưng lớp ở giờ +310h
  await Package.updateMany({ userId }, { $set: { expiresAt: hoursFromNow(24) } });
  const r = await call("/bookings", { method: "POST", token: vy.token, body: { type: "group", classId: cls.data.class._id } });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /hết hạn trước ngày diễn ra/);
  const yogaPkg = await Package.findOne({ userId, serviceType: "yoga" });
  assert.equal(yogaPkg.usedSessions <= yogaPkg.totalSessions, true);
  await Package.updateMany({ userId }, { $set: { expiresAt: hoursFromNow(24 * 30) } });
});

test("C3: đầu vào quái — phone dạng mảng, body không phải JSON -> 4xx thân thiện, không 500", async () => {
  const arrPhone = await call("/auth/login", { method: "POST", body: { phone: ["0909090909"], password: "123456" } });
  assert.equal(arrPhone.status, 400);

  const arrAccounts = await call("/accounts", {
    method: "POST", token: tokens.reception,
    body: { name: "x", phone: ["0912312399"], password: "matkhau6", role: "customer" },
  });
  assert.equal(arrAccounts.status, 400);

  const broken = await fetch(`${S}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: '{"phone": "09090',
  });
  assert.equal(broken.status, 400);
  const data = await broken.json();
  assert.match(data.error, /JSON/);
});

test("C4: buổi ĐANG diễn ra vẫn hiện ở 'lịch sắp tới', không rơi vào lịch sử trước khi kết thúc", async () => {
  const userId = (await User.findOne({ phone: "0909090909" }))._id;
  const trainerDoc = await mongoose.connection.db.collection("trainers").findOne({});
  const inProgress = await Booking.create({
    userId, type: "group", trainerId: trainerDoc._id, title: "Dang dien ra",
    startAt: hoursFromNow(-0.5), endAt: hoursFromNow(0.5), status: "booked",
  });
  try {
    const minh = await login("0909090909");
    const up = await call("/me/bookings", { token: minh.token });
    assert.ok(up.data.bookings.some((b) => b.title === "Dang dien ra"), "buổi 7:00-8:00 lúc 7:30 phải còn trong 'sắp tới'");
    const his = await call("/me/history", { token: minh.token });
    assert.ok(!his.data.bookings.some((b) => b.title === "Dang dien ra"), "chưa kết thúc thì chưa vào lịch sử");
  } finally {
    await Booking.deleteOne({ _id: inProgress._id });
  }
});

test("C5: PATCH tài khoản với password:null bỏ qua (không 400 oan); đổi mật khẩu thật -> login bằng mật khẩu mới", async () => {
  const created = await call("/accounts", {
    method: "POST", token: tokens.reception,
    body: { name: "Doi mat khau", phone: "0988888888", password: "matkhau6", role: "customer" },
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const id = created.data.account.id;

  const nullPass = await call(`/accounts/${id}`, { method: "PATCH", token: tokens.reception, body: { name: "Doi ten", password: null } });
  assert.equal(nullPass.status, 200, "password null = không đổi, không được 400");

  const changed = await call(`/accounts/${id}`, { method: "PATCH", token: tokens.reception, body: { password: "matkhaumoi9" } });
  assert.equal(changed.status, 200);
  const oldLogin = await call("/auth/login", { method: "POST", body: { phone: "0988888888", password: "matkhau6" } });
  assert.equal(oldLogin.status, 401, "mật khẩu cũ phải hết dùng được");
  await login("0988888888", "matkhaumoi9");
});

test("C6: HLV tự đổi tên qua /me -> hồ sơ Trainer (tên hiện với khách) đổi theo", async () => {
  const linhUser = await User.findOne({ phone: "0911111111" });
  const r = await call("/me", { method: "PATCH", token: tokens.trainer, body: { name: "HLV Linh Tu Doi" } });
  assert.equal(r.status, 200);
  assert.equal((await Trainer.findById(linhUser.trainerId)).name, "HLV Linh Tu Doi");
  await call("/me", { method: "PATCH", token: tokens.trainer, body: { name: "HLV Linh" } });
});

// ==== her-06 (16/08/2026): HLV không được xem SĐT khách — chặn ở server (H5, C1) ====

test("B15: SĐT khách ẩn với HLV ở /management/bookings; reception/admin vẫn thấy", async () => {
  const linhId = (await User.findOne({ phone: "0911111111" })).trainerId;
  const customer = await User.findOne({ phone: "0909090909" });
  // Lớp + booking riêng cho test (giờ xa tương lai để không đụng dữ liệu seed)
  const cls = await GymClass.create({
    name: "Lop test SDT", coachId: linhId, capacity: 5, bookedCount: 1,
    serviceType: "pilates",
    startAt: hoursFromNow(200), endAt: hoursFromNow(201),
  });
  const bk = await Booking.create({
    userId: customer._id, type: "group", classId: cls._id, trainerId: linhId,
    title: "Lop test SDT", startAt: cls.startAt, endAt: cls.endAt, status: "booked",
  });
  try {
    for (const [role, seesPhone] of [["trainer", false], ["reception", true], ["admin", true]]) {
      const r = await call("/management/bookings?range=upcoming", { token: tokens[role] });
      assert.equal(r.status, 200, `${role} phải xem được danh sách`);
      const found = r.data.bookings.find((b) => b.title === "Lop test SDT");
      assert.ok(found, `${role} phải thấy booking test`);
      assert.equal(found.customer.name, customer.name, `${role} vẫn thấy TÊN khách`);
      if (seesPhone) {
        assert.equal(found.customer.phone, customer.phone, `${role} phải thấy SĐT khách`);
      } else {
        assert.ok(!("phone" in found.customer), "HLV không được nhận field phone (kể cả rỗng)");
      }
    }
  } finally {
    await Booking.deleteOne({ _id: bk._id });
    await GymClass.deleteOne({ _id: cls._id });
  }
});

test("B16: SĐT khách ẩn với HLV ở roster lớp mình; reception vẫn thấy", async () => {
  const linhId = (await User.findOne({ phone: "0911111111" })).trainerId;
  const customer = await User.findOne({ phone: "0909090909" });
  const cls = await GymClass.create({
    name: "Lop test SDT roster", coachId: linhId, capacity: 5, bookedCount: 1,
    serviceType: "pilates",
    startAt: hoursFromNow(210), endAt: hoursFromNow(211),
  });
  const bk = await Booking.create({
    userId: customer._id, type: "group", classId: cls._id, trainerId: linhId,
    title: "Lop test SDT roster", startAt: cls.startAt, endAt: cls.endAt, status: "booked",
  });
  try {
    const asTrainer = await call(`/management/classes/${cls._id}/roster`, { token: tokens.trainer });
    assert.equal(asTrainer.status, 200);
    assert.equal(asTrainer.data.customers.length, 1);
    assert.equal(asTrainer.data.customers[0].name, customer.name);
    assert.ok(!("phone" in asTrainer.data.customers[0]), "HLV không được nhận field phone trong roster");

    const asReception = await call(`/management/classes/${cls._id}/roster`, { token: tokens.reception });
    assert.equal(asReception.status, 200);
    assert.equal(asReception.data.customers[0].phone, customer.phone, "lễ tân vẫn thấy SĐT");
  } finally {
    await Booking.deleteOne({ _id: bk._id });
    await GymClass.deleteOne({ _id: cls._id });
  }
});

test("B17: HLV không dò được SĐT khách qua ?search= (chỉ tìm theo tên); lễ tân vẫn tìm theo SĐT", async () => {
  const linhId = (await User.findOne({ phone: "0911111111" })).trainerId;
  const customer = await User.findOne({ phone: "0909090909" });
  const cls = await GymClass.create({
    name: "Lop test search SDT", coachId: linhId, capacity: 5, bookedCount: 1,
    serviceType: "pilates",
    startAt: hoursFromNow(220), endAt: hoursFromNow(221),
  });
  const bk = await Booking.create({
    userId: customer._id, type: "group", classId: cls._id, trainerId: linhId,
    title: "Lop test search SDT", startAt: cls.startAt, endAt: cls.endAt, status: "booked",
  });
  const has = (r) => r.data.bookings.some((b) => b.title === "Lop test search SDT");
  try {
    // HLV search theo cụm số trong SĐT khách -> KHÔNG được ra kết quả (chặn kênh suy diễn)
    const byPhone = await call(`/management/bookings?range=upcoming&search=${customer.phone.slice(0, 6)}`, { token: tokens.trainer });
    assert.equal(byPhone.status, 200);
    assert.ok(!has(byPhone), "HLV search theo số phải KHÔNG match — nếu match là dò được SĐT");
    // HLV search theo tên -> vẫn dùng được bình thường
    const byName = await call(`/management/bookings?range=upcoming&search=${encodeURIComponent(customer.name)}`, { token: tokens.trainer });
    assert.ok(has(byName), "HLV search theo tên khách vẫn phải ra kết quả");
    // Lễ tân search theo SĐT -> vẫn ra (nghiệp vụ quầy cần)
    const reception = await call(`/management/bookings?range=upcoming&search=${customer.phone.slice(0, 6)}`, { token: tokens.reception });
    assert.ok(has(reception), "lễ tân search theo SĐT vẫn phải ra kết quả");
  } finally {
    await Booking.deleteOne({ _id: bk._id });
    await GymClass.deleteOne({ _id: cls._id });
  }
});
