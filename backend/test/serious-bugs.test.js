// Test cho đợt sửa lỗi nghiêm trọng L1–L3 — xem docs-her/testcase/testcase_her-02_serious_bugs_L1_L3.md
// Chạy: npm test  (cần MongoDB local: docker start her-mongo)
// Suite này dùng DB riêng her_test_c (tự seed lại mỗi lần chạy) + server thật cổng 4111.

const { test, before, after } = require("node:test");
const assert = require("node:assert");
const { spawn, spawnSync } = require("node:child_process");
const path = require("node:path");
const mongoose = require("mongoose");

const ROOT = path.join(__dirname, "..");
const URI = "mongodb://localhost:27017/her_test_c";
const S = "http://localhost:4111/api";
const SECRET = "testsecret";

const Booking = require("../src/models/Booking");
const Package = require("../src/models/Package");
const GymClass = require("../src/models/GymClass");
const PTSlot = require("../src/models/PTSlot");

let proc;

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

async function call(base, pathName, { method = "GET", token, body } = {}) {
  const res = await fetch(base + pathName, {
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
  const r = await call(S, "/auth/login", { method: "POST", body: { phone, password } });
  assert.equal(r.status, 200, `login ${phone} thất bại: ${JSON.stringify(r.data)}`);
  return r.data;
}

const hoursFromNow = (h) => new Date(Date.now() + h * 3600 * 1000);

// Tiện ích: lễ tân tạo 1 lớp group ở giờ xa (không đụng lịch seed)
async function createClass(staffToken, { hour, capacity = 5, name = "Lop test" }) {
  const trainers = await call(S, "/schedule/trainers", { token: staffToken });
  const r = await call(S, "/schedule/classes", {
    method: "POST",
    token: staffToken,
    body: {
      name,
      coachId: trainers.data.trainers[0].id,
      startAt: hoursFromNow(hour),
      endAt: hoursFromNow(hour + 1),
      capacity,
    },
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data.class;
}

before(async () => {
  // Seed lại DB riêng của suite này để mỗi lần chạy đều sạch
  const seeded = spawnSync(process.execPath, ["src/scripts/seed.js"], {
    cwd: ROOT,
    env: { ...process.env, MONGODB_URI: URI },
    stdio: "ignore",
  });
  assert.equal(seeded.status, 0, "seed her_test_c thất bại");

  proc = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: "4111", MONGODB_URI: URI, JWT_SECRET: SECRET, MIN_CANCEL_HOURS: "3" },
    stdio: "ignore",
  });
  await waitHealthy(S);
  await mongoose.connect(URI);
});

after(async () => {
  proc?.kill();
  await mongoose.disconnect();
});

// ---------- L1: async error không crash / không treo ----------

test("L1: ObjectId sai kiểu -> 400 JSON rõ ràng, không crash, không treo", async () => {
  const customer = await login("0909090909");
  const staff = await login("0900000000");

  const del = await call(S, "/bookings/khong-phai-id", { method: "DELETE", token: customer.token });
  assert.equal(del.status, 400);
  assert.match(del.data.error, /không hợp lệ/);

  const cust = await call(S, "/management/customers/abc/bookings", { token: staff.token });
  assert.equal(cust.status, 400);

  // Server vẫn sống
  const health = await call(S, "/health");
  assert.equal(health.status, 200);
});

test("L1: POST /bookings với classId rác -> lỗi thân thiện và KHÔNG bị trừ buổi", async () => {
  const customer = await login("0909090909");
  const before = (await call(S, "/me/package", { token: customer.token })).data.package.usedSessions;

  const r = await call(S, "/bookings", { method: "POST", token: customer.token, body: { type: "group", classId: "xyz" } });
  assert.equal(r.status, 404);

  const after = (await call(S, "/me/package", { token: customer.token })).data.package.usedSessions;
  assert.equal(after, before, "thất bại giữa chừng không được để mất buổi của khách");
});

test("L1: bắn loạt request dữ liệu rác qua nhiều route — server sống, login vẫn hoạt động", async () => {
  const customer = await login("0909090909");
  const staff = await login("0900000000");
  const garbage = [
    () => call(S, "/bookings", { method: "POST", token: customer.token, body: { type: "pt", slotId: 12345 } }),
    () => call(S, "/bookings/[object]", { method: "DELETE", token: customer.token }),
    () => call(S, "/schedule/classes?from=khong-phai-ngay", { token: staff.token }),
    () => call(S, "/schedule/classes/abc", { method: "PATCH", token: staff.token, body: { startAt: "xyz" } }),
    () => call(S, "/accounts/abc", { method: "PATCH", token: staff.token, body: { isActive: false } }),
    () => call(S, "/management/classes/xyz/roster", { token: staff.token }),
  ];
  for (const fire of garbage) {
    const r = await fire();
    assert.ok((r.status >= 400 && r.status < 500) || r.status === 200, `phải trả 2xx/4xx thân thiện, nhận ${r.status}: ${JSON.stringify(r.data)}`);
    assert.ok(r.data !== null, "phải trả JSON, không được treo/đóng kết nối");
  }
  await login("0909090909"); // server vẫn đăng nhập được bình thường
});

// ---------- L2: race condition ----------

test("L2: 2 khách giành 1 chỗ cuối cùng lúc -> đúng 1 người thắng, lớp không vượt sức chứa", async () => {
  const staff = await login("0900000000");
  const c1 = await login("0909090909");
  const c2 = await login("0912345678");
  const cls = await createClass(staff.token, { hour: 200, capacity: 1, name: "Race 1 cho" });

  const used = async (token) => (await call(S, "/me/package", { token })).data.package.usedSessions;
  const [u1Before, u2Before] = [await used(c1.token), await used(c2.token)];

  const [r1, r2] = await Promise.all([
    call(S, "/bookings", { method: "POST", token: c1.token, body: { type: "group", classId: cls._id } }),
    call(S, "/bookings", { method: "POST", token: c2.token, body: { type: "group", classId: cls._id } }),
  ]);
  const statuses = [r1.status, r2.status].sort();
  assert.deepEqual(statuses, [201, 400], `phải đúng 1 thắng 1 thua, nhận ${JSON.stringify([r1, r2])}`);

  const dbClass = await GymClass.findById(cls._id);
  assert.equal(dbClass.bookedCount, 1, "bookedCount phải đúng 1 — trước đây race làm thành 2");
  const count = await Booking.countDocuments({ classId: cls._id, status: "booked" });
  assert.equal(count, 1);

  // Người THUA phải được hoàn buổi đã trừ tạm — tổng số buổi bị trừ của cả 2 người đúng bằng 1
  const [u1After, u2After] = [await used(c1.token), await used(c2.token)];
  assert.equal(u1After - u1Before + (u2After - u2Before), 1, "người thua race không được mất buổi");
});

test("L2: 2 khách giành 1 PT slot cùng lúc -> đúng 1 người được", async () => {
  const staff = await login("0900000000");
  const c1 = await login("0909090909");
  const c2 = await login("0912345678");
  const trainers = await call(S, "/schedule/trainers", { token: staff.token });
  const slotRes = await call(S, "/schedule/pt-slots", {
    method: "POST",
    token: staff.token,
    body: { trainerId: trainers.data.trainers[0].id, startAt: hoursFromNow(205), endAt: hoursFromNow(206) },
  });
  const slotId = slotRes.data.slot._id;

  const [r1, r2] = await Promise.all([
    call(S, "/bookings", { method: "POST", token: c1.token, body: { type: "pt", slotId } }),
    call(S, "/bookings", { method: "POST", token: c2.token, body: { type: "pt", slotId } }),
  ]);
  assert.deepEqual([r1.status, r2.status].sort(), [201, 400]);

  const slot = await PTSlot.findById(slotId);
  assert.equal(slot.isBooked, true);
  assert.equal(await Booking.countDocuments({ slotId, status: "booked" }), 1);
});

test("L2: bấm đúp — 8 request giống hệt song song -> 1 booking, trừ đúng 1 buổi", async () => {
  const staff = await login("0900000000");
  const c1 = await login("0909090909");
  const cls = await createClass(staff.token, { hour: 210, capacity: 10, name: "Race double tap" });

  const pkgBefore = (await call(S, "/me/package", { token: c1.token })).data.package;

  const results = await Promise.all(
    Array.from({ length: 8 }, () =>
      call(S, "/bookings", { method: "POST", token: c1.token, body: { type: "group", classId: cls._id } })
    )
  );
  const wins = results.filter((r) => r.status === 201);
  assert.equal(wins.length, 1, `phải đúng 1 thành công, nhận ${results.map((r) => r.status)}`);

  assert.equal(await Booking.countDocuments({ classId: cls._id, status: "booked" }), 1);
  const dbClass = await GymClass.findById(cls._id);
  assert.equal(dbClass.bookedCount, 1, "các lượt thua phải trả lại chỗ đã giành tạm");

  const pkgAfter = (await call(S, "/me/package", { token: c1.token })).data.package;
  assert.equal(pkgAfter.usedSessions, pkgBefore.usedSessions + 1, "chỉ được trừ đúng 1 buổi dù bấm 8 lần");
});

test("L2: gói còn đúng 1 buổi, đặt 2 lớp khác nhau song song -> chỉ 1 thành công, không trừ quá", async () => {
  const staff = await login("0900000000");
  const c2 = await login("0912345678");
  const clsA = await createClass(staff.token, { hour: 220, name: "Race buoi cuoi A" });
  const clsB = await createClass(staff.token, { hour: 225, name: "Race buoi cuoi B" });

  // Ép gói của Thảo Vy còn đúng 1 buổi
  const pkg = await Package.findOne({ userId: (await mongoose.connection.db.collection("users").findOne({ phone: "0912345678" }))._id });
  await Package.updateOne({ _id: pkg._id }, { $set: { usedSessions: pkg.totalSessions - 1 } });

  const [r1, r2] = await Promise.all([
    call(S, "/bookings", { method: "POST", token: c2.token, body: { type: "group", classId: clsA._id } }),
    call(S, "/bookings", { method: "POST", token: c2.token, body: { type: "group", classId: clsB._id } }),
  ]);
  assert.deepEqual([r1.status, r2.status].sort(), [201, 400], JSON.stringify([r1.data, r2.data]));

  const pkgAfter = await Package.findById(pkg._id);
  assert.equal(pkgAfter.usedSessions, pkgAfter.totalSessions, "usedSessions không được vượt totalSessions");
});

// ---------- L3: hoàn buổi về đúng gói ----------

test("L3: khách có 2 gói — hủy hoàn về ĐÚNG gói đã trừ, gói kia không đổi", async () => {
  const staff = await login("0900000000");
  const c1 = await login("0909090909");
  const cls = await createClass(staff.token, { hour: 230, name: "Refund dung goi" });

  const userId = (await mongoose.connection.db.collection("users").findOne({ phone: "0909090909" }))._id;
  const pkgOld = await Package.findOne({ userId }); // gói seed (hạn +60 ngày)
  // Gói mới hạn xa hơn -> hệ thống sẽ trừ gói này khi đặt
  const pkgNew = await Package.create({
    userId,
    name: "Goi moi han xa",
    price: 1000000,
    totalSessions: 10,
    usedSessions: 0,
    activatedAt: new Date(),
    expiresAt: hoursFromNow(24 * 90),
  });
  const oldUsedBefore = pkgOld.usedSessions;

  const booked = await call(S, "/bookings", { method: "POST", token: c1.token, body: { type: "group", classId: cls._id } });
  assert.equal(booked.status, 201);

  const bookingDoc = await Booking.findById(booked.data.booking.id);
  assert.equal(bookingDoc.packageId.toString(), pkgNew._id.toString(), "booking phải ghi lại gói đã trừ");
  assert.equal((await Package.findById(pkgNew._id)).usedSessions, 1);

  const cancel = await call(S, `/bookings/${booked.data.booking.id}`, { method: "DELETE", token: c1.token });
  assert.equal(cancel.status, 200);

  assert.equal((await Package.findById(pkgNew._id)).usedSessions, 0, "buổi phải hoàn về gói ĐÃ trừ");
  assert.equal((await Package.findById(pkgOld._id)).usedSessions, oldUsedBefore, "gói kia không được đụng vào");
});

test("L3: lễ tân hủy hộ — vẫn hoàn về đúng gói ghi trên booking", async () => {
  const staff = await login("0900000000");
  const c1 = await login("0909090909");
  const cls = await createClass(staff.token, { hour: 235, name: "Staff refund dung goi" });

  const booked = await call(S, "/bookings", { method: "POST", token: c1.token, body: { type: "group", classId: cls._id } });
  assert.equal(booked.status, 201);
  const bookingDoc = await Booking.findById(booked.data.booking.id);
  const usedBefore = (await Package.findById(bookingDoc.packageId)).usedSessions;

  const cancel = await call(S, `/bookings/${booked.data.booking.id}`, { method: "DELETE", token: staff.token });
  assert.equal(cancel.status, 200);
  assert.equal(
    (await Package.findById(bookingDoc.packageId)).usedSessions,
    usedBefore - 1,
    "lễ tân hủy cũng phải hoàn đúng gói, không theo 'gói mới nhất'"
  );
});

test("L2+L3: hủy 2 lần song song cùng 1 booking -> chỉ hoàn buổi và trả chỗ 1 lần", async () => {
  const staff = await login("0900000000");
  const c1 = await login("0909090909");
  const cls = await createClass(staff.token, { hour: 240, name: "Double cancel" });

  const booked = await call(S, "/bookings", { method: "POST", token: c1.token, body: { type: "group", classId: cls._id } });
  assert.equal(booked.status, 201);
  const bookingDoc = await Booking.findById(booked.data.booking.id);
  const usedAfterBook = (await Package.findById(bookingDoc.packageId)).usedSessions;

  const [r1, r2] = await Promise.all([
    call(S, `/bookings/${booked.data.booking.id}`, { method: "DELETE", token: c1.token }),
    call(S, `/bookings/${booked.data.booking.id}`, { method: "DELETE", token: c1.token }),
  ]);
  assert.deepEqual([r1.status, r2.status].sort(), [200, 400], "chỉ 1 lần hủy có hiệu lực");

  assert.equal((await Package.findById(bookingDoc.packageId)).usedSessions, usedAfterBook - 1, "buổi chỉ hoàn 1 lần");
  assert.equal((await GymClass.findById(cls._id)).bookedCount, 0, "chỗ chỉ trả 1 lần, không âm");
});

test("L3: booking cũ không có packageId — fallback gói mới nhất, không crash, chỗ không âm", async () => {
  const staff = await login("0900000000");
  const userId = (await mongoose.connection.db.collection("users").findOne({ phone: "0912345678" }))._id;
  const cls = await createClass(staff.token, { hour: 245, name: "Legacy booking" });

  const pkg = await Package.findOne({ userId }).sort({ expiresAt: -1 });
  await Package.updateOne({ _id: pkg._id }, { $set: { usedSessions: 5 } });

  // Booking "đời cũ" ghi thẳng vào DB: không có packageId, và chỗ chưa từng được giành
  const legacy = await Booking.create({
    userId,
    type: "group",
    classId: cls._id,
    trainerId: cls.coachId,
    title: cls.name,
    startAt: cls.startAt,
    endAt: cls.endAt,
    packageId: null,
  });

  const cancel = await call(S, `/bookings/${legacy._id}`, { method: "DELETE", token: staff.token });
  assert.equal(cancel.status, 200);
  assert.equal((await Package.findById(pkg._id)).usedSessions, 4, "fallback hoàn về gói mới nhất như hành vi cũ");
  assert.equal((await GymClass.findById(cls._id)).bookedCount, 0, "guard không cho bookedCount âm");
});

test("L3: hủy PT booking — slot mở lại cho người khác, buổi hoàn đúng gói", async () => {
  const staff = await login("0900000000");
  const c1 = await login("0909090909");
  const trainers = await call(S, "/schedule/trainers", { token: staff.token });
  const slotRes = await call(S, "/schedule/pt-slots", {
    method: "POST",
    token: staff.token,
    body: { trainerId: trainers.data.trainers[0].id, startAt: hoursFromNow(255), endAt: hoursFromNow(256) },
  });
  const slotId = slotRes.data.slot._id;

  const booked = await call(S, "/bookings", { method: "POST", token: c1.token, body: { type: "pt", slotId } });
  assert.equal(booked.status, 201, JSON.stringify(booked.data));
  const bookingDoc = await Booking.findById(booked.data.booking.id);
  const usedAfterBook = (await Package.findById(bookingDoc.packageId)).usedSessions;
  assert.equal((await PTSlot.findById(slotId)).isBooked, true);

  const cancel = await call(S, `/bookings/${booked.data.booking.id}`, { method: "DELETE", token: c1.token });
  assert.equal(cancel.status, 200);
  assert.equal((await PTSlot.findById(slotId)).isBooked, false, "slot phải mở lại cho người khác đặt");
  assert.equal((await Package.findById(bookingDoc.packageId)).usedSessions, usedAfterBook - 1);
});

test("L2: mọi gói đều hết hạn -> không đặt được, báo đúng lý do", async () => {
  const staff = await login("0900000000");
  const c2 = await login("0912345678");
  const cls = await createClass(staff.token, { hour: 258, name: "Het han goi" });
  const userId = (await mongoose.connection.db.collection("users").findOne({ phone: "0912345678" }))._id;

  await Package.updateMany({ userId }, { $set: { expiresAt: hoursFromNow(-24) } });
  const r = await call(S, "/bookings", { method: "POST", token: c2.token, body: { type: "group", classId: cls._id } });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /chưa có gói tập còn hiệu lực/);
  await Package.updateMany({ userId }, { $set: { expiresAt: hoursFromNow(24 * 25) } }); // trả lại hạn cho test sau
});

test("Review T4: gọi thẳng API đặt lớp/slot đã qua giờ -> 400, không mất buổi", async () => {
  const c1 = await login("0909090909");
  const before = (await call(S, "/me/package", { token: c1.token })).data.package.usedSessions;

  // Lớp quá khứ không tạo được qua API (đã chặn) — chèn thẳng DB để mô phỏng dữ liệu cũ
  const trainerDoc = await mongoose.connection.db.collection("trainers").findOne({});
  const pastClass = await GymClass.create({
    name: "Lop da qua",
    coachId: trainerDoc._id,
    startAt: hoursFromNow(-5),
    endAt: hoursFromNow(-4),
    capacity: 8,
  });
  const r = await call(S, "/bookings", { method: "POST", token: c1.token, body: { type: "group", classId: pastClass._id } });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /đã qua/);

  const after = (await call(S, "/me/package", { token: c1.token })).data.package.usedSessions;
  assert.equal(after, before, "thử đặt lớp quá khứ không được làm mất buổi");
});

// ---------- Hồi quy ----------

test("Hồi quy: đặt rồi hủy tuần tự vẫn chuẩn — số buổi và chỗ quay về như cũ", async () => {
  const staff = await login("0900000000");
  const c2 = await login("0912345678");
  const cls = await createClass(staff.token, { hour: 250, name: "Regression flow" });

  // Nới gói của Thảo Vy lại (các test trước đã ép hết buổi)
  const userId = (await mongoose.connection.db.collection("users").findOne({ phone: "0912345678" }))._id;
  await Package.updateOne({ userId }, { $set: { usedSessions: 1 } });

  const before = (await call(S, "/me/package", { token: c2.token })).data.package.usedSessions;
  const booked = await call(S, "/bookings", { method: "POST", token: c2.token, body: { type: "group", classId: cls._id } });
  assert.equal(booked.status, 201);
  assert.equal((await call(S, "/me/package", { token: c2.token })).data.package.usedSessions, before + 1);

  const cancel = await call(S, `/bookings/${booked.data.booking.id}`, { method: "DELETE", token: c2.token });
  assert.equal(cancel.status, 200);
  assert.equal((await call(S, "/me/package", { token: c2.token })).data.package.usedSessions, before);
  assert.equal((await GymClass.findById(cls._id)).bookedCount, 0);
});
