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
const Package = require("../src/models/Package");

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
  // her-19: suite này test các bất biến CŨ với coach bất kỳ — gỡ ràng buộc chuyên môn của
  // seed (specialties rỗng = hồ sơ cũ, được phép dạy mọi lớp); luật chuyên môn có test riêng.
  await mongoose.connection.db.collection("trainers").updateMany({}, { $set: { specialties: [] } });
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
    trainerId: trainerDoc._id,
    title: "Sweep test",
    // her-35: booking mang snapshot bộ môn + loại hình
    serviceType: "pilates",
    format: "1:4",
  };
  // Mỗi booking một classId riêng — unique partial index (userId+classId, status booked)
  // chặn 2 booking cùng khoá, kể cả khi chèn thẳng DB (đúng thiết kế).
  // Tạo lớp MỚI thay vì lấy lớp seed (khách có thể đã có booking trên lớp seed).
  const classes = await GymClass.create(
    [-3, -6, 50].map((h) => ({
      name: `Sweep class ${h}`,
      serviceType: "pilates",
      format: "1:4",
      coachId: trainerDoc._id,
      startAt: hoursFromNow(h),
      endAt: hoursFromNow(h + 1),
      capacity: 4,
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

// ---------- L7: chặn sửa lớp có khách (cập nhật 16/08/2026: ĐỔI HLV thì được — her-09) ----------

test("L7: lớp có khách đặt — chặn đổi giờ/tên/loại hình, ĐỔI HLV ĐƯỢC (16/08)", async () => {
  const reception = await login("0900000000");
  const customer = await login("0909090909");
  const trainers = (await call(S, "/schedule/trainers", { token: reception.token })).data.trainers;

  // Gói khớp (bộ môn pilates + loại hình 1:2) cho khách — không phụ thuộc gói của seed
  const customerId = (await mongoose.connection.db.collection("users").findOne({ phone: "0909090909" }))._id;
  await Package.create({
    userId: customerId, name: "Pilates 1:2 test L7", serviceTypes: ["pilates"], format: "1:2",
    price: 1, totalSessions: 10, activatedAt: new Date(), expiresAt: hoursFromNow(24 * 60),
  });

  const created = await call(S, "/schedule/classes", {
    method: "POST",
    token: reception.token,
    // her-35: sức chứa KHÔNG nhận từ client — capacity gửi kèm bị bỏ qua, luôn theo loại hình
    body: { name: "Lop co khach", serviceType: "pilates", format: "1:2", coachId: trainers[0].id, startAt: hoursFromNow(280), endAt: hoursFromNow(281), capacity: 99 },
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const cls = created.data.class;
  assert.equal(cls.capacity, 2, "sức chứa phải theo loại hình 1:2, không nghe client");
  const booked = await call(S, "/bookings", { method: "POST", token: customer.token, body: { classId: cls._id } });
  assert.equal(booked.status, 201, JSON.stringify(booked.data));

  for (const body of [
    { startAt: hoursFromNow(290), endAt: hoursFromNow(291) },
    { name: "Ten moi" },
  ]) {
    const r = await call(S, `/schedule/classes/${cls._id}`, { method: "PATCH", token: reception.token, body });
    assert.equal(r.status, 400, `phải chặn sửa ${JSON.stringify(body)}`);
    assert.match(r.data.error, /đã có .* khách đặt/);
  }
  const db = await GymClass.findById(cls._id);
  assert.equal(db.name, "Lop co khach", "dữ liệu không được đổi");

  // Quyết định 16/08 (góp ý khách hàng): ĐỔI HLV lớp đã có khách thì ĐƯỢC — booking đi theo
  const swap = await call(S, `/schedule/classes/${cls._id}`, {
    method: "PATCH", token: reception.token, body: { coachId: trainers[1].id },
  });
  assert.equal(swap.status, 200, JSON.stringify(swap.data));
  const bk = await Booking.findOne({ classId: cls._id, status: "booked" });
  assert.equal(bk.trainerId.toString(), trainers[1].id, "booking của khách phải theo HLV mới");

  // her-35: đổi LOẠI HÌNH kéo theo đổi sức chứa -> lớp đã có khách thì cấm
  const changeFormat = await call(S, `/schedule/classes/${cls._id}`, { method: "PATCH", token: reception.token, body: { format: "1:4" } });
  assert.equal(changeFormat.status, 400, "đổi loại hình lớp đã có khách phải bị chặn");
  assert.match(changeFormat.data.error, /loại hình/i);
  assert.equal((await GymClass.findById(cls._id)).capacity, 2, "sức chứa không được đổi");

  // Lớp CHƯA có khách vẫn sửa giờ bình thường
  const free = await call(S, "/schedule/classes", {
    method: "POST",
    token: reception.token,
    body: { name: "Lop trong", serviceType: "pilates", format: "1:2", coachId: trainers[0].id, startAt: hoursFromNow(282), endAt: hoursFromNow(283) },
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

  // Buổi sắp tới của Linh (mọi buổi đều là lớp — her-35)
  const linhClass = await GymClass.findOne({ coachId: linhTrainerId, startAt: { $gt: hoursFromNow(24) } });
  assert.ok(linhClass, "seed phải có buổi sắp tới của HLV Linh");

  await call(S, `/accounts/${linhAcc.id}`, { method: "PATCH", token: admin.token, body: { isActive: false } });
  try {
    // Buổi của Linh biến mất khỏi /api/classes
    const classList = await call(S, "/classes", { token: customer.token });
    assert.ok(
      !classList.data.classes.some((c) => String(c.id) === String(linhClass._id)),
      "buổi của HLV khoá không được hiện cho khách"
    );

    // Đặt thẳng bằng classId của Linh (tải trước lúc khoá) -> 400, không trừ buổi
    const before = (await call(S, "/me/package", { token: customer.token })).data.package?.usedSessions ?? null;
    const bookClass = await call(S, "/bookings", {
      method: "POST",
      token: customer.token,
      body: { classId: linhClass._id },
    });
    assert.equal(bookClass.status, 400, JSON.stringify(bookClass.data));
    assert.match(bookClass.data.error, /tạm ngưng hoạt động/);
    assert.equal(
      (await call(S, "/me/package", { token: customer.token })).data.package?.usedSessions ?? null,
      before,
      "đặt hụt không được trừ buổi"
    );

    // Lễ tân xếp buổi MỚI cho Linh -> 400
    const reception = await login("0900000000");
    const newClass = await call(S, "/schedule/classes", {
      method: "POST",
      token: reception.token,
      body: { serviceType: "pilates", format: "1:1", coachId: linhTrainerId, startAt: hoursFromNow(200), endAt: hoursFromNow(201) },
    });
    assert.equal(newClass.status, 400, JSON.stringify(newClass.data));
    assert.match(newClass.data.error, /bị khoá tài khoản/);
  } finally {
    await call(S, `/accounts/${linhAcc.id}`, { method: "PATCH", token: admin.token, body: { isActive: true } });
  }
});

test("Review: không hủy được booking đã 'Đã tập' (sweep xong thì chốt)", async () => {
  const reception = await login("0900000000");
  const customerId = (await mongoose.connection.db.collection("users").findOne({ phone: "0909090909" }))._id;
  const trainerDoc = await mongoose.connection.db.collection("trainers").findOne({});
  // her-35: booking bắt buộc có classId — dựng luôn lớp quá khứ tương ứng
  const doneClass = await GymClass.create({
    name: "Da tap xong", serviceType: "pilates", format: "1:1", coachId: trainerDoc._id,
    startAt: hoursFromNow(-4), endAt: hoursFromNow(-3), capacity: 1, bookedCount: 1,
  });
  const done = await Booking.create({
    userId: customerId,
    classId: doneClass._id,
    trainerId: trainerDoc._id,
    title: "Da tap xong",
    serviceType: "pilates",
    format: "1:1",
    startAt: hoursFromNow(-4),
    endAt: hoursFromNow(-3),
    status: "completed",
  });
  const r = await call(S, `/bookings/${done._id}`, { method: "DELETE", token: reception.token });
  assert.equal(r.status, 400);
  await Booking.deleteOne({ _id: done._id });
  await GymClass.deleteOne({ _id: doneClass._id });
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
