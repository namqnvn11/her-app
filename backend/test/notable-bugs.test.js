// Test cho đợt sửa lỗi đáng chú ý L4–L8 — xem docs-her/testcase/testcase_her-03_notable_bugs_L4_L8.md
// Chạy: npm test — suite này dùng DB riêng her_test_d (tự seed), server cổng 4121;
// case sweep-lúc-boot dựng thêm 1 server tạm ở cổng 4122 trên cùng DB.

const { test, before, after } = require("node:test");
const assert = require("node:assert");
const { spawn, spawnSync } = require("node:child_process");
const path = require("node:path");
const mongoose = require("mongoose");

const ROOT = path.join(__dirname, "..");
const URI = "mongodb://localhost:27017/her_test_d";
const S = "http://localhost:4121/api";
const SECRET = "testsecret";

const Booking = require("../src/models/Booking");
const GymClass = require("../src/models/GymClass");

let proc;

function startServer(port) {
  return spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), MONGODB_URI: URI, JWT_SECRET: SECRET, MIN_CANCEL_HOURS: "3" },
    stdio: "ignore",
  });
}

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

before(async () => {
  const seeded = spawnSync(process.execPath, ["src/scripts/seed.js"], {
    cwd: ROOT,
    env: { ...process.env, MONGODB_URI: URI },
    stdio: "ignore",
  });
  assert.equal(seeded.status, 0, "seed her_test_d thất bại");
  proc = startServer(4121);
  await waitHealthy(S);
  await mongoose.connect(URI);
});

after(async () => {
  proc?.kill();
  await mongoose.disconnect();
});

// ---------- L4: admin quản lý được học viên ----------

test("L4: admin xem/tạo/khoá được tài khoản học viên", async () => {
  const admin = await login("0999999999");

  const list = await call(S, "/accounts?role=customer", { token: admin.token });
  assert.equal(list.status, 200);
  assert.ok(list.data.accounts.some((a) => a.phone === "0909090909"), "admin phải thấy học viên");

  const created = await call(S, "/accounts", {
    method: "POST",
    token: admin.token,
    body: { name: "Khach do admin tao", phone: "0922222222", password: "matkhau6", role: "customer" },
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));

  const locked = await call(S, `/accounts/${created.data.account.id}`, {
    method: "PATCH",
    token: admin.token,
    body: { isActive: false },
  });
  assert.equal(locked.status, 200);
  assert.equal(locked.data.account.isActive, false);
});

test("L4: quyền lễ tân KHÔNG đổi — vẫn không đụng được tài khoản lễ tân/HLV", async () => {
  const reception = await login("0900000000");
  const admin = await login("0999999999");

  const trainerAcc = (await call(S, "/accounts?role=trainer", { token: admin.token })).data.accounts[0];
  const r = await call(S, `/accounts/${trainerAcc.id}`, {
    method: "PATCH",
    token: reception.token,
    body: { name: "Hack" },
  });
  assert.equal(r.status, 403, "lễ tân sửa tài khoản HLV phải bị chặn như cũ");
});

// ---------- L5: bỏ xoá, khoá HLV ẩn khỏi danh sách ----------

test("L5: endpoint xoá tài khoản trả 410 với hướng dẫn dùng nút Khoá", async () => {
  const admin = await login("0999999999");
  const anyCustomer = (await call(S, "/accounts?role=customer", { token: admin.token })).data.accounts[0];
  const r = await call(S, `/accounts/${anyCustomer.id}`, { method: "DELETE", token: admin.token });
  assert.equal(r.status, 410);
  assert.match(r.data.error, /thay bằng khoá/);
});

test("L5: khoá tài khoản HLV -> ẩn khỏi danh sách đặt lịch & xếp lịch; HLV không có tài khoản vẫn hiện", async () => {
  const admin = await login("0999999999");
  const customer = await login("0909090909");
  const linhAcc = (await call(S, "/accounts?role=trainer", { token: admin.token })).data.accounts.find(
    (a) => a.phone === "0911111111"
  );

  // Khoá HLV Linh
  await call(S, `/accounts/${linhAcc.id}`, { method: "PATCH", token: admin.token, body: { isActive: false } });

  const bookingList = await call(S, "/trainers", { token: customer.token });
  const names = bookingList.data.trainers.map((t) => t.name);
  assert.ok(!names.includes("HLV Linh"), "HLV bị khoá không được hiện cho khách đặt");
  assert.ok(names.includes("HLV Đức") && names.includes("HLV Thu"), "HLV chưa có tài khoản vẫn hiện");

  const scheduleList = await call(S, "/schedule/trainers", { token: admin.token });
  assert.ok(!scheduleList.data.trainers.map((t) => t.name).includes("HLV Linh"));

  // Mở khoá lại -> hiện lại
  await call(S, `/accounts/${linhAcc.id}`, { method: "PATCH", token: admin.token, body: { isActive: true } });
  const again = await call(S, "/trainers", { token: customer.token });
  assert.ok(again.data.trainers.map((t) => t.name).includes("HLV Linh"), "mở khoá phải hiện lại");
});

// ---------- L6: job nền chuyển "Đã tập" ----------

test("L6: sweep lúc boot chuyển booking qua giờ thành completed, không đụng booking hủy/tương lai", async () => {
  const customerId = (await mongoose.connection.db.collection("users").findOne({ phone: "0909090909" }))._id;
  const trainerDoc = await mongoose.connection.db.collection("trainers").findOne({});

  const base = {
    userId: customerId,
    type: "group",
    trainerId: trainerDoc._id,
    title: "Sweep test",
  };
  // Mỗi booking một classId riêng — unique partial index (userId+classId, status booked)
  // chặn 2 booking cùng khoá, kể cả khi chèn thẳng DB (đúng thiết kế).
  // Tạo lớp MỚI thay vì lấy lớp seed (khách có thể đã có booking trên lớp seed).
  const classes = await GymClass.create(
    [-3, -6, 50].map((h) => ({
      name: `Sweep class ${h}`,
      coachId: trainerDoc._id,
      startAt: hoursFromNow(h),
      endAt: hoursFromNow(h + 1),
      capacity: 8,
    }))
  );
  const pastBooked = await Booking.create({ ...base, classId: classes[0]._id, startAt: hoursFromNow(-3), endAt: hoursFromNow(-2), status: "booked" });
  const pastCancelled = await Booking.create({ ...base, classId: classes[1]._id, startAt: hoursFromNow(-6), endAt: hoursFromNow(-5), status: "cancelled" });
  const futureBooked = await Booking.create({ ...base, classId: classes[2]._id, startAt: hoursFromNow(50), endAt: hoursFromNow(51), status: "booked" });

  // Dựng server tạm thứ hai trên cùng DB — sweep chạy ngay lúc khởi động
  const proc2 = startServer(4122);
  try {
    await waitHealthy("http://localhost:4122/api");
    // Chờ tối đa 5s cho sweep lúc boot ghi xong
    let swept;
    for (let i = 0; i < 10; i++) {
      swept = await Booking.findById(pastBooked._id);
      if (swept.status === "completed") break;
      await new Promise((r) => setTimeout(r, 500));
    }
    assert.equal(swept.status, "completed", "buổi booked đã qua giờ phải tự thành 'Đã tập'");
    assert.equal((await Booking.findById(pastCancelled._id)).status, "cancelled", "buổi đã hủy giữ nguyên");
    assert.equal((await Booking.findById(futureBooked._id)).status, "booked", "buổi tương lai giữ nguyên");
  } finally {
    proc2.kill();
    await Booking.deleteMany({ title: "Sweep test" });
    await GymClass.deleteMany({ name: /^Sweep class/ });
  }
});

// ---------- L7: chặn sửa lớp có khách ----------

test("L7: lớp có khách đặt — chặn đổi giờ/HLV/tên, vẫn cho tăng sức chứa", async () => {
  const reception = await login("0900000000");
  const customer = await login("0909090909");
  const trainers = (await call(S, "/schedule/trainers", { token: reception.token })).data.trainers;

  const created = await call(S, "/schedule/classes", {
    method: "POST",
    token: reception.token,
    body: { name: "Lop co khach", coachId: trainers[0].id, startAt: hoursFromNow(280), endAt: hoursFromNow(281), capacity: 5 },
  });
  const cls = created.data.class;
  const booked = await call(S, "/bookings", { method: "POST", token: customer.token, body: { type: "group", classId: cls._id } });
  assert.equal(booked.status, 201, JSON.stringify(booked.data));

  for (const body of [
    { startAt: hoursFromNow(290), endAt: hoursFromNow(291) },
    { coachId: trainers[1].id },
    { name: "Ten moi" },
  ]) {
    const r = await call(S, `/schedule/classes/${cls._id}`, { method: "PATCH", token: reception.token, body });
    assert.equal(r.status, 400, `phải chặn sửa ${JSON.stringify(body)}`);
    assert.match(r.data.error, /đã có .* khách đặt/);
  }
  const db = await GymClass.findById(cls._id);
  assert.equal(db.name, "Lop co khach", "dữ liệu không được đổi");

  const capUp = await call(S, `/schedule/classes/${cls._id}`, { method: "PATCH", token: reception.token, body: { capacity: 8 } });
  assert.equal(capUp.status, 200, "tăng sức chứa vẫn phải được phép");
  assert.equal(capUp.data.class.capacity, 8);

  // Lớp CHƯA có khách vẫn sửa giờ bình thường
  const free = await call(S, "/schedule/classes", {
    method: "POST",
    token: reception.token,
    body: { name: "Lop trong", coachId: trainers[0].id, startAt: hoursFromNow(282), endAt: hoursFromNow(283) },
  });
  const move = await call(S, `/schedule/classes/${free.data.class._id}`, {
    method: "PATCH",
    token: reception.token,
    body: { startAt: hoursFromNow(284), endAt: hoursFromNow(285) },
  });
  assert.equal(move.status, 200);
});

// ---------- Các fix sau vòng review độc lập ----------

test("Review: không ai tạo/sửa được tài khoản role admin (chặn leo quyền)", async () => {
  const admin = await login("0999999999");
  const reception = await login("0900000000");

  for (const token of [admin.token, reception.token]) {
    const r = await call(S, "/accounts", {
      method: "POST",
      token,
      body: { name: "Admin lau", phone: "0966666666", password: "matkhau6", role: "admin" },
    });
    assert.equal(r.status, 403, "tạo tài khoản admin phải bị chặn với mọi role");
  }

  // Admin cũng không tự khoá được chính mình (target role=admin nằm ngoài ALLOWED_TO_MANAGE)
  const adminId = (await mongoose.connection.db.collection("users").findOne({ phone: "0999999999" }))._id;
  const selfLock = await call(S, `/accounts/${adminId}`, {
    method: "PATCH",
    token: admin.token,
    body: { isActive: false },
  });
  assert.equal(selfLock.status, 403, "không được tự khoá tài khoản admin");
});

test("Review: HLV bị khoá — server chặn MỌI đường đặt/xếp lịch, không chỉ ẩn danh sách", async () => {
  const admin = await login("0999999999");
  const customer = await login("0912345678");
  const linhAcc = (await call(S, "/accounts?role=trainer", { token: admin.token })).data.accounts.find(
    (a) => a.phone === "0911111111"
  );
  const linhTrainerId = linhAcc.trainerId;

  await call(S, `/accounts/${linhAcc.id}`, { method: "PATCH", token: admin.token, body: { isActive: false } });
  try {
    // Lớp Group của Linh biến mất khỏi /api/classes
    const classList = await call(S, "/classes", { token: customer.token });
    assert.ok(
      classList.data.classes.every((c) => String(c.coachId || "") !== String(linhTrainerId)),
      "lớp của HLV khoá không được hiện cho khách"
    );

    // Đặt thẳng bằng classId của lớp Linh (tải trước lúc khoá) -> 400, không trừ buổi
    const before = (await call(S, "/me/package", { token: customer.token })).data.package.usedSessions;
    const linhClass = await GymClass.findOne({ coachId: linhTrainerId, startAt: { $gt: hoursFromNow(24) } });
    const bookClass = await call(S, "/bookings", {
      method: "POST",
      token: customer.token,
      body: { type: "group", classId: linhClass._id },
    });
    assert.equal(bookClass.status, 400);
    assert.match(bookClass.data.error, /tạm ngưng hoạt động/);
    assert.equal((await call(S, "/me/package", { token: customer.token })).data.package.usedSessions, before);

    // Đặt thẳng bằng slotId của Linh -> 400
    const linhSlot = await mongoose.connection.db
      .collection("ptslots")
      .findOne({ trainerId: linhTrainerId ? new mongoose.Types.ObjectId(linhTrainerId) : null, isBooked: false, startAt: { $gt: hoursFromNow(24) } });
    const bookSlot = await call(S, "/bookings", {
      method: "POST",
      token: customer.token,
      body: { type: "pt", slotId: linhSlot._id },
    });
    assert.equal(bookSlot.status, 400);
    assert.match(bookSlot.data.error, /tạm ngưng hoạt động/);

    // Lễ tân xếp lịch MỚI cho Linh -> 400
    const reception = await login("0900000000");
    const newSlot = await call(S, "/schedule/pt-slots", {
      method: "POST",
      token: reception.token,
      body: { trainerId: linhTrainerId, startAt: hoursFromNow(200), endAt: hoursFromNow(201) },
    });
    assert.equal(newSlot.status, 400);
    assert.match(newSlot.data.error, /bị khoá tài khoản/);
  } finally {
    await call(S, `/accounts/${linhAcc.id}`, { method: "PATCH", token: admin.token, body: { isActive: true } });
  }
});

test("Review: không hủy được booking đã 'Đã tập' (sweep xong thì chốt)", async () => {
  const reception = await login("0900000000");
  const customerId = (await mongoose.connection.db.collection("users").findOne({ phone: "0909090909" }))._id;
  const trainerDoc = await mongoose.connection.db.collection("trainers").findOne({});
  const done = await Booking.create({
    userId: customerId,
    type: "group",
    trainerId: trainerDoc._id,
    title: "Da tap xong",
    startAt: hoursFromNow(-4),
    endAt: hoursFromNow(-3),
    status: "completed",
  });
  const r = await call(S, `/bookings/${done._id}`, { method: "DELETE", token: reception.token });
  assert.equal(r.status, 400);
  await Booking.deleteOne({ _id: done._id });
});

// ---------- Hồi quy ----------

test("H6: tài khoản bị khoá GIỮA PHIÊN — token đang sống lập tức bị chặn 403, mở khoá thì dùng lại được", async () => {
  const admin = await login("0999999999");
  const customer = await login("0912345678"); // token sống trước khi bị khoá
  const target = (await call(S, "/accounts?role=customer", { token: admin.token })).data.accounts.find(
    (a) => a.phone === "0912345678"
  );
  await call(S, `/accounts/${target.id}`, { method: "PATCH", token: admin.token, body: { isActive: false } });
  try {
    const blocked = await call(S, "/me", { token: customer.token });
    assert.equal(blocked.status, 403, "token cũ của tài khoản vừa bị khoá phải bị từ chối ngay");
    assert.match(blocked.data.error, /bị khoá/);
  } finally {
    await call(S, `/accounts/${target.id}`, { method: "PATCH", token: admin.token, body: { isActive: true } });
  }
  const ok = await call(S, "/me", { token: customer.token });
  assert.equal(ok.status, 200, "mở khoá xong token cũ dùng lại được (không cần login lại)");
});
