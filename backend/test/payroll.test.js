// Test her-12 — Mục 7: Lương & hoa hồng HLV.
// Cập nhật her-35 (19/08): hoa hồng theo LOẠI HÌNH buổi (1:1 / 1:2 / 1:4 / 1:8),
// đọc thẳng snapshot `format` của booking — không còn PTSlot, không so chuỗi title.
// Xem docs-her/testcase/testcase_her-12_payroll.md
// DB riêng her_test_j (tự seed), server cổng 4181.

const { test, before, after } = require("node:test");
const assert = require("node:assert");
const { spawn, spawnSync } = require("node:child_process");
const path = require("node:path");
const mongoose = require("mongoose");

const ROOT = path.join(__dirname, "..");
const URI = "mongodb://localhost:27017/her_test_j";
const S = "http://localhost:4181/api";

const Booking = require("../src/models/Booking");
const GymClass = require("../src/models/GymClass");
const Trainer = require("../src/models/Trainer");
const TrainerRate = require("../src/models/TrainerRate");
const User = require("../src/models/User");
const { FORMAT_CAPACITY } = require("../src/utils/formats");

let proc;
const tokens = {};
let linhTrainerId;
let otherTrainerId; // HLV Đức/Thu — không có tài khoản đăng nhập, chỉ có hồ sơ

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

// Tháng đang test = tháng hiện tại (giờ máy — VN)
const now = new Date();
const MONTH = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
// Ngày d của tháng hiện tại lúc 6h + offset giờ — giữa tháng để không lệch múi
const dayOfMonth = (d, hour = 6) => new Date(now.getFullYear(), now.getMonth(), d, hour, 0, 0);
const hoursFromNow = (h) => new Date(Date.now() + h * 3600 * 1000);

// Lấy dòng của 1 HLV trong bảng lương
const rowOf = (data, trainerId) =>
  data.entries.find((x) => x.trainerId.toString() === trainerId.toString());
// Tổng số đơn vị tính hoa hồng của mọi loại hình
const totalUnits = (e) => Object.values(e.byFormat).reduce((s, f) => s + f.count, 0);

// Fixture: 1 "buổi dạy" đã điểm danh — lớp THẬT + booking snapshot (serviceType/format),
// chèn DB trực tiếp để chủ động ngày giờ/trạng thái.
let seq = 0;
async function makeSession({
  trainerId = linhTrainerId,
  format = "1:4",
  serviceType = "pilates",
  day = 10,
  attended = 1,
  absent = 0,
  attendanceAtNull = false,
  status = "completed",
} = {}) {
  const start = dayOfMonth(day, 6 + (seq % 12)); // giờ lệch dần, tránh trùng khung
  const end = new Date(start.getTime() + 3600 * 1000);
  seq++;
  const cls = await GymClass.create({
    name: `Lop payroll ${seq}`,
    serviceType,
    format,
    coachId: trainerId,
    startAt: start,
    endAt: end,
    capacity: FORMAT_CAPACITY[format],
    bookedCount: attended + absent,
  });
  const docs = [];
  const customer = await User.findOne({ phone: "0909090909" });
  for (let i = 0; i < attended + absent; i++) {
    docs.push({
      userId: customer._id,
      classId: cls._id,
      trainerId,
      title: cls.name,
      serviceType,
      format,
      startAt: start,
      endAt: end,
      status: status === "completed" ? (i < attended ? "completed" : "no_show") : status,
      // no_show cũng có attendanceAt (được điểm danh thật là Vắng); sweep/chưa điểm danh -> null
      attendanceAt: attendanceAtNull || status !== "completed" ? null : start,
      attendanceBy: null,
    });
  }
  const bookings = await Booking.insertMany(docs);
  return { classId: cls._id, bookings, start };
}

const setRates = (trainerId, body, token = tokens.admin) =>
  call(`/payroll/settings/${trainerId}`, { method: "POST", token, body });

before(async () => {
  const seeded = spawnSync(process.execPath, ["src/scripts/seed.js"], {
    cwd: ROOT,
    env: { ...process.env, MONGODB_URI: URI },
    stdio: "ignore",
  });
  assert.equal(seeded.status, 0, "seed her_test_j thất bại");
  proc = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: "4181", MONGODB_URI: URI, JWT_SECRET: "testsecret", MIN_CANCEL_HOURS: "3" },
    stdio: "ignore",
  });
  await waitHealthy(S);
  await mongoose.connect(URI);

  // Dọn mức cũ cho chắc (seed đã xoá — đây là lưới an toàn khi seed cũ)
  await TrainerRate.deleteMany({});

  // Seed (her-17) nay kèm LỊCH SỬ ĐIỂM DANH DEMO cho màn Tổng quan — suite này cần số
  // liệu sạch tuyệt đối nên xoá phần demo đó trước khi dựng fixture riêng
  await Booking.deleteMany({ attendanceAt: { $ne: null } });

  tokens.admin = (await login("0999999999")).token;
  tokens.staff = (await login("0900000000")).token;
  tokens.trainer = (await login("0911111111")).token; // HLV Linh
  tokens.customer = (await login("0909090909")).token;
  linhTrainerId = (await User.findOne({ phone: "0911111111" })).trainerId;
  otherTrainerId = (await Trainer.findOne({ _id: { $ne: linhTrainerId } }))._id;
});

after(async () => {
  proc?.kill();
  await mongoose.disconnect();
});

// ---------- 1. Ma trận quyền ----------

test("matrix: admin đủ quyền; LỄ TÂN 403 TẤT CẢ; HLV chỉ /my; khách 403; anon 401", async () => {
  const eps = [
    ["GET", "/payroll/settings"],
    ["POST", `/payroll/settings/${linhTrainerId}`, { baseSalary: 0 }],
    ["GET", `/payroll/summary?month=${MONTH}`],
  ];
  for (const [m, p, body] of eps) {
    assert.equal((await call(p, { method: m, body })).status, 401, `anon ${p}`);
    assert.equal((await call(p, { method: m, token: tokens.customer, body })).status, 403, `khách ${p}`);
    assert.equal((await call(p, { method: m, token: tokens.staff, body })).status, 403, `LỄ TÂN phải bị chặn ${p}`);
    assert.equal((await call(p, { method: m, token: tokens.trainer, body })).status, 403, `HLV ${p}`);
  }
  // /my: HLV + admin(kiêm HLV nếu có hồ sơ) — khách/lễ tân 403
  assert.equal((await call(`/payroll/my?month=${MONTH}`, { token: tokens.trainer })).status, 200);
  assert.equal((await call(`/payroll/my?month=${MONTH}`, { token: tokens.customer })).status, 403);
  assert.equal((await call(`/payroll/my?month=${MONTH}`, { token: tokens.staff })).status, 403);
  // admin CHƯA có hồ sơ HLV -> /my 403 kèm lý do (chưa là HLV)
  assert.equal((await call(`/payroll/my?month=${MONTH}`, { token: tokens.admin })).status, 403);
  // admin gọi các endpoint quản trị -> 200
  assert.equal((await call("/payroll/settings", { token: tokens.admin })).status, 200);
  assert.equal((await call(`/payroll/summary?month=${MONTH}`, { token: tokens.admin })).status, 200);
});

// ---------- 2. Validate thiết lập ----------

test("validate: số âm / không nguyên / per lạ -> 400; trainerId rác -> 404", async () => {
  for (const bad of [
    { baseSalary: -1 },
    { f11Amount: 1.5 },
    { f14Amount: "abc" },
    { f11Per: "hour" },
    { f18Per: "xxx" },
    { baseSalary: 10e9 },
  ]) {
    const r = await setRates(linhTrainerId, bad);
    assert.equal(r.status, 400, `${JSON.stringify(bad)} phải bị chặn: ${JSON.stringify(r.data)}`);
    assert.ok(r.data.error);
  }
  assert.equal((await setRates("64b000000000000000000000", { baseSalary: 0 })).status, 404);
  assert.equal((await setRates("khong-id", { baseSalary: 0 })).status, 404);
});

// ---------- 3. Theo buổi ----------

test("per-session: buổi 1:4 có 2 Đến 1 Vắng = 1 buổi; buổi 1:1 = 1; buổi 1:2 có 2 Đến = 1 buổi", async () => {
  // Mức của Đức (otherTrainer): 1:4 200k/buổi, 1:1 300k/buổi, 1:2 400k/buổi
  await TrainerRate.create({
    trainerId: otherTrainerId, baseSalary: 0,
    f11Amount: 300000, f11Per: "session",
    f12Amount: 400000, f12Per: "session",
    f14Amount: 200000, f14Per: "session",
    f18Amount: 0, f18Per: "session",
    effectiveFrom: dayOfMonth(1, 0),
  });
  await makeSession({ trainerId: otherTrainerId, format: "1:4", day: 5, attended: 2, absent: 1 });
  await makeSession({ trainerId: otherTrainerId, format: "1:1", day: 6, attended: 1 });
  await makeSession({ trainerId: otherTrainerId, format: "1:2", day: 7, attended: 2 });

  const r = await call(`/payroll/summary?month=${MONTH}`, { token: tokens.admin });
  assert.equal(r.status, 200);
  const e = rowOf(r.data, otherTrainerId);
  assert.ok(e, "phải có dòng của HLV này");
  assert.equal(e.byFormat["1:4"].count, 1, "buổi 1:4 tính theo BUỔI (nhiều khách vẫn 1 buổi)");
  assert.equal(e.byFormat["1:1"].count, 1);
  assert.equal(e.byFormat["1:2"].count, 1, "buổi 1:2 theo BUỔI");
  assert.equal(e.byFormat["1:8"].count, 0);
  assert.equal(e.commission, 200000 + 300000 + 400000);
  assert.equal(e.total, e.commission);
});

// ---------- 4. Theo đầu khách ----------

test("per-attendee: buổi 1:4 có 2 Đến = 2 x mức; buổi 1:2 có 2 Đến = 2 x mức; Vắng không tính", async () => {
  // Đổi mức của Đức sang per=attendee (bản ghi mới, effective từ đầu tháng — đè logic chọn mới nhất)
  await TrainerRate.create({
    trainerId: otherTrainerId, baseSalary: 0,
    f11Amount: 300000, f11Per: "attendee",
    f12Amount: 400000, f12Per: "attendee",
    f14Amount: 200000, f14Per: "attendee",
    f18Amount: 0, f18Per: "attendee",
    effectiveFrom: dayOfMonth(1, 1), // muộn hơn bản ghi trước 1 giờ -> thắng
  });
  const r = await call(`/payroll/summary?month=${MONTH}`, { token: tokens.admin });
  const e = rowOf(r.data, otherTrainerId);
  assert.equal(e.byFormat["1:4"].count, 2, "theo ĐẦU KHÁCH đến (Vắng không tính)");
  assert.equal(e.byFormat["1:2"].count, 2);
  assert.equal(e.byFormat["1:1"].count, 1);
  assert.equal(e.byFormat["1:4"].per, "attendee", "per hiển thị theo mức hiện hành");
  assert.equal(e.commission, 2 * 200000 + 300000 + 2 * 400000);
});

// ---------- 5. Chỉ buổi điểm danh thật ----------

test("attendance-only: sweep(attendanceAt null) / cancelled / booked không được tính", async () => {
  // HLV Thu (trainer thứ 3) — sạch dữ liệu
  const thu = await Trainer.findOne({ _id: { $nin: [linhTrainerId, otherTrainerId] } });
  await TrainerRate.create({
    trainerId: thu._id, baseSalary: 0,
    f11Amount: 100000, f11Per: "session",
    f12Amount: 100000, f12Per: "session",
    f14Amount: 100000, f14Per: "session",
    f18Amount: 100000, f18Per: "session",
    effectiveFrom: dayOfMonth(1, 0),
  });
  await makeSession({ trainerId: thu._id, format: "1:4", day: 8, attended: 2, attendanceAtNull: true }); // sweep
  await makeSession({ trainerId: thu._id, format: "1:1", day: 9, attended: 1, status: "cancelled" });
  await makeSession({ trainerId: thu._id, format: "1:1", day: 11, attended: 1, status: "booked" });

  const r = await call(`/payroll/summary?month=${MONTH}`, { token: tokens.admin });
  const e = rowOf(r.data, thu._id);
  assert.equal(e.commission, 0, "không buổi nào đủ điều kiện điểm danh thật");
  assert.equal(totalUnits(e), 0);
});

// ---------- 6. Đổi mức giữa tháng ----------

test("rate-change: buổi ngày 5 áp mức cũ, buổi ngày 15 áp mức mới (đổi ngày 10)", async () => {
  await TrainerRate.create({
    trainerId: linhTrainerId, baseSalary: 0,
    f11Amount: 100000, f11Per: "session",
    f12Amount: 0, f12Per: "session",
    f14Amount: 0, f14Per: "session",
    f18Amount: 0, f18Per: "session",
    effectiveFrom: dayOfMonth(1, 0),
  });
  await TrainerRate.create({
    trainerId: linhTrainerId, baseSalary: 0,
    f11Amount: 150000, f11Per: "session",
    f12Amount: 0, f12Per: "session",
    f14Amount: 0, f14Per: "session",
    f18Amount: 0, f18Per: "session",
    effectiveFrom: dayOfMonth(10, 0),
  });
  await makeSession({ trainerId: linhTrainerId, format: "1:1", day: 5, attended: 1 });
  await makeSession({ trainerId: linhTrainerId, format: "1:1", day: 15, attended: 1 });

  const r = await call(`/payroll/summary?month=${MONTH}`, { token: tokens.admin });
  const e = rowOf(r.data, linhTrainerId);
  assert.equal(e.byFormat["1:1"].count, 2);
  assert.equal(e.commission, 100000 + 150000, "mỗi buổi áp mức tại NGÀY DIỄN RA");
});

// ---------- 7-8. Chưa thiết lập / lương cứng ----------

test("no-rate + base-salary: HLV chưa thiết lập -> 0đ không crash; lương cứng cộng đủ dù 0 buổi", async () => {
  // HLV mới toanh chưa có rate, có 1 buổi dạy
  const fresh = await Trainer.create({ name: "HLV Moi", specialty: "" });
  await makeSession({ trainerId: fresh._id, format: "1:1", day: 12, attended: 1 });

  let r = await call(`/payroll/summary?month=${MONTH}`, { token: tokens.admin });
  assert.equal(r.status, 200);
  let e = rowOf(r.data, fresh._id);
  assert.equal(e.commission, 0, "chưa thiết lập mức -> 0đ");
  assert.equal(e.total, 0);
  assert.equal(e.byFormat["1:1"].count, 1, "vẫn ghi nhận buổi dạy, chỉ là 0đ");

  // Thiết lập lương cứng qua API — không dạy thêm buổi nào có mức
  const set = await setRates(fresh._id, { baseSalary: 8000000 });
  assert.equal(set.status, 201, JSON.stringify(set.data));
  r = await call(`/payroll/summary?month=${MONTH}`, { token: tokens.admin });
  e = rowOf(r.data, fresh._id);
  assert.equal(e.baseSalary, 8000000);
  assert.equal(e.total, 8000000, "tổng = lương cứng khi hoa hồng 0");
});

// ---------- 9. Đủ 4 loại hình trong 1 tháng ----------

test("4 loại hình: mỗi loại 1 buổi mức khác nhau -> byFormat đúng từng loại, commission = tổng 4", async () => {
  const multi = await Trainer.create({ name: "HLV Bon Loai", specialty: "" });
  await TrainerRate.create({
    trainerId: multi._id, baseSalary: 0,
    f11Amount: 100000, f11Per: "session",
    f12Amount: 200000, f12Per: "session",
    f14Amount: 300000, f14Per: "session",
    f18Amount: 400000, f18Per: "session",
    effectiveFrom: dayOfMonth(1, 0),
  });
  await makeSession({ trainerId: multi._id, format: "1:1", day: 20, attended: 1 });
  await makeSession({ trainerId: multi._id, format: "1:2", day: 21, attended: 2 });
  await makeSession({ trainerId: multi._id, format: "1:4", day: 22, attended: 3, absent: 1 });
  await makeSession({ trainerId: multi._id, format: "1:8", serviceType: "yoga", day: 23, attended: 5 });

  const r = await call(`/payroll/summary?month=${MONTH}`, { token: tokens.admin });
  const e = rowOf(r.data, multi._id);
  assert.equal(e.byFormat["1:1"].count, 1);
  assert.equal(e.byFormat["1:1"].amount, 100000);
  assert.equal(e.byFormat["1:2"].count, 1);
  assert.equal(e.byFormat["1:2"].amount, 200000);
  assert.equal(e.byFormat["1:4"].count, 1);
  assert.equal(e.byFormat["1:4"].amount, 300000);
  assert.equal(e.byFormat["1:8"].count, 1);
  assert.equal(e.byFormat["1:8"].amount, 400000);
  assert.equal(e.commission, 100000 + 200000 + 300000 + 400000, "hoa hồng = tổng 4 loại hình");
  assert.equal(e.total, e.commission);
});

// ---------- 10. HLV chỉ thấy của mình ----------

test("my-only: /payroll/my trả đúng số của Linh, không lộ HLV khác", async () => {
  const r = await call(`/payroll/my?month=${MONTH}`, { token: tokens.trainer });
  assert.equal(r.status, 200);
  assert.equal(r.data.entry.trainerId.toString(), linhTrainerId.toString());
  assert.equal(r.data.entry.byFormat["1:1"].count, 2, "đúng 2 buổi 1:1 của Linh (test rate-change)");
  assert.equal(r.data.entry.commission, 250000);
  assert.equal(r.data.entries, undefined, "không được trả danh sách tất cả HLV");
});

// ---------- 11. Lương luôn tính động (16/08 bỏ chốt) ----------

test("luon-dong (quyết định 16/08 BỎ chốt): sửa/thêm điểm danh là bảng lương cập nhật NGAY", async () => {
  const before = await call(`/payroll/summary?month=${MONTH}`, { token: tokens.admin });
  const linhBefore = rowOf(before.data, linhTrainerId);

  await makeSession({ trainerId: linhTrainerId, format: "1:1", day: 16, attended: 1 });

  const after = await call(`/payroll/summary?month=${MONTH}`, { token: tokens.admin });
  const linhAfter = rowOf(after.data, linhTrainerId);
  assert.equal(linhAfter.byFormat["1:1"].count, linhBefore.byFormat["1:1"].count + 1,
    "không còn chốt — số luôn theo điểm danh hiện tại");
  assert.ok(!("closed" in after.data), "response không còn khái niệm chốt");
  // /my của HLV cũng là số động, không còn khái niệm chốt
  const my = await call(`/payroll/my?month=${MONTH}`, { token: tokens.trainer });
  assert.equal(my.data.entry.byFormat["1:1"].count, linhAfter.byFormat["1:1"].count);
  assert.ok(!("closed" in my.data), "/my không còn field closed");
  // Endpoint chốt đã bị XOÁ — khoá vĩnh viễn (review her-16 A3)
  assert.equal((await call("/payroll/close", { method: "POST", token: tokens.admin, body: { month: MONTH } })).status, 404);
});

// ---------- 12. Buổi đổi HLV ----------

test("coach-swap: buổi bị đổi HLV tính cho người DẠY THẬT (trainerId trên booking)", async () => {
  // Buổi tạo dưới tên otherTrainer nhưng booking.trainerId đã sync sang Linh (mô phỏng đổi HLV)
  const { bookings } = await makeSession({ trainerId: otherTrainerId, format: "1:1", day: 18, attended: 1 });
  await Booking.updateMany({ _id: { $in: bookings.map((b) => b._id) } }, { $set: { trainerId: linhTrainerId } });

  const r = await call(`/payroll/summary?month=${MONTH}`, { token: tokens.admin });
  const linh = rowOf(r.data, linhTrainerId);
  assert.equal(linh.byFormat["1:1"].count, 4, "buổi đổi HLV phải về tay Linh");
});

// ---------- 13. Input rác ----------

test("bad-month: month sai định dạng -> 400; XEM tháng TƯƠNG LAI -> 400", async () => {
  for (const bad of ["13-2026", "2026-13", "abc", "2026-00", ""]) {
    const r = await call(`/payroll/summary?month=${bad}`, { token: tokens.admin });
    assert.equal(r.status, 400, `month "${bad}" phải bị chặn`);
    assert.ok(r.data.error);
  }
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const nextMonth = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`;
  const r = await call(`/payroll/summary?month=${nextMonth}`, { token: tokens.admin });
  assert.equal(r.status, 400, "không xem được tháng chưa tới");
});

// ---------- Vòng review độc lập her-12: regression cho các fix ----------

test("review-fix (V1): điểm danh sớm 1 khách rồi ĐỔI HLV lớp — buổi chỉ tính cho HLV MỚI, không tính đôi", async () => {
  // Lớp tương lai của Đức, 2 khách; 1 khách được điểm danh SỚM trước khi đổi HLV
  const swapStart = hoursFromNow(2);
  const swapEnd = hoursFromNow(3);
  // Dọn lịch seed của Linh trùng cửa sổ này để bước đổi HLV không vướng "trùng giờ"
  await GymClass.deleteMany({ coachId: linhTrainerId, startAt: { $lt: swapEnd }, endAt: { $gt: swapStart } });
  const cls = await GymClass.create({
    name: "Lop swap payroll", serviceType: "pilates", format: "1:4", coachId: otherTrainerId,
    startAt: swapStart, endAt: swapEnd, capacity: FORMAT_CAPACITY["1:4"], bookedCount: 2,
  });
  const kh = await User.findOne({ phone: "0909090909" });
  const mk = (status, attendanceAt) => ({
    userId: kh._id, classId: cls._id, trainerId: otherTrainerId,
    title: cls.name, serviceType: cls.serviceType, format: cls.format,
    startAt: cls.startAt, endAt: cls.endAt, status, attendanceAt,
  });
  const preR = await call(`/payroll/summary?month=${MONTH}`, { token: tokens.admin });
  const preSwap = {
    duc: rowOf(preR.data, otherTrainerId).byFormat["1:4"].count,
    linh: rowOf(preR.data, linhTrainerId).byFormat["1:4"].count,
  };
  const [b1] = await Booking.insertMany([mk("completed", new Date()), mk("booked", null)]);

  // Admin đổi HLV lớp sang Linh (qua API — code sync phải kéo CẢ booking điểm danh sớm)
  const sw = await call(`/schedule/classes/${cls._id}`, {
    method: "PATCH", token: tokens.admin, body: { coachId: linhTrainerId.toString() },
  });
  assert.equal(sw.status, 200, JSON.stringify(sw.data));
  assert.equal((await Booking.findById(b1._id)).trainerId.toString(), linhTrainerId.toString(),
    "booking điểm danh SỚM (buổi chưa diễn ra) phải sang HLV mới");

  // So sánh DELTA với trước khi tạo lớp (các test trước đã cho Đức buổi 1:4 riêng)
  const r = await call(`/payroll/summary?month=${MONTH}`, { token: tokens.admin });
  const after = {
    duc: rowOf(r.data, otherTrainerId).byFormat["1:4"].count,
    linh: rowOf(r.data, linhTrainerId).byFormat["1:4"].count,
  };
  assert.equal(after.duc, preSwap.duc, "HLV cũ không được tính buổi đã chuyển giao");
  assert.ok(after.linh > preSwap.linh, "HLV mới (người dạy thật) hưởng buổi này");
});

test("review-fix (V2): 2 khách CÙNG MỘT LỚP = 1 buổi (per=attendee -> 2 đơn vị), không tách thành buổi lẻ", async () => {
  const before = await call(`/payroll/summary?month=${MONTH}`, { token: tokens.admin });
  const eBefore = rowOf(before.data, otherTrainerId);
  const cls = await GymClass.create({
    name: "Lop gop buoi", serviceType: "pilates", format: "1:2", coachId: otherTrainerId,
    startAt: hoursFromNow(5), endAt: hoursFromNow(6), capacity: FORMAT_CAPACITY["1:2"], bookedCount: 2,
  });
  const kh = await User.findOne({ phone: "0909090909" });
  const mk = () => ({
    userId: kh._id, classId: cls._id, trainerId: otherTrainerId,
    title: cls.name, serviceType: cls.serviceType, format: cls.format,
    startAt: cls.startAt, endAt: cls.endAt, status: "completed", attendanceAt: new Date(),
  });
  await Booking.insertMany([mk(), mk()]);

  const r = await call(`/payroll/summary?month=${MONTH}`, { token: tokens.admin });
  const e = rowOf(r.data, otherTrainerId);
  // per hiện hành của Đức là attendee (test per-attendee) -> 1 buổi 1:2 có 2 khách = 2 đơn vị,
  // và KHÔNG có buổi loại hình khác nào phát sinh từ cùng lớp
  assert.equal(e.byFormat["1:1"].count, eBefore.byFormat["1:1"].count, "không được tách cùng lớp thành buổi loại khác");
  assert.equal(e.byFormat["1:4"].count, eBefore.byFormat["1:4"].count);
  assert.equal(e.byFormat["1:2"].count, eBefore.byFormat["1:2"].count + 2, "1 buổi 1:2 có 2 khách (per=attendee) = +2 đơn vị");
});

test("phòng thủ: booking rác thiếu classId/format không làm sập bảng lương", async () => {
  // Chèn RAW qua driver để né validate enum của Mongoose — mô phỏng dữ liệu cũ trên DB thật
  // (booking PT trước her-35 không có classId; booking lỗi có format ngoài danh mục).
  const rac = await Trainer.create({ name: "HLV Du Lieu Rac", specialty: "" });
  await TrainerRate.create({
    trainerId: rac._id, baseSalary: 0,
    f11Amount: 100000, f11Per: "session",
    f12Amount: 100000, f12Per: "session",
    f14Amount: 100000, f14Per: "session",
    f18Amount: 100000, f18Per: "session",
    effectiveFrom: dayOfMonth(1, 0),
  });
  // 1 buổi HỢP LỆ để có mốc so sánh
  await makeSession({ trainerId: rac._id, format: "1:1", day: 24, attended: 1 });

  const kh = await User.findOne({ phone: "0909090909" });
  const st = dayOfMonth(25, 8);
  const end = new Date(st.getTime() + 3600000);
  const clsRac = await GymClass.create({
    name: "Lop rac", serviceType: "pilates", format: "1:4", coachId: rac._id,
    startAt: st, endAt: end, capacity: FORMAT_CAPACITY["1:4"], bookedCount: 1,
  });
  const raw = mongoose.connection.collection("bookings");
  await raw.insertOne({ // loại hình lạ
    userId: kh._id, classId: clsRac._id, trainerId: rac._id, title: "Lop rac",
    serviceType: "pilates", format: "9:9", startAt: st, endAt: end,
    status: "completed", attendanceAt: st,
  });
  await raw.insertOne({ // thiếu classId (booking PT cũ)
    userId: kh._id, trainerId: rac._id, title: "Buoi PT cu",
    serviceType: "pilates", format: "1:1", startAt: st, endAt: end,
    status: "completed", attendanceAt: st,
  });

  const r = await call(`/payroll/summary?month=${MONTH}`, { token: tokens.admin });
  assert.equal(r.status, 200, "bảng lương vẫn trả 200, không 500");
  const e = rowOf(r.data, rac._id);
  assert.equal(e.byFormat["1:1"].count, 1, "chỉ đếm buổi hợp lệ — booking thiếu classId bị bỏ qua");
  assert.equal(e.byFormat["1:4"].count, 0, "booking format lạ '9:9' không rơi vào loại hình nào");
  assert.equal(totalUnits(e), 1);
  assert.equal(e.commission, 100000, "không cộng tiền từ 2 booking rác");
});

test("review-fix (V4): summary/my tháng TƯƠNG LAI -> 400; năm rác '0026-08' -> 400", async () => {
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const nextMonth = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`;
  assert.equal((await call(`/payroll/summary?month=${nextMonth}`, { token: tokens.admin })).status, 400);
  assert.equal((await call(`/payroll/my?month=${nextMonth}`, { token: tokens.trainer })).status, 400);
  assert.equal((await call(`/payroll/summary?month=0026-08`, { token: tokens.admin })).status, 400);
  assert.equal((await call(`/payroll/my?month=0026-08`, { token: tokens.trainer })).status, 400);
});

test("review-fix (V5): POST settings body RỖNG -> 400, không lặng lẽ tạo mức toàn 0", async () => {
  const before = await TrainerRate.countDocuments();
  const r = await setRates(linhTrainerId, {});
  assert.equal(r.status, 400);
  assert.equal(await TrainerRate.countDocuments(), before, "không được tạo bản ghi nào");
});

test("review-fix (V8): admin KIÊM HLV gọi /payroll/my -> 200 + đúng entry của mình", async () => {
  // Cấp hồ sơ HLV cho admin qua API chính thức
  const r1 = await call("/me/trainer-profile", { method: "POST", token: tokens.admin, body: { name: "Chủ kiêm HLV", specialties: ["pilates"] } });
  assert.equal(r1.status, 201, JSON.stringify(r1.data));
  const my = await call(`/payroll/my?month=${MONTH}`, { token: tokens.admin });
  assert.equal(my.status, 200);
  assert.ok(my.data.entry, "số động — có dòng của admin kiêm HLV ngay");
  assert.equal(my.data.entry.trainerName, "Chủ kiêm HLV");
});

test("review-fix (biên tháng): buổi 23:30 cuối tháng trước và 00:30 ngày 1 — mỗi buổi đúng 1 tháng", async () => {
  const prevEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 30); // ngày cuối tháng trước
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1, 0, 30);
  const prevMonthStr = `${prevEnd.getFullYear()}-${String(prevEnd.getMonth() + 1).padStart(2, "0")}`;
  const kh = await User.findOne({ phone: "0909090909" });
  const fresh = await Trainer.create({ name: "HLV Bien Thang", specialty: "" });
  await TrainerRate.create({
    trainerId: fresh._id, baseSalary: 0,
    f11Amount: 100000, f11Per: "session",
    f12Amount: 0, f12Per: "session",
    f14Amount: 0, f14Per: "session",
    f18Amount: 0, f18Per: "session",
    effectiveFrom: new Date(2020, 0, 1),
  });
  for (const st of [prevEnd, firstDay]) {
    const end = new Date(st.getTime() + 3600000);
    const cls = await GymClass.create({
      name: "Buoi bien thang", serviceType: "pilates", format: "1:1", coachId: fresh._id,
      startAt: st, endAt: end, capacity: FORMAT_CAPACITY["1:1"], bookedCount: 1,
    });
    await Booking.insertMany([{
      userId: kh._id, classId: cls._id, trainerId: fresh._id, title: cls.name,
      serviceType: "pilates", format: "1:1", startAt: st, endAt: end,
      status: "completed", attendanceAt: st,
    }]);
  }
  const cur = await call(`/payroll/summary?month=${MONTH}`, { token: tokens.admin });
  const prev = await call(`/payroll/summary?month=${prevMonthStr}`, { token: tokens.admin });
  const eCur = cur.data.entries.find((x) => x.trainerName === "HLV Bien Thang");
  const ePrev = prev.data.entries.find((x) => x.trainerName === "HLV Bien Thang");
  assert.equal(eCur.byFormat["1:1"].count, 1, "chỉ buổi 00:30 ngày 1 thuộc tháng này");
  assert.equal(ePrev.byFormat["1:1"].count, 1, "buổi 23:30 thuộc tháng trước");
});
