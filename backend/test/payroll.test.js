// Test her-12 — Mục 7: Lương & hoa hồng HLV.
// Xem docs-her/testcase/testcase_her-12_payroll.md
// DB riêng her_test_j (tự seed), server cổng 4181.

const { test, before, after } = require("node:test");
const assert = require("node:assert");
const { spawn, spawnSync } = require("node:child_process");
const path = require("node:path");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const ROOT = path.join(__dirname, "..");
const URI = "mongodb://localhost:27017/her_test_j";
const S = "http://localhost:4181/api";

const Booking = require("../src/models/Booking");
const PTSlot = require("../src/models/PTSlot");
const GymClass = require("../src/models/GymClass");
const Trainer = require("../src/models/Trainer");
const TrainerRate = require("../src/models/TrainerRate");
const User = require("../src/models/User");

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

// Fixture: 1 "buổi dạy" đã điểm danh — chèn DB trực tiếp để chủ động ngày giờ/trạng thái.
// kind: "group" (lớp nhóm) | "pt1" (PT 1:1) | "ptGroup" (PT nhóm)
let seq = 0;
async function makeSession({ trainerId = linhTrainerId, kind = "group", day = 10, attended = 1, absent = 0, attendanceAtNull = false, status = "completed" } = {}) {
  const start = dayOfMonth(day, 6 + (seq % 12)); // giờ lệch dần, tránh trùng khung
  const end = new Date(start.getTime() + 3600 * 1000);
  seq++;
  let classId = null;
  let slotId = null;
  let title;
  if (kind === "group") {
    const cls = await GymClass.create({
      name: `Lop payroll ${seq}`, serviceType: "pilates", coachId: trainerId,
      startAt: start, endAt: end, capacity: 10, bookedCount: attended + absent,
    });
    classId = cls._id;
    title = cls.name;
  } else {
    const slot = await PTSlot.create({
      trainerId, startAt: start, endAt: end,
      capacity: kind === "ptGroup" ? 5 : 1, bookedCount: attended + absent,
    });
    slotId = slot._id;
    title = kind === "ptGroup" ? "PT nhóm — HLV X" : "1:1 PT — HLV X";
  }
  const docs = [];
  const customer = await User.findOne({ phone: "0909090909" });
  for (let i = 0; i < attended + absent; i++) {
    docs.push({
      userId: customer._id,
      type: kind === "group" ? "group" : "pt",
      classId, slotId, trainerId, title,
      startAt: start, endAt: end,
      status: status === "completed" ? (i < attended ? "completed" : "no_show") : status,
      attendanceAt: attendanceAtNull || status !== "completed" ? null : (i < attended + absent ? start : null),
      attendanceBy: null,
    });
  }
  // no_show cũng có attendanceAt (được điểm danh thật là Vắng)
  for (let i = attended; i < docs.length; i++) docs[i].attendanceAt = start;
  if (attendanceAtNull) for (const d of docs) d.attendanceAt = null;
  const bookings = await Booking.insertMany(docs);
  return { classId, slotId, bookings, start };
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

  // Dọn 2 collection mới cho chắc (seed đã xoá — đây là lưới an toàn khi seed cũ)
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
    { pt1Amount: 1.5 },
    { groupAmount: "abc" },
    { groupPer: "hour" },
    { ptGroupPer: "xxx" },
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

test("per-session: lớp nhóm 2 Đến 1 Vắng = 1 buổi; PT 1:1 = 1; PT nhóm 2 Đến = 1 buổi", async () => {
  // Mức của Đức (otherTrainer): group 200k/buổi, pt1 300k, ptGroup 400k/buổi
  await TrainerRate.create({
    trainerId: otherTrainerId, baseSalary: 0,
    groupAmount: 200000, groupPer: "session",
    pt1Amount: 300000, ptGroupAmount: 400000, ptGroupPer: "session",
    effectiveFrom: dayOfMonth(1, 0),
  });
  await makeSession({ trainerId: otherTrainerId, kind: "group", day: 5, attended: 2, absent: 1 });
  await makeSession({ trainerId: otherTrainerId, kind: "pt1", day: 6, attended: 1 });
  await makeSession({ trainerId: otherTrainerId, kind: "ptGroup", day: 7, attended: 2 });

  const r = await call(`/payroll/summary?month=${MONTH}`, { token: tokens.admin });
  assert.equal(r.status, 200);
  const e = r.data.entries.find((x) => x.trainerId.toString() === otherTrainerId.toString());
  assert.ok(e, "phải có dòng của HLV này");
  assert.equal(e.group.count, 1, "lớp nhóm tính theo BUỔI");
  assert.equal(e.pt1.count, 1);
  assert.equal(e.ptGroup.count, 1, "PT nhóm theo BUỔI");
  assert.equal(e.commission, 200000 + 300000 + 400000);
  assert.equal(e.total, e.commission);
});

// ---------- 4. Theo đầu khách ----------

test("per-attendee: group 2 Đến = 2 x mức; ptGroup 2 Đến = 2 x mức; Vắng không tính", async () => {
  // Đổi mức của Đức sang per=attendee (bản ghi mới, effective từ đầu tháng — đè logic chọn mới nhất)
  await TrainerRate.create({
    trainerId: otherTrainerId, baseSalary: 0,
    groupAmount: 200000, groupPer: "attendee",
    pt1Amount: 300000, ptGroupAmount: 400000, ptGroupPer: "attendee",
    effectiveFrom: dayOfMonth(1, 1), // muộn hơn bản ghi trước 1 giờ -> thắng
  });
  const r = await call(`/payroll/summary?month=${MONTH}`, { token: tokens.admin });
  const e = r.data.entries.find((x) => x.trainerId.toString() === otherTrainerId.toString());
  assert.equal(e.group.count, 2, "theo ĐẦU KHÁCH đến (Vắng không tính)");
  assert.equal(e.ptGroup.count, 2);
  assert.equal(e.pt1.count, 1);
  assert.equal(e.commission, 2 * 200000 + 300000 + 2 * 400000);
});

// ---------- 5. Chỉ buổi điểm danh thật ----------

test("attendance-only: sweep(attendanceAt null) / cancelled / booked không được tính", async () => {
  // HLV Thu (trainer thứ 3) — sạch dữ liệu
  const thu = await Trainer.findOne({ _id: { $nin: [linhTrainerId, otherTrainerId] } });
  await TrainerRate.create({
    trainerId: thu._id, baseSalary: 0, groupAmount: 100000, groupPer: "session",
    pt1Amount: 100000, ptGroupAmount: 100000, ptGroupPer: "session", effectiveFrom: dayOfMonth(1, 0),
  });
  await makeSession({ trainerId: thu._id, kind: "group", day: 8, attended: 2, attendanceAtNull: true }); // sweep
  await makeSession({ trainerId: thu._id, kind: "pt1", day: 9, attended: 1, status: "cancelled" });
  await makeSession({ trainerId: thu._id, kind: "pt1", day: 11, attended: 1, status: "booked" });

  const r = await call(`/payroll/summary?month=${MONTH}`, { token: tokens.admin });
  const e = r.data.entries.find((x) => x.trainerId.toString() === thu._id.toString());
  assert.equal(e.commission, 0, "không buổi nào đủ điều kiện điểm danh thật");
  assert.equal(e.group.count + e.pt1.count + e.ptGroup.count, 0);
});

// ---------- 6. Đổi mức giữa tháng ----------

test("rate-change: buổi ngày 5 áp mức cũ, buổi ngày 15 áp mức mới (đổi ngày 10)", async () => {
  await TrainerRate.create({
    trainerId: linhTrainerId, baseSalary: 0, groupAmount: 0, groupPer: "session",
    pt1Amount: 100000, ptGroupAmount: 0, ptGroupPer: "session", effectiveFrom: dayOfMonth(1, 0),
  });
  await TrainerRate.create({
    trainerId: linhTrainerId, baseSalary: 0, groupAmount: 0, groupPer: "session",
    pt1Amount: 150000, ptGroupAmount: 0, ptGroupPer: "session", effectiveFrom: dayOfMonth(10, 0),
  });
  await makeSession({ trainerId: linhTrainerId, kind: "pt1", day: 5, attended: 1 });
  await makeSession({ trainerId: linhTrainerId, kind: "pt1", day: 15, attended: 1 });

  const r = await call(`/payroll/summary?month=${MONTH}`, { token: tokens.admin });
  const e = r.data.entries.find((x) => x.trainerId.toString() === linhTrainerId.toString());
  assert.equal(e.pt1.count, 2);
  assert.equal(e.commission, 100000 + 150000, "mỗi buổi áp mức tại NGÀY DIỄN RA");
});

// ---------- 7-8. Chưa thiết lập / lương cứng ----------

test("no-rate + base-salary: HLV chưa thiết lập -> 0đ không crash; lương cứng cộng đủ dù 0 buổi", async () => {
  // HLV mới toanh chưa có rate, có 1 buổi dạy
  const fresh = await Trainer.create({ name: "HLV Moi", specialty: "" });
  await makeSession({ trainerId: fresh._id, kind: "pt1", day: 12, attended: 1 });

  let r = await call(`/payroll/summary?month=${MONTH}`, { token: tokens.admin });
  assert.equal(r.status, 200);
  let e = r.data.entries.find((x) => x.trainerId.toString() === fresh._id.toString());
  assert.equal(e.commission, 0, "chưa thiết lập mức -> 0đ");
  assert.equal(e.total, 0);

  // Thiết lập lương cứng qua API — không dạy thêm buổi nào có mức
  const set = await setRates(fresh._id, { baseSalary: 8000000 });
  assert.equal(set.status, 201, JSON.stringify(set.data));
  r = await call(`/payroll/summary?month=${MONTH}`, { token: tokens.admin });
  e = r.data.entries.find((x) => x.trainerId.toString() === fresh._id.toString());
  assert.equal(e.baseSalary, 8000000);
  assert.equal(e.total, 8000000, "tổng = lương cứng khi hoa hồng 0");
});

// ---------- 9. HLV chỉ thấy của mình ----------

test("my-only: /payroll/my trả đúng số của Linh, không lộ HLV khác", async () => {
  const r = await call(`/payroll/my?month=${MONTH}`, { token: tokens.trainer });
  assert.equal(r.status, 200);
  assert.equal(r.data.entry.trainerId.toString(), linhTrainerId.toString());
  assert.equal(r.data.entry.pt1.count, 2, "đúng 2 buổi PT của Linh (test rate-change)");
  assert.equal(r.data.entry.commission, 250000);
  assert.equal(r.data.entries, undefined, "không được trả danh sách tất cả HLV");
});

// ---------- 10. Lương luôn tính động (16/08 bỏ chốt) ----------

test("luon-dong (quyết định 16/08 BỎ chốt): sửa/thêm điểm danh là bảng lương cập nhật NGAY", async () => {
  const before = await call(`/payroll/summary?month=${MONTH}`, { token: tokens.admin });
  const linhBefore = before.data.entries.find((x) => x.trainerId.toString() === linhTrainerId.toString());

  await makeSession({ trainerId: linhTrainerId, kind: "pt1", day: 16, attended: 1 });

  const after = await call(`/payroll/summary?month=${MONTH}`, { token: tokens.admin });
  const linhAfter = after.data.entries.find((x) => x.trainerId.toString() === linhTrainerId.toString());
  assert.equal(linhAfter.pt1.count, linhBefore.pt1.count + 1, "không còn chốt — số luôn theo điểm danh hiện tại");
  assert.ok(!("closed" in after.data), "response không còn khái niệm chốt");
  // /my của HLV cũng là số động, không còn khái niệm chốt
  const my = await call(`/payroll/my?month=${MONTH}`, { token: tokens.trainer });
  assert.equal(my.data.entry.pt1.count, linhAfter.pt1.count);
  assert.ok(!("closed" in my.data), "/my không còn field closed");
  // Endpoint chốt đã bị XOÁ — khoá vĩnh viễn (review her-16 A3)
  assert.equal((await call("/payroll/close", { method: "POST", token: tokens.admin, body: { month: MONTH } })).status, 404);
});

// ---------- 11. Buổi đổi HLV ----------

test("coach-swap: buổi bị đổi HLV tính cho người DẠY THẬT (trainerId trên booking)", async () => {
  // Buổi tạo dưới tên otherTrainer nhưng booking.trainerId đã sync sang Linh (mô phỏng đổi HLV)
  const { bookings } = await makeSession({ trainerId: otherTrainerId, kind: "pt1", day: 18, attended: 1 });
  await Booking.updateMany({ _id: { $in: bookings.map((b) => b._id) } }, { $set: { trainerId: linhTrainerId } });

  const r = await call(`/payroll/summary?month=${MONTH}`, { token: tokens.admin });
  const linh = r.data.entries.find((x) => x.trainerId.toString() === linhTrainerId.toString());
  assert.equal(linh.pt1.count, 4, "buổi đổi HLV phải về tay Linh");
});

// ---------- 12. Input rác ----------

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
  await PTSlot.deleteMany({ trainerId: linhTrainerId, startAt: { $lt: swapEnd }, endAt: { $gt: swapStart } });
  const cls = await GymClass.create({
    name: "Lop swap payroll", serviceType: "pilates", coachId: otherTrainerId,
    startAt: swapStart, endAt: swapEnd, capacity: 5, bookedCount: 2,
  });
  const kh = await User.findOne({ phone: "0909090909" });
  const mk = (status, attendanceAt) => ({
    userId: kh._id, type: "group", classId: cls._id, trainerId: otherTrainerId,
    title: cls.name, startAt: cls.startAt, endAt: cls.endAt, status, attendanceAt,
  });
  const preR = await call(`/payroll/summary?month=${MONTH}`, { token: tokens.admin });
  const preSwap = {
    duc: preR.data.entries.find((x) => x.trainerId.toString() === otherTrainerId.toString()).group.count,
    linh: preR.data.entries.find((x) => x.trainerId.toString() === linhTrainerId.toString()).group.count,
  };
  const [b1] = await Booking.insertMany([mk("completed", new Date()), mk("booked", null)]);

  // Admin đổi HLV lớp sang Linh (qua API — code sync phải kéo CẢ booking điểm danh sớm)
  const sw = await call(`/schedule/classes/${cls._id}`, {
    method: "PATCH", token: tokens.admin, body: { coachId: linhTrainerId.toString() },
  });
  assert.equal(sw.status, 200, JSON.stringify(sw.data));
  assert.equal((await Booking.findById(b1._id)).trainerId.toString(), linhTrainerId.toString(),
    "booking điểm danh SỚM (buổi chưa diễn ra) phải sang HLV mới");

  // So sánh DELTA với trước khi tạo lớp (các test trước đã cho Đức buổi group riêng)
  const snap = async () => {
    const r = await call(`/payroll/summary?month=${MONTH}`, { token: tokens.admin });
    return {
      duc: r.data.entries.find((x) => x.trainerId.toString() === otherTrainerId.toString()).group.count,
      linh: r.data.entries.find((x) => x.trainerId.toString() === linhTrainerId.toString()).group.count,
    };
  };
  const after = await snap();
  assert.equal(after.duc, preSwap.duc, "HLV cũ không được tính buổi đã chuyển giao");
  assert.ok(after.linh > preSwap.linh, "HLV mới (người dạy thật) hưởng buổi này");
});

test("review-fix (V2): khung 1:1 có khách điểm danh sớm rồi NÂNG capacity — cùng slot chỉ 1 buổi PT nhóm", async () => {
  const before = await call(`/payroll/summary?month=${MONTH}`, { token: tokens.admin });
  const eBefore = before.data.entries.find((x) => x.trainerId.toString() === otherTrainerId.toString());
  const slot = await PTSlot.create({
    trainerId: otherTrainerId, startAt: hoursFromNow(5), endAt: hoursFromNow(6), capacity: 1, bookedCount: 1,
  });
  const kh = await User.findOne({ phone: "0909090909" });
  const mk = (title, status, attendanceAt) => ({
    userId: kh._id, type: "pt", slotId: slot._id, trainerId: otherTrainerId,
    title, startAt: slot.startAt, endAt: slot.endAt, status, attendanceAt,
  });
  // Khách 1 đặt khi còn 1:1, được điểm danh SỚM
  await Booking.insertMany([mk("1:1 PT — HLV X", "completed", new Date())]);
  // Quầy nâng capacity 1 -> 3 (API — sync title phải kéo cả booking completed chưa diễn ra)
  const up = await call(`/schedule/pt-slots/${slot._id}`, { method: "PATCH", token: tokens.staff, body: { capacity: 3 } });
  assert.equal(up.status, 200, JSON.stringify(up.data));
  const b1 = await Booking.findOne({ slotId: slot._id });
  assert.match(b1.title, /^PT nhóm — /, "title booking điểm danh sớm phải đồng bộ theo dạng khung mới");
  // Khách 2 đặt sau khi đã là nhóm, cũng điểm danh
  await Booking.insertMany([mk(b1.title, "completed", new Date())]);

  const r = await call(`/payroll/summary?month=${MONTH}`, { token: tokens.admin });
  const e = r.data.entries.find((x) => x.trainerId.toString() === otherTrainerId.toString());
  // per hiện hành của Đức là attendee (test per-attendee) -> buổi nhóm 2 khách = 2 đơn vị,
  // và KHÔNG có buổi pt1 lẻ nào phát sinh từ cùng slot
  assert.equal(e.pt1.count, eBefore.pt1.count, "không được tách cùng slot thành thêm buổi 1:1");
  assert.equal(e.ptGroup.count, eBefore.ptGroup.count + 2, "1 buổi nhóm 2 khách (per=attendee) = +2 đơn vị");
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
    trainerId: fresh._id, baseSalary: 0, groupAmount: 0, groupPer: "session",
    pt1Amount: 100000, ptGroupAmount: 0, ptGroupPer: "session", effectiveFrom: new Date(2020, 0, 1),
  });
  for (const st of [prevEnd, firstDay]) {
    const slot = await PTSlot.create({ trainerId: fresh._id, startAt: st, endAt: new Date(st.getTime() + 3600000), capacity: 1, bookedCount: 1 });
    await Booking.insertMany([{ userId: kh._id, type: "pt", slotId: slot._id, trainerId: fresh._id, title: "1:1 PT — X", startAt: st, endAt: new Date(st.getTime() + 3600000), status: "completed", attendanceAt: st }]);
  }
  const cur = await call(`/payroll/summary?month=${MONTH}`, { token: tokens.admin });
  const prev = await call(`/payroll/summary?month=${prevMonthStr}`, { token: tokens.admin });
  const eCur = cur.data.entries.find((x) => x.trainerName === "HLV Bien Thang");
  const ePrev = prev.data.entries.find((x) => x.trainerName === "HLV Bien Thang");
  assert.equal(eCur.pt1.count, 1, "chỉ buổi 00:30 ngày 1 thuộc tháng này");
  assert.equal(ePrev.pt1.count, 1, "buổi 23:30 thuộc tháng trước");
});
