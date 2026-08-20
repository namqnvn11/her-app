// Test her-35 — Loại hình buổi tập (1:1/1:2/1:4/1:8) + quyền HLV tự mở lịch.
// Xem docs-her/testcase/testcase_her-35_format_mix.md
// DB riêng her_test_i (tự seed trong before, KHÔNG dùng scripts/seed.js), server cổng 4171.
// (Suite này thay cho pt-group.test.js đã xoá — dùng lại DB/cổng của suite cũ.)

const { test, before, after } = require("node:test");
const assert = require("node:assert");
const { spawn } = require("node:child_process");
const path = require("node:path");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const ROOT = path.join(__dirname, "..");
const URI = "mongodb://localhost:27017/her_test_i";
const S = "http://localhost:4171/api";

const Booking = require("../src/models/Booking");
const GymClass = require("../src/models/GymClass");
const Discipline = require("../src/models/Discipline");
const Trainer = require("../src/models/Trainer");
const User = require("../src/models/User");

let proc;
const tokens = {};
let linhTrainerId; // hồ sơ Trainer của HLV Linh (tài khoản 0911111111 đăng nhập được)
let otherTrainerId; // 1 HLV khác để test "không phải của mình"
let customerId; // khách dùng để tạo booking thẳng DB

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

// Mỗi lớp tạo mới lấy 1 khung giờ riêng — cùng 1 HLV không được trùng giờ
let hourCursor = 100;
const nextHour = () => (hourCursor += 3);

async function makeClass({
  format = "1:1",
  serviceType = "gym",
  coachId,
  token = tokens.staff,
  hoursAhead,
  extra,
} = {}) {
  const h = hoursAhead ?? nextHour();
  const body = {
    format,
    serviceType,
    coachId: (coachId || linhTrainerId).toString(),
    startAt: hoursFromNow(h),
    endAt: hoursFromNow(h + 1),
    ...(extra || {}),
  };
  const r = await call("/schedule/classes", { method: "POST", token, body });
  return { r, hour: h };
}

// Tạo lớp qua API rồi ép "đã có khách" ở tầng DB (đường đặt lịch thật thuộc suite khác)
async function makeBookedClass(opts = {}) {
  const { r } = await makeClass(opts);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const cls = await GymClass.findById(r.data.class._id || r.data.class.id);
  await GymClass.updateOne({ _id: cls._id }, { $set: { bookedCount: 1 } });
  await Booking.create({
    userId: customerId,
    classId: cls._id,
    trainerId: cls.coachId,
    title: cls.name,
    serviceType: cls.serviceType,
    format: cls.format,
    startAt: cls.startAt,
    endAt: cls.endAt,
  });
  return cls;
}

before(async () => {
  await mongoose.connect(URI);
  await mongoose.connection.dropDatabase();

  // Danh mục 5 bộ môn (her-35)
  await Discipline.create([
    { key: "gym", label: "Gym", order: 1 },
    { key: "boxing", label: "Boxing", order: 2 },
    { key: "stretching", label: "Stretching", order: 3 },
    { key: "pilates", label: "Pilates", order: 4 },
    { key: "yoga", label: "Yoga", order: 5 },
  ]);

  // HLV Linh dạy được cả gym/pilates/yoga -> tạo được đủ 4 loại hình (1:8 phải là yoga)
  const [linh, thu] = await Trainer.create([
    { name: "HLV Linh", specialty: "Pilates", specialties: ["gym", "pilates", "yoga"] },
    { name: "HLV Thu", specialty: "Yoga", specialties: ["gym", "pilates", "yoga"] },
  ]);
  linhTrainerId = linh._id;
  otherTrainerId = thu._id;

  const passwordHash = await bcrypt.hash("123456", 10);
  const admin = await User.create({ name: "Chủ phòng tập", phone: "0999999999", passwordHash, role: "admin" });
  await User.create({ name: "Lễ tân Mai", phone: "0900000000", passwordHash, role: "reception", createdBy: admin._id });
  await User.create({ name: linh.name, phone: "0911111111", passwordHash, role: "trainer", trainerId: linh._id });
  const cust = await User.create({ name: "Minh Anh", phone: "0909090909", passwordHash, role: "customer" });
  customerId = cust._id;

  await Booking.syncIndexes();

  proc = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: "4171", MONGODB_URI: URI, JWT_SECRET: "testsecret", MIN_CANCEL_HOURS: "3" },
    stdio: "ignore",
  });
  await waitHealthy(S);

  tokens.admin = (await login("0999999999")).token;
  tokens.staff = (await login("0900000000")).token;
  tokens.trainer = (await login("0911111111")).token; // HLV Linh
  tokens.customer = (await login("0909090909")).token;
});

after(async () => {
  proc?.kill();
  await mongoose.disconnect();
});

// ---------- 1. Quầy tạo đủ 4 loại hình, sức chứa server tự gán ----------

test("create-4-formats: quầy tạo 1:1/1:2/1:4/1:8 -> 201, capacity 1/2/4/8 do server gán", async () => {
  for (const [format, cap] of [["1:1", 1], ["1:2", 2], ["1:4", 4], ["1:8", 8]]) {
    const { r } = await makeClass({ format, serviceType: format === "1:8" ? "yoga" : "gym" });
    assert.equal(r.status, 201, `${format}: ${JSON.stringify(r.data)}`);
    assert.equal(r.data.class.format, format);
    assert.equal(r.data.class.capacity, cap, `${format} phải có sức chứa ${cap}`);
  }
});

// ---------- 2. capacity từ client bị BỎ QUA ----------

test("capacity-ignored: body kèm capacity 99 -> vẫn theo loại hình (không nhận từ client)", async () => {
  const { r } = await makeClass({ format: "1:4", serviceType: "gym", extra: { capacity: 99 } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.class.capacity, 4, "sức chứa cố định theo loại hình 1:4");
  assert.equal((await GymClass.findById(r.data.class._id)).capacity, 4);
});

// ---------- 3. Loại hình sai / thiếu ----------

test("format-invalid: '1:3' -> 400; thiếu format -> 400 nêu rõ Loại hình", async () => {
  const bad = await makeClass({ format: "1:3" });
  assert.equal(bad.r.status, 400, JSON.stringify(bad.r.data));
  assert.match(bad.r.data.error, /Loại hình/);

  const h = nextHour();
  const missing = await call("/schedule/classes", {
    method: "POST",
    token: tokens.staff,
    body: {
      serviceType: "gym",
      coachId: linhTrainerId.toString(),
      startAt: hoursFromNow(h),
      endAt: hoursFromNow(h + 1),
    },
  });
  assert.equal(missing.status, 400, JSON.stringify(missing.data));
  assert.match(missing.data.error, /Loại hình/);
});

// ---------- 4. Luật 1:8 chỉ dành cho Yoga ----------

test("format-18-yoga: 1:8 + bộ môn gym -> 400 nói rõ 1:8 chỉ dành cho Yoga", async () => {
  const { r } = await makeClass({ format: "1:8", serviceType: "gym" });
  assert.equal(r.status, 400, JSON.stringify(r.data));
  assert.match(r.data.error, /1:8.*[Yy]oga/);
});

// ---------- 4b. HLV nhận lớp: id rác + sai chuyên môn ----------

test("coach-invalid: coachId rác -> 404 'Không tìm thấy HLV', không treo request", async () => {
  const { r } = await makeClass({ coachId: "khong-phai-id", format: "1:2", serviceType: "gym" });
  assert.equal(r.status, 404, JSON.stringify(r.data));
  assert.match(r.data.error, /Không tìm thấy HLV/);
});

test("coach-specialty: giao lớp cho HLV không có chuyên môn bộ môn đó -> 400", async () => {
  // Cả 2 HLV seed chỉ có gym/pilates/yoga -> lớp Boxing phải bị chặn
  const { r } = await makeClass({ format: "1:2", serviceType: "boxing" });
  assert.equal(r.status, 400, JSON.stringify(r.data));
  assert.match(r.data.error, /chuyên môn/);
});

// ---------- 5. HLV tự mở buổi cho chính mình ----------

test("trainer-create: HLV mở 1:1 cho mình -> 201; 1:4 -> 403; mở hộ HLV khác -> 403", async () => {
  const own = await makeClass({ token: tokens.trainer, format: "1:1", serviceType: "pilates" });
  assert.equal(own.r.status, 201, JSON.stringify(own.r.data));
  assert.equal(own.r.data.class.coachId.toString(), linhTrainerId.toString());

  const big = await makeClass({ token: tokens.trainer, format: "1:4", serviceType: "pilates" });
  assert.equal(big.r.status, 403, JSON.stringify(big.r.data));
  assert.match(big.r.data.error, /1:1 hoặc 1:2/);

  const forOther = await makeClass({ token: tokens.trainer, coachId: otherTrainerId, format: "1:1" });
  assert.equal(forOther.r.status, 403, JSON.stringify(forOther.r.data));
  assert.match(forOther.r.data.error, /chính mình/);
});

// ---------- 6. Khách không xếp lịch ----------

test("customer-create: khách POST /schedule/classes -> 403; anon -> 401", async () => {
  assert.equal((await makeClass({ token: tokens.customer })).r.status, 403);
  assert.equal((await makeClass({ token: null })).r.status, 401);
});

// ---------- 7. HLV sửa buổi trống của mình ----------

test("trainer-patch: đổi giờ buổi 1:1 trống của mình -> 200; buổi của HLV khác -> 403", async () => {
  const { r } = await makeClass({ token: tokens.trainer, format: "1:1", serviceType: "pilates" });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const id = r.data.class._id;

  const h = nextHour();
  const moved = await call(`/schedule/classes/${id}`, {
    method: "PATCH",
    token: tokens.trainer,
    body: { startAt: hoursFromNow(h), endAt: hoursFromNow(h + 1) },
  });
  assert.equal(moved.status, 200, JSON.stringify(moved.data));
  assert.ok(Math.abs(new Date(moved.data.class.startAt) - hoursFromNow(h)) < 5000);

  // Buổi của HLV khác -> 403, kể cả khi HLV gửi kèm coachId của CHÍNH MÌNH để "chiếm" lớp
  const other = await makeClass({ coachId: otherTrainerId, format: "1:2", serviceType: "gym" });
  assert.equal(other.r.status, 201, JSON.stringify(other.r.data));
  const otherId = other.r.data.class._id;
  const h2 = nextHour();
  const steal = await call(`/schedule/classes/${otherId}`, {
    method: "PATCH",
    token: tokens.trainer,
    body: { coachId: linhTrainerId.toString(), startAt: hoursFromNow(h2), endAt: hoursFromNow(h2 + 1) },
  });
  assert.equal(steal.status, 403, JSON.stringify(steal.data));
  assert.equal((await GymClass.findById(otherId)).coachId.toString(), otherTrainerId.toString(), "không được đổi chủ lớp");
});

// ---------- 7b. HLV không nâng được loại hình buổi của mình ----------

test("trainer-patch-format: HLV đổi buổi 1:1 của mình sang 1:4 -> 403 (không leo thang loại hình)", async () => {
  const { r } = await makeClass({ token: tokens.trainer, format: "1:1", serviceType: "pilates" });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const up = await call(`/schedule/classes/${r.data.class._id}`, {
    method: "PATCH", token: tokens.trainer, body: { format: "1:4" },
  });
  assert.equal(up.status, 403, JSON.stringify(up.data));
  assert.match(up.data.error, /1:1 hoặc 1:2/);
  const db = await GymClass.findById(r.data.class._id);
  assert.equal(db.format, "1:1");
  assert.equal(db.capacity, 1, "sức chứa phải giữ nguyên");
});

// ---------- 7c. Buổi 1:4 CỦA CHÍNH HLV vẫn ngoài tầm tay HLV ----------

test("trainer-owns-14: buổi 1:4 do quầy xếp cho chính HLV -> HLV PATCH và DELETE đều 403", async () => {
  // Buổi 1:4 gán cho HLV Linh (quầy xếp) — HLV là người dạy nhưng loại hình ngoài 1:1/1:2
  const h = nextHour();
  const cls = await GymClass.create({
    name: "Gym", serviceType: "gym", format: "1:4", coachId: linhTrainerId,
    startAt: hoursFromNow(h), endAt: hoursFromNow(h + 1), capacity: 4,
  });

  const h2 = nextHour();
  const patch = await call(`/schedule/classes/${cls._id}`, {
    method: "PATCH", token: tokens.trainer,
    body: { startAt: hoursFromNow(h2), endAt: hoursFromNow(h2 + 1) },
  });
  assert.equal(patch.status, 403, JSON.stringify(patch.data));
  assert.match(patch.data.error, /1:1 hoặc 1:2/);

  const del = await call(`/schedule/classes/${cls._id}`, { method: "DELETE", token: tokens.trainer });
  assert.equal(del.status, 403, JSON.stringify(del.data));
  assert.match(del.data.error, /1:1 hoặc 1:2/);
  assert.equal(await GymClass.countDocuments({ _id: cls._id }), 1, "buổi 1:4 không được HLV xoá");

  // Quầy thì thao tác bình thường
  assert.equal((await call(`/schedule/classes/${cls._id}`, { method: "DELETE", token: tokens.staff })).status, 200);
});

// ---------- 8. HLV không sửa buổi đã có khách ----------

test("trainer-patch-booked: buổi 1:1 của mình ĐÃ có khách -> 400 'liên hệ quầy'", async () => {
  const cls = await makeBookedClass({ token: tokens.trainer, format: "1:1", serviceType: "pilates" });
  const h = nextHour();
  const r = await call(`/schedule/classes/${cls._id}`, {
    method: "PATCH",
    token: tokens.trainer,
    body: { startAt: hoursFromNow(h), endAt: hoursFromNow(h + 1) },
  });
  assert.equal(r.status, 400, JSON.stringify(r.data));
  assert.match(r.data.error, /liên hệ quầy/i);
  // Không được đổi gì trong DB
  const db = await GymClass.findById(cls._id);
  assert.equal(db.startAt.getTime(), cls.startAt.getTime(), "buổi có khách phải giữ nguyên giờ");
});

// ---------- 9. Quầy đổi loại hình ----------

test("staff-format-change: buổi trống 1:2 -> 1:4 thì capacity thành 4; buổi có khách -> 400", async () => {
  const { r } = await makeClass({ format: "1:2", serviceType: "gym" });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const up = await call(`/schedule/classes/${r.data.class._id}`, {
    method: "PATCH",
    token: tokens.staff,
    body: { format: "1:4" },
  });
  assert.equal(up.status, 200, JSON.stringify(up.data));
  assert.equal(up.data.class.format, "1:4");
  assert.equal(up.data.class.capacity, 4, "sức chứa đi theo loại hình mới");

  // Loại hình lạ -> 400
  const bad = await call(`/schedule/classes/${r.data.class._id}`, {
    method: "PATCH", token: tokens.staff, body: { format: "1:5" },
  });
  assert.equal(bad.status, 400);
  assert.match(bad.data.error, /Loại hình/);

  // Buổi ĐÃ có khách: đổi loại hình bị chặn (sức chứa đổi theo -> ảnh hưởng khách)
  const booked = await makeBookedClass({ format: "1:2", serviceType: "gym" });
  const blocked = await call(`/schedule/classes/${booked._id}`, {
    method: "PATCH", token: tokens.staff, body: { format: "1:4" },
  });
  assert.equal(blocked.status, 400, JSON.stringify(blocked.data));
  assert.match(blocked.data.error, /loại hình/i);
  const db = await GymClass.findById(booked._id);
  assert.equal(db.format, "1:2");
  assert.equal(db.capacity, 2, "buổi có khách giữ nguyên sức chứa");
});

// ---------- 9b. capacity từ client cũng bị bỏ qua khi SỬA ----------

test("patch-capacity-ignored: quầy PATCH capacity 50 -> 200 nhưng sức chứa vẫn theo loại hình", async () => {
  const { r } = await makeClass({ format: "1:2", serviceType: "gym" });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const up = await call(`/schedule/classes/${r.data.class._id}`, {
    method: "PATCH", token: tokens.staff, body: { capacity: 50 },
  });
  assert.equal(up.status, 200, JSON.stringify(up.data));
  const db = await GymClass.findById(r.data.class._id);
  assert.equal(db.capacity, 2, "sức chứa không nhận từ client (POST lẫn PATCH)");
  assert.equal(db.format, "1:2");
});

// ---------- 10. Xoá buổi ----------

test("delete: HLV xoá buổi trống của mình -> 200; buổi đã có khách -> 400", async () => {
  const { r } = await makeClass({ token: tokens.trainer, format: "1:1", serviceType: "pilates" });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const del = await call(`/schedule/classes/${r.data.class._id}`, { method: "DELETE", token: tokens.trainer });
  assert.equal(del.status, 200, JSON.stringify(del.data));
  assert.equal(await GymClass.countDocuments({ _id: r.data.class._id }), 0);

  const booked = await makeBookedClass({ token: tokens.trainer, format: "1:1", serviceType: "pilates" });
  const blocked = await call(`/schedule/classes/${booked._id}`, { method: "DELETE", token: tokens.trainer });
  assert.equal(blocked.status, 400, JSON.stringify(blocked.data));
  assert.equal(await GymClass.countDocuments({ _id: booked._id }), 1, "buổi có khách không được xoá");

  // Buổi của HLV khác -> 403
  const other = await makeClass({ coachId: otherTrainerId, format: "1:2", serviceType: "gym" });
  assert.equal((await call(`/schedule/classes/${other.r.data.class._id}`, { method: "DELETE", token: tokens.trainer })).status, 403);
});

// ---------- 10b. her-36: TÊN RIÊNG cho buổi tập ----------

test("her-36 name-custom: tên riêng được lưu; name-fallback: bỏ trống -> lấy tên bộ môn", async () => {
  const custom = await makeClass({ format: "1:2", serviceType: "pilates", extra: { name: "Pilates phục hồi" } });
  assert.equal(custom.r.status, 201, JSON.stringify(custom.r.data));
  assert.equal(custom.r.data.class.name, "Pilates phục hồi");
  assert.equal((await GymClass.findById(custom.r.data.class._id)).name, "Pilates phục hồi");

  // Không gửi name -> nhãn bộ môn trong danh mục
  const plain = await makeClass({ format: "1:2", serviceType: "pilates" });
  assert.equal(plain.r.status, 201, JSON.stringify(plain.r.data));
  assert.equal(plain.r.data.class.name, "Pilates", "bỏ trống tên -> lấy nhãn bộ môn");
});

test("her-36 name-blank: tên toàn khoảng trắng -> coi như bỏ trống, lấy tên bộ môn", async () => {
  const { r } = await makeClass({ format: "1:1", serviceType: "yoga", extra: { name: "    " } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.class.name, "Yoga", "không lưu chuỗi trắng làm tên lớp");
});

test("her-36 name-length: 100 ký tự OK, 101 ký tự -> 400 'Tên lớp tối đa 100 ký tự'", async () => {
  const ok = await makeClass({ format: "1:1", serviceType: "gym", extra: { name: "A".repeat(100) } });
  assert.equal(ok.r.status, 201, JSON.stringify(ok.r.data));
  assert.equal(ok.r.data.class.name.length, 100);

  const tooLong = await makeClass({ format: "1:1", serviceType: "gym", extra: { name: "A".repeat(101) } });
  assert.equal(tooLong.r.status, 400, JSON.stringify(tooLong.r.data));
  assert.match(tooLong.r.data.error, /tối đa 100 ký tự/);
  assert.equal(await GymClass.countDocuments({ name: "A".repeat(101) }), 0, "không được tạo lớp khi tên quá dài");
});

test("her-36 name-type: name không phải chữ (số/mảng) -> 400 JSON, không crash", async () => {
  for (const bad of [123, ["Pilates"], { vi: "Pilates" }]) {
    const { r } = await makeClass({ format: "1:1", serviceType: "gym", extra: { name: bad } });
    assert.equal(r.status, 400, `${JSON.stringify(bad)}: ${JSON.stringify(r.data)}`);
    assert.ok(r.data.error, "phải có { error } tiếng Việt");
  }
});

test("her-36 patch-name: lớp trống đổi tên 200; 101 ký tự 400; đổi bộ môn kèm tên riêng", async () => {
  const { r } = await makeClass({ format: "1:2", serviceType: "pilates" });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const id = r.data.class._id;

  const renamed = await call(`/schedule/classes/${id}`, {
    method: "PATCH", token: tokens.staff, body: { name: "Pilates Reformer sáng" },
  });
  assert.equal(renamed.status, 200, JSON.stringify(renamed.data));
  assert.equal((await GymClass.findById(id)).name, "Pilates Reformer sáng");

  const tooLong = await call(`/schedule/classes/${id}`, {
    method: "PATCH", token: tokens.staff, body: { name: "B".repeat(101) },
  });
  assert.equal(tooLong.status, 400, JSON.stringify(tooLong.data));
  assert.match(tooLong.data.error, /tối đa 100 ký tự/);
  assert.equal((await GymClass.findById(id)).name, "Pilates Reformer sáng", "tên cũ phải giữ nguyên");

  // Đổi bộ môn kèm tên riêng: tên riêng thắng, không bị nhãn bộ môn đè
  const moved = await call(`/schedule/classes/${id}`, {
    method: "PATCH", token: tokens.staff, body: { serviceType: "yoga", name: "Yoga trị liệu" },
  });
  assert.equal(moved.status, 200, JSON.stringify(moved.data));
  const db = await GymClass.findById(id);
  assert.equal(db.serviceType, "yoga");
  assert.equal(db.name, "Yoga trị liệu");
});

test("her-36 patch-name-blank: xoá trống ô tên -> đặt lại theo nhãn bộ môn", async () => {
  const { r } = await makeClass({ format: "1:2", serviceType: "gym", extra: { name: "Gym tăng cơ" } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const cleared = await call(`/schedule/classes/${r.data.class._id}`, {
    method: "PATCH", token: tokens.staff, body: { name: "   " },
  });
  assert.equal(cleared.status, 200, JSON.stringify(cleared.data));
  assert.equal((await GymClass.findById(r.data.class._id)).name, "Gym", "về nhãn bộ môn của lớp");
});

test("her-36 patch-name-booked: lớp ĐÃ có khách -> 400, tên giữ nguyên (L7)", async () => {
  const cls = await makeBookedClass({ format: "1:2", serviceType: "gym", extra: { name: "Gym buổi sáng" } });
  const r = await call(`/schedule/classes/${cls._id}`, {
    method: "PATCH", token: tokens.staff, body: { name: "Gym đổi tên" },
  });
  assert.equal(r.status, 400, JSON.stringify(r.data));
  assert.match(r.data.error, /tên/i);
  assert.equal((await GymClass.findById(cls._id)).name, "Gym buổi sáng", "lịch của khách là snapshot — không đổi tên");
});

test("her-36 patch-name-same-booked: lớp có khách + đổi HLV kèm tên GIỐNG HỆT -> 200, HLV đổi thật", async () => {
  // review her-36 #1: gửi kèm ô tên không đổi gì KHÔNG được tính là "đổi tên" -> không chặn oan
  // luồng đổi HLV cho lớp đã có khách (quyết định 16/08)
  const cls = await makeBookedClass({ format: "1:2", serviceType: "gym", extra: { name: "Gym buổi sáng" } });
  const r = await call(`/schedule/classes/${cls._id}`, {
    method: "PATCH",
    token: tokens.staff,
    body: { coachId: otherTrainerId.toString(), name: "Gym buổi sáng" },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const db = await GymClass.findById(cls._id);
  assert.equal(db.coachId.toString(), otherTrainerId.toString(), "HLV phải đổi được");
  assert.equal(db.name, "Gym buổi sáng", "tên giữ nguyên");
  // Tên khác đi thì vẫn bị chặn như cũ
  const blocked = await call(`/schedule/classes/${cls._id}`, {
    method: "PATCH", token: tokens.staff, body: { coachId: linhTrainerId.toString(), name: "Gym đổi tên" },
  });
  assert.equal(blocked.status, 400, JSON.stringify(blocked.data));
});

test("her-36 patch-servicetype-autoname: tên TỰ SINH đi theo bộ môn mới; tên RIÊNG giữ nguyên", async () => {
  // review her-36 #2: luật ở SERVER — gọi thẳng API không kèm name cũng không để lớp
  // tên "Pilates" mà bộ môn là yoga
  const auto = await makeClass({ format: "1:1", serviceType: "pilates" });
  assert.equal(auto.r.status, 201, JSON.stringify(auto.r.data));
  assert.equal(auto.r.data.class.name, "Pilates");
  const moved = await call(`/schedule/classes/${auto.r.data.class._id}`, {
    method: "PATCH", token: tokens.staff, body: { serviceType: "yoga" },
  });
  assert.equal(moved.status, 200, JSON.stringify(moved.data));
  const dbAuto = await GymClass.findById(auto.r.data.class._id);
  assert.equal(dbAuto.serviceType, "yoga");
  assert.equal(dbAuto.name, "Yoga", "tên tự sinh phải đi theo bộ môn mới");

  const custom = await makeClass({ format: "1:1", serviceType: "yoga", extra: { name: "Yoga trị liệu" } });
  assert.equal(custom.r.status, 201, JSON.stringify(custom.r.data));
  const moved2 = await call(`/schedule/classes/${custom.r.data.class._id}`, {
    method: "PATCH", token: tokens.staff, body: { serviceType: "pilates" },
  });
  assert.equal(moved2.status, 200, JSON.stringify(moved2.data));
  const dbCustom = await GymClass.findById(custom.r.data.class._id);
  assert.equal(dbCustom.serviceType, "pilates");
  assert.equal(dbCustom.name, "Yoga trị liệu", "tên riêng KHÔNG bị nhãn bộ môn đè");
});

test("her-36 name-collapse: tên nhiều dòng/nhiều khoảng trắng -> gộp về 1 dấu cách", async () => {
  const { r } = await makeClass({
    format: "1:1", serviceType: "gym", extra: { name: "  Gym   tăng\n\ncơ  " },
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.class.name, "Gym tăng cơ", "không để tên xuống dòng làm vỡ dòng danh sách");
});

test("her-36 trainer-name: HLV tự mở buổi 1:1 của mình có tên riêng -> 201", async () => {
  const { r } = await makeClass({
    token: tokens.trainer, format: "1:1", serviceType: "pilates", extra: { name: "PT phục hồi lưng" },
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.class.name, "PT phục hồi lưng");
  assert.equal(r.data.class.coachId.toString(), linhTrainerId.toString());
});

// ---------- 11. Danh sách lớp theo quyền ----------

test("list: HLV chỉ thấy lớp của mình; quầy thấy tất cả; khách 403; có field format", async () => {
  await makeClass({ coachId: otherTrainerId, format: "1:2", serviceType: "gym" });
  await makeClass({ format: "1:2", serviceType: "gym" });
  const range = `?to=${hoursFromNow(24 * 365).toISOString()}`;

  const mine = await call(`/schedule/classes${range}`, { token: tokens.trainer });
  assert.equal(mine.status, 200, JSON.stringify(mine.data));
  assert.ok(mine.data.classes.length > 0, "HLV phải thấy lớp của mình");
  for (const c of mine.data.classes) {
    assert.equal(c.coachId.toString(), linhTrainerId.toString(), "không được lộ lớp của HLV khác");
    assert.ok(c.format, "response phải có loại hình");
  }

  const all = await call(`/schedule/classes${range}`, { token: tokens.staff });
  assert.equal(all.status, 200);
  assert.ok(
    all.data.classes.some((c) => c.coachId.toString() === otherTrainerId.toString()),
    "quầy phải thấy lớp của mọi HLV"
  );
  assert.ok(all.data.classes.length > mine.data.classes.length);

  assert.equal((await call("/schedule/classes", { token: tokens.customer })).status, 403);
});
