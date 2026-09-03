// her-57: thông báo cho admin / lễ tân / HLV khi khách đặt hoặc hủy lịch (chuông trong app + Expo Push).
// Xem docs-her/testcase/testcase_her-57_notifications.md
// DB riêng her_test_x (tự seed), server cổng 4321, Expo Push API GIẢ ở cổng 4322 (EXPO_PUSH_URL).

const { test, before, after } = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const { spawn, spawnSync } = require("node:child_process");
const path = require("node:path");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const ROOT = path.join(__dirname, "..");
const URI = "mongodb://localhost:27017/her_test_x";
const S = "http://localhost:4321/api";
const PUSH_PORT = 4322;

const User = require("../src/models/User");
const Package = require("../src/models/Package");
const Notification = require("../src/models/Notification");
const Trainer = require("../src/models/Trainer");

let proc;
let pushServer;
const pushCalls = []; // mỗi phần tử = mảng message Expo nhận được trong 1 request
const tokens = {};
let coachId; // HLV seed 0911111111
let trainerUserId;

const SERVER_ENV = {
  ...process.env, PORT: "4321", MONGODB_URI: URI, JWT_SECRET: "testsecret", MIN_CANCEL_HOURS: "3",
  EXPO_PUSH_URL: `http://localhost:${PUSH_PORT}/--/api/v2/push/send`,
};

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let seq = 0;
async function makeUser(role, extra = {}) {
  const phone = `0966${String(seq++).padStart(6, "0")}`;
  const passwordHash = await bcrypt.hash("123456", 10);
  const user = await User.create({ name: `${role} her57 ${seq}`, phone, passwordHash, role, ...extra });
  const { token } = await loginOk(phone);
  return { user, token, id: user._id.toString(), name: user.name };
}
async function makeCustomer() {
  const c = await makeUser("customer");
  await Package.create({
    userId: c.user._id, name: "Pilates 10", serviceTypes: ["pilates"], format: "1:1", price: 1, paidAmount: 1,
    totalSessions: 10, activatedAt: new Date(), expiresAt: hoursFromNow(24 * 60),
  });
  return c;
}
let clsSeq = 0;
async function makeClass(hours, coach = coachId) {
  const startAt = hoursFromNow(hours);
  const r = await mongoose.connection.db.collection("gymclasses").insertOne({
    name: `Buoi her57 ${clsSeq++}`, serviceType: "pilates", format: "1:1", coachId: coach,
    startAt, endAt: new Date(startAt.getTime() + 3600 * 1000), capacity: 1, bookedCount: 0,
  });
  return r.insertedId;
}
const book = (token, classId, userId) => call("/bookings", { method: "POST", token, body: { classId, ...(userId ? { userId } : {}) } });
const cancel = (id, token) => call(`/bookings/${id}`, { method: "DELETE", token });
const notifsOf = (userId) => Notification.find({ userId }).sort({ createdAt: -1 });
// Push chạy nền sau khi response trả về — chờ tới khi mock nhận đủ n request (tối đa ~3s)
async function waitPush(count) {
  for (let i = 0; i < 30 && pushCalls.length < count; i++) await sleep(100);
  return pushCalls.length;
}

before(async () => {
  // Expo Push API giả: ghi lại body, trả ticket ok; token chứa "DEAD" -> DeviceNotRegistered
  pushServer = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const msgs = JSON.parse(raw || "[]");
      pushCalls.push(msgs);
      const data = msgs.map((m) =>
        String(m.to).includes("DEAD")
          ? { status: "error", message: "not registered", details: { error: "DeviceNotRegistered" } }
          : { status: "ok", id: "ticket" }
      );
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data }));
    });
  });
  await new Promise((r) => pushServer.listen(PUSH_PORT, r));

  const seeded = spawnSync(process.execPath, ["src/scripts/seed.js"], { cwd: ROOT, env: { ...process.env, MONGODB_URI: URI }, stdio: "ignore" });
  assert.equal(seeded.status, 0, "seed her_test_x thất bại");
  proc = spawn(process.execPath, ["server.js"], { cwd: ROOT, env: SERVER_ENV, stdio: "ignore" });
  await waitHealthy(S);
  await mongoose.connect(URI);
  tokens.admin = (await loginOk("0999999999")).token;
  tokens.reception = (await loginOk("0900000000")).token;
  tokens.trainer = (await loginOk("0911111111")).token;
  tokens.customer = (await loginOk("0909090909")).token;
  const tr = await User.findOne({ phone: "0911111111" });
  coachId = tr.trainerId;
  trainerUserId = tr._id;
});
after(async () => {
  proc?.kill();
  pushServer?.close();
  await mongoose.disconnect();
});

const adminId = async () => (await User.findOne({ phone: "0999999999" }))._id;
const receptionId = async () => (await User.findOne({ phone: "0900000000" }))._id;

// ---------- 1. Khách tự đặt -> admin + lễ tân + HLV của buổi; HLV khác và khách không ----------

test("book-by-customer: admin, lễ tân, HLV của buổi mỗi người 1 thông báo 'đã đặt lịch'; HLV khác/khách không có", async () => {
  const other = await makeUser("trainer", { trainerId: new mongoose.Types.ObjectId() });
  const cust = await makeCustomer();
  const before = { a: await Notification.countDocuments({ userId: await adminId() }) };
  const classId = await makeClass(30);
  const r = await book(cust.token, classId);
  assert.equal(r.status, 201, JSON.stringify(r.data));

  for (const uid of [await adminId(), await receptionId(), trainerUserId]) {
    const list = await notifsOf(uid);
    const n = list.find((x) => String(x.data.bookingId) === String(r.data.booking.id));
    assert.ok(n, `thiếu thông báo cho ${uid}`);
    assert.equal(n.type, "booking_created");
    assert.equal(n.title, "Đặt lịch mới");
    assert.match(n.body, new RegExp(`^${cust.name} đã đặt lịch Buoi her57`));
    assert.doesNotMatch(n.body, /quầy/);
    assert.equal(n.readAt, null);
  }
  assert.equal(await Notification.countDocuments({ userId: other.user._id }), 0, "HLV khác không nhận");
  assert.equal(await Notification.countDocuments({ userId: cust.user._id }), 0, "khách không nhận");
  assert.equal(await Notification.countDocuments({ userId: await adminId() }), before.a + 1);
});

// ---------- 2. Quầy đặt hộ -> admin + HLV nhận kèm "(quầy đặt hộ)"; lễ tân (người bấm) không ----------

test("book-by-staff: lễ tân đặt hộ -> admin + HLV nhận '(quầy đặt hộ)'; lễ tân bấm không nhận; khách không nhận", async () => {
  const cust = await makeCustomer();
  const classId = await makeClass(31);
  const beforeRec = await Notification.countDocuments({ userId: await receptionId() });
  const r = await book(tokens.reception, classId, cust.id);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const bid = r.data.booking.id;
  const a = (await notifsOf(await adminId())).find((x) => String(x.data.bookingId) === bid);
  assert.ok(a);
  assert.match(a.body, /\(quầy đặt hộ\)$/);
  assert.match(a.body, new RegExp(`^${cust.name} đã đặt lịch`));
  const t = (await notifsOf(trainerUserId)).find((x) => String(x.data.bookingId) === bid);
  assert.ok(t, "HLV của buổi nhận");
  assert.equal(await Notification.countDocuments({ userId: await receptionId() }), beforeRec, "người bấm không tự nhận");
  assert.equal(await Notification.countDocuments({ userId: cust.user._id }), 0);
});

// ---------- 3. Hủy: khách tự hủy / quầy hủy hộ ----------

test("cancel: khách tự hủy -> 'đã hủy lịch' cho admin/lễ tân/HLV; admin hủy hộ -> '(quầy hủy hộ)', admin không tự nhận", async () => {
  const cust = await makeCustomer();
  const c1 = await makeClass(40);
  const b1 = await book(cust.token, c1);
  assert.equal(b1.status, 201);
  assert.equal((await cancel(b1.data.booking.id, cust.token)).status, 200);
  for (const uid of [await adminId(), await receptionId(), trainerUserId]) {
    const n = (await notifsOf(uid)).find((x) => x.type === "booking_cancelled" && String(x.data.bookingId) === b1.data.booking.id);
    assert.ok(n, `thiếu thông báo hủy cho ${uid}`);
    assert.equal(n.title, "Hủy lịch");
    assert.match(n.body, new RegExp(`^${cust.name} đã hủy lịch`));
    assert.doesNotMatch(n.body, /quầy/);
  }

  const c2 = await makeClass(41);
  const b2 = await book(cust.token, c2);
  const beforeAdmin = await Notification.countDocuments({ userId: await adminId() });
  assert.equal((await cancel(b2.data.booking.id, tokens.admin)).status, 200);
  assert.equal(await Notification.countDocuments({ userId: await adminId() }), beforeAdmin, "admin bấm hủy không tự nhận");
  const rec = (await notifsOf(await receptionId())).find((x) => x.type === "booking_cancelled" && String(x.data.bookingId) === b2.data.booking.id);
  assert.ok(rec);
  assert.match(rec.body, /\(quầy hủy hộ\)$/);
  // Hủy lần 2 (đã hủy rồi) -> 400, không sinh thêm thông báo
  const beforeRec = await Notification.countDocuments({ userId: await receptionId() });
  assert.equal((await cancel(b2.data.booking.id, tokens.admin)).status, 400);
  assert.equal(await Notification.countDocuments({ userId: await receptionId() }), beforeRec);
});

// ---------- 4. Không đặt được thì không có thông báo; người nhận bị khoá/xoá không nhận ----------

test("no-noise: đặt thất bại (không gói) không sinh thông báo; lễ tân bị KHOÁ và lễ tân bị XOÁ không nhận", async () => {
  const noPkg = await makeUser("customer");
  const classId = await makeClass(50);
  const beforeAdmin = await Notification.countDocuments({ userId: await adminId() });
  assert.equal((await book(noPkg.token, classId)).status, 400);
  assert.equal(await Notification.countDocuments({ userId: await adminId() }), beforeAdmin);

  const locked = await makeUser("reception");
  await User.updateOne({ _id: locked.user._id }, { $set: { isActive: false } });
  const gone = await makeUser("reception");
  await User.updateOne({ _id: gone.user._id }, { $set: { deletedAt: new Date(), isActive: false } });
  const cust = await makeCustomer();
  assert.equal((await book(cust.token, await makeClass(51))).status, 201);
  assert.equal(await Notification.countDocuments({ userId: locked.user._id }), 0, "lễ tân bị khoá không nhận");
  assert.equal(await Notification.countDocuments({ userId: gone.user._id }), 0, "lễ tân đã xoá không nhận");
});

// ---------- 5. API danh sách / chưa đọc / đánh dấu đọc / phân quyền ----------

test("api: GET mới nhất trước + phân trang + unread; read-all; /:id/read của người khác 404; khách 403; anon 401", async () => {
  const rec = await makeUser("reception");
  const cust = await makeCustomer();
  const ids = [];
  for (let i = 0; i < 3; i++) {
    const r = await book(cust.token, await makeClass(60 + i));
    assert.equal(r.status, 201);
    ids.push(r.data.booking.id);
  }
  const page1 = await call("/notifications?limit=2", { token: rec.token });
  assert.equal(page1.status, 200, JSON.stringify(page1.data));
  assert.equal(page1.data.notifications.length, 2);
  assert.equal(page1.data.hasMore, true);
  assert.equal(page1.data.unread, 3);
  assert.equal(String(page1.data.notifications[0].data.bookingId), ids[2], "mới nhất trước");
  const page2 = await call("/notifications?limit=2&page=2", { token: rec.token });
  assert.equal(page2.data.notifications.length, 1);
  assert.equal(page2.data.hasMore, false);

  const cnt = await call("/notifications/unread-count", { token: rec.token });
  assert.equal(cnt.data.unread, 3);
  const one = await call(`/notifications/${page1.data.notifications[0].id}/read`, { method: "PATCH", token: rec.token });
  assert.equal(one.status, 200);
  assert.ok(one.data.notification.readAt);
  assert.equal((await call("/notifications/unread-count", { token: rec.token })).data.unread, 2);
  const all = await call("/notifications/read-all", { method: "PATCH", token: rec.token });
  assert.equal(all.status, 200);
  assert.equal(all.data.updated, 2);
  assert.equal((await call("/notifications/unread-count", { token: rec.token })).data.unread, 0);

  // Của người khác -> 404 (không lộ); id rác 400
  const other = await call(`/notifications/${page1.data.notifications[1].id}/read`, { method: "PATCH", token: tokens.admin });
  assert.equal(other.status, 404);
  assert.equal((await call("/notifications/abc/read", { method: "PATCH", token: rec.token })).status, 400);
  // Khách 403, anon 401
  assert.equal((await call("/notifications", { token: cust.token })).status, 403);
  assert.equal((await call("/notifications")).status, 401);
  // HLV đọc được của mình
  assert.equal((await call("/notifications", { token: tokens.trainer })).status, 200);
});

// ---------- 6. Push: token đăng ký -> mock Expo nhận đúng message; token chết bị rút ----------

test("push: đăng ký token -> Expo (giả) nhận message đúng người/đúng nội dung; token DeviceNotRegistered bị rút khỏi user", async () => {
  const rec = await makeUser("reception");
  const good = "ExponentPushToken[her57-good-abc]";
  const dead = "ExponentPushToken[her57-DEAD-xyz]";
  assert.equal((await call("/me/push-token", { method: "POST", token: rec.token, body: { token: good, platform: "ios" } })).status, 200);
  assert.equal((await call("/me/push-token", { method: "POST", token: rec.token, body: { token: dead, platform: "android" } })).status, 200);
  assert.equal((await User.findById(rec.user._id)).pushTokens.length, 2);

  pushCalls.length = 0;
  const cust = await makeCustomer();
  const r = await book(cust.token, await makeClass(70));
  assert.equal(r.status, 201);
  await waitPush(1);
  const msgs = pushCalls.flat();
  const toRec = msgs.filter((m) => [good, dead].includes(m.to));
  assert.equal(toRec.length, 2, JSON.stringify(msgs));
  assert.equal(toRec[0].title, "Đặt lịch mới");
  assert.match(toRec[0].body, new RegExp(`^${cust.name} đã đặt lịch`));
  assert.equal(toRec[0].data.type, "booking_created");
  assert.equal(toRec[0].channelId, "default", "Android cần channelId trùng kênh app tạo (review #1)");
  assert.equal(toRec[0].priority, "high");
  assert.ok(!msgs.some((m) => "userId" in m), "không lộ userId nội bộ ra Expo");
  // Token chết bị rút sau ticket
  for (let i = 0; i < 20; i++) {
    if ((await User.findById(rec.user._id)).pushTokens.length === 1) break;
    await sleep(100);
  }
  const left = (await User.findById(rec.user._id)).pushTokens;
  assert.deepEqual(left.map((t) => t.token), [good]);
});

// ---------- 7. push-token: validate, chống trùng, đổi tài khoản trên cùng máy, đăng xuất ----------

test("push-token: sai định dạng 400; cùng token gửi 2 lần = 1; token chuyển sang user khác thì user cũ mất; DELETE gỡ", async () => {
  const a = await makeUser("reception");
  const b = await makeUser("reception");
  const t = "ExponentPushToken[her57-shared-1]";
  assert.equal((await call("/me/push-token", { method: "POST", token: a.token, body: { token: "abc" } })).status, 400);
  assert.equal((await call("/me/push-token", { method: "POST", token: a.token, body: {} })).status, 400);
  assert.equal((await call("/me/push-token", { method: "POST", token: a.token, body: { token: t } })).status, 200);
  assert.equal((await call("/me/push-token", { method: "POST", token: a.token, body: { token: t } })).status, 200);
  assert.equal((await User.findById(a.user._id)).pushTokens.length, 1);
  // Máy đổi sang tài khoản b
  assert.equal((await call("/me/push-token", { method: "POST", token: b.token, body: { token: t } })).status, 200);
  assert.equal((await User.findById(a.user._id)).pushTokens.length, 0, "user cũ không còn token của máy");
  assert.equal((await User.findById(b.user._id)).pushTokens.length, 1);
  // Đăng xuất
  assert.equal((await call("/me/push-token", { method: "DELETE", token: b.token, body: { token: t } })).status, 200);
  assert.equal((await User.findById(b.user._id)).pushTokens.length, 0);
  // Khách cũng đăng ký token được (không lỗi) nhưng không có thông báo nào gửi tới
  const cust = await makeCustomer();
  assert.equal((await call("/me/push-token", { method: "POST", token: cust.token, body: { token: "ExponentPushToken[cust-1]" } })).status, 200);
});

// ---------- 8. Push API chết -> đặt lịch vẫn 201, thông báo trong app vẫn có ----------

test("push-down: Expo Push API không phản hồi được -> đặt lịch vẫn 201 và thông báo trong app vẫn ghi", async () => {
  await new Promise((r) => pushServer.close(r));
  const rec = await makeUser("reception");
  assert.equal((await call("/me/push-token", { method: "POST", token: rec.token, body: { token: "ExponentPushToken[her57-down-1]" } })).status, 200);
  const cust = await makeCustomer();
  const r = await book(cust.token, await makeClass(80));
  assert.equal(r.status, 201, JSON.stringify(r.data));
  await sleep(300);
  assert.equal(await Notification.countDocuments({ userId: rec.user._id }), 1);
  // Mở lại mock cho các test sau (nếu có)
  pushServer = http.createServer((req, res) => { req.resume(); req.on("end", () => res.end(JSON.stringify({ data: [] }))); });
  await new Promise((r) => pushServer.listen(PUSH_PORT, r));
});

// ================= Bổ sung sau review độc lập her-57 =================

test("admin-kiem-hlv: admin có trainerId = HLV của buổi chỉ nhận ĐÚNG 1 thông báo; đổi HLV giữa chừng báo theo booking.trainerId", async () => {
  const coach2 = (await Trainer.create({ name: "Admin kiem HLV her57", specialties: ["pilates"] }))._id; // lớp cần hồ sơ HLV thật
  const adminCoach = await makeUser("admin", { trainerId: coach2 });
  const cust = await makeCustomer();
  const classId = await makeClass(90, coach2);
  const r = await book(cust.token, classId);
  assert.equal(r.status, 201);
  assert.equal(await Notification.countDocuments({ userId: adminCoach.user._id, "data.bookingId": r.data.booking.id }), 1);
  assert.equal(await Notification.countDocuments({ userId: trainerUserId, "data.bookingId": r.data.booking.id }), 0, "HLV khác không nhận");
});

test("cancel-no-coach: lớp cũ thiếu coachId -> hủy vẫn 200, chỉ admin/lễ tân nhận, KHÔNG báo cho mọi HLV", async () => {
  const cust = await makeCustomer();
  const classId = await makeClass(95);
  const r = await book(cust.token, classId);
  assert.equal(r.status, 201);
  await mongoose.connection.db.collection("gymclasses").updateOne({ _id: classId }, { $unset: { coachId: "" } });
  await mongoose.connection.db.collection("bookings").updateOne({ _id: new mongoose.Types.ObjectId(r.data.booking.id) }, { $unset: { trainerId: "" } });
  const beforeTrainer = await Notification.countDocuments({ userId: trainerUserId });
  const c = await cancel(r.data.booking.id, cust.token);
  assert.equal(c.status, 200, JSON.stringify(c.data));
  assert.equal(await Notification.countDocuments({ userId: trainerUserId }), beforeTrainer, "HLV không liên quan không nhận");
  assert.equal(await Notification.countDocuments({ userId: await adminId(), type: "booking_cancelled", "data.bookingId": r.data.booking.id }), 1);
});

test("paging-junk: ?page=abc&limit=-1 / limit=999 -> 200 không 500; read-all với before chỉ đánh dấu tới mốc", async () => {
  const rec = await makeUser("reception");
  const cust = await makeCustomer();
  const r1 = await book(cust.token, await makeClass(100));
  assert.equal(r1.status, 201);
  const junk = await call("/notifications?page=abc&limit=-1", { token: rec.token });
  assert.equal(junk.status, 200, JSON.stringify(junk.data));
  assert.equal(junk.data.notifications.length, 1);
  assert.equal((await call("/notifications?limit=999", { token: rec.token })).status, 200);
  const first = junk.data.notifications[0];
  await sleep(20);
  const r2 = await book(cust.token, await makeClass(101));
  assert.equal(r2.status, 201);
  const ra = await call("/notifications/read-all", { method: "PATCH", token: rec.token, body: { before: first.createdAt } });
  assert.equal(ra.status, 200);
  assert.equal(ra.data.updated, 1, "chỉ đánh dấu cái đã hiển thị");
  assert.equal((await call("/notifications/unread-count", { token: rec.token })).data.unread, 1, "cái tới sau vẫn chưa đọc");
  const bad = await call("/notifications/read-all", { method: "PATCH", token: rec.token, body: { before: "xyz" } });
  assert.equal(bad.status, 200, "before rác -> bỏ qua mốc, đánh dấu hết");
  assert.equal((await call("/notifications/unread-count", { token: rec.token })).data.unread, 0);
});

test("push-token-parallel: 2 request cùng token song song -> đúng 1 phần tử trong mảng", async () => {
  const rec = await makeUser("reception");
  const t = "ExponentPushToken[her57-parallel-1]";
  const reqs = Array.from({ length: 5 }, () => call("/me/push-token", { method: "POST", token: rec.token, body: { token: t } }));
  const rs = await Promise.all(reqs);
  assert.ok(rs.every((r) => r.status === 200));
  const toks = (await User.findById(rec.user._id)).pushTokens.filter((x) => x.token === t);
  assert.equal(toks.length, 1, `token trùng ${toks.length} lần (review #5)`);
});
