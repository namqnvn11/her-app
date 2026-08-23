// her-47: admin tự chỉnh số giờ hủy tối thiểu trong Cài đặt — xem
// docs-her/testcase/testcase_her-47_cancel_hours_setting.md
// DB riêng her_test_t (tự seed), server cổng 4281, env MIN_CANCEL_HOURS=3 (giá trị mặc định).

const { test, before, after } = require("node:test");
const assert = require("node:assert");
const { spawn, spawnSync } = require("node:child_process");
const path = require("node:path");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const ROOT = path.join(__dirname, "..");
const URI = "mongodb://localhost:27017/her_test_t";
const S = "http://localhost:4281/api";

const User = require("../src/models/User");
const Package = require("../src/models/Package");
const Booking = require("../src/models/Booking");

let proc;
const tokens = {};
const SERVER_ENV = { ...process.env, PORT: "4281", MONGODB_URI: URI, JWT_SECRET: "testsecret", MIN_CANCEL_HOURS: "3", SETTINGS_CACHE_MS: "1500" };
const startServer = () => spawn(process.execPath, ["server.js"], { cwd: ROOT, env: SERVER_ENV, stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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

async function login(phone, password = "123456") {
  const r = await call("/auth/login", { method: "POST", body: { phone, password } });
  assert.equal(r.status, 200, `login ${phone}: ${JSON.stringify(r.data)}`);
  return r.data;
}

const hoursFromNow = (h) => new Date(Date.now() + h * 3600 * 1000);
const setHours = (v, token = tokens.admin) => call("/settings", { method: "PATCH", token, body: { minCancelHours: v } });

// Khách mới + gói Pilates 1:1 (mỗi khách 1 gói riêng để kiểm tra hoàn buổi đúng gói)
let custSeq = 0;
async function makeCustomer() {
  const phone = `0969${String(custSeq++).padStart(6, "0")}`;
  const passwordHash = await bcrypt.hash("123456", 10);
  const user = await User.create({ name: `Khach her47 ${custSeq}`, phone, passwordHash, role: "customer" });
  const pkg = await Package.create({
    userId: user._id, name: "Pilates 1:1 her47", serviceTypes: ["pilates"], format: "1:1",
    price: 1000000, totalSessions: 10, activatedAt: new Date(), expiresAt: hoursFromNow(24 * 30),
  });
  const { token } = await login(phone);
  return { user, pkg, token };
}

// Buổi 1:1 chèn thẳng DB (luật "HLV không trùng giờ" không liên quan test này) — cách `hours` giờ
let clsSeq = 0;
async function makeClass(hours) {
  const startAt = hoursFromNow(hours);
  const r = await mongoose.connection.db.collection("gymclasses").insertOne({
    name: `Buoi her47 ${clsSeq++}`, serviceType: "pilates", format: "1:1", coachId,
    startAt, endAt: new Date(startAt.getTime() + 3600 * 1000), capacity: 1, bookedCount: 0,
  });
  return r.insertedId.toString();
}

// Khách đặt 1 buổi cách `hours` giờ, trả về id booking
async function bookAt(cust, hours) {
  const classId = await makeClass(hours);
  const r = await call("/bookings", { method: "POST", token: cust.token, body: { classId } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data.booking.id;
}
const cancel = (id, token) => call(`/bookings/${id}`, { method: "DELETE", token });
const usedOf = async (pkgId) => (await Package.findById(pkgId)).usedSessions;

before(async () => {
  const seeded = spawnSync(process.execPath, ["src/scripts/seed.js"], {
    cwd: ROOT, env: { ...process.env, MONGODB_URI: URI }, stdio: "ignore",
  });
  assert.equal(seeded.status, 0, "seed her_test_t thất bại");
  proc = startServer();
  await waitHealthy(S);
  await mongoose.connect(URI);

  tokens.admin = (await login("0999999999")).token;
  tokens.reception = (await login("0900000000")).token;
  tokens.trainer = (await login("0911111111")).token;
  tokens.customer = (await login("0909090909")).token;
  coachId = (await User.findOne({ phone: "0911111111" })).trainerId;
});

after(async () => {
  proc?.kill();
  await mongoose.disconnect();
});

// ---------- 1. Mặc định: DB trống -> lấy env (D4, L10) ----------

test("default-env: chưa có settings trong DB -> GET /settings và config ở login = env MIN_CANCEL_HOURS (3)", async () => {
  assert.equal(await mongoose.connection.db.collection("settings").countDocuments(), 0);
  const r = await call("/settings", { token: tokens.admin });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.minCancelHours, 3);
  const c = await login("0909090909");
  assert.equal(c.config.minCancelHours, 3);
});

// ---------- 2. Ma trận 4 role (H5, L14) ----------

test("role-matrix: chỉ admin đọc/sửa được /settings; lễ tân/HLV/khách 403; không token 401", async () => {
  for (const role of ["reception", "trainer", "customer"]) {
    const g = await call("/settings", { token: tokens[role] });
    assert.equal(g.status, 403, `${role} GET phải 403`);
    assert.ok(g.data.error, `${role} GET phải có { error }`);
    const p = await setHours(1, tokens[role]);
    assert.equal(p.status, 403, `${role} PATCH phải 403`);
    assert.ok(p.data.error);
  }
  const noTok = await call("/settings");
  assert.equal(noTok.status, 401);
  // Sau loạt tấn công, giá trị vẫn là mặc định
  assert.equal((await call("/settings", { token: tokens.admin })).data.minCancelHours, 3);
});

// ---------- 3 + 4 + 10. Lưu 5 -> công bố ngay, luật hủy dùng 5 ngay (D7, L8, L10) ----------

test("save-5 + rule-5-block: admin đặt 5 -> GET/login//me công bố 5; khách hủy lịch cách 4h bị chặn với câu '5 tiếng'", async () => {
  const r = await setHours(5);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.minCancelHours, 5);
  assert.equal((await call("/settings", { token: tokens.admin })).data.minCancelHours, 5);

  const cust = await makeCustomer();
  const me = await call("/me", { token: cust.token });
  assert.equal(me.data.config.minCancelHours, 5, "/me của KHÁCH phải công bố 5 ngay, không cần restart");
  assert.equal((await login("0909090909")).config.minCancelHours, 5);

  const id = await bookAt(cust, 4);
  const c = await cancel(id, cust.token);
  assert.equal(c.status, 403);
  assert.match(c.data.error, /5 tiếng/);
  assert.doesNotMatch(c.data.error, /3 tiếng/);
  assert.equal(await usedOf(cust.pkg._id), 1, "bị chặn thì KHÔNG hoàn buổi");
});

// ---------- 5. Giảm xuống 1 -> hủy được + hoàn đúng gói (H1, C2) ----------

test("rule-1-allow: admin đặt 1 -> khách hủy lịch cách 2h thành công, buổi cộng lại đúng gói", async () => {
  assert.equal((await setHours(1)).status, 200);
  const cust = await makeCustomer();
  const id = await bookAt(cust, 2);
  assert.equal(await usedOf(cust.pkg._id), 1);
  const c = await cancel(id, cust.token);
  assert.equal(c.status, 200, JSON.stringify(c.data));
  assert.equal(await usedOf(cust.pkg._id), 0, "hủy thành công phải hoàn buổi về gói đã trừ");
  assert.equal((await Booking.findById(id)).status, "cancelled");
});

// ---------- 6. = 0 -> hủy được bất kỳ lúc nào trước giờ tập (D6) ----------

test("rule-0: admin đặt 0 -> khách hủy lịch cách 10 phút thành công", async () => {
  const r = await setHours(0);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.minCancelHours, 0);
  const cust = await makeCustomer();
  const id = await bookAt(cust, 10 / 60);
  assert.equal((await cancel(id, cust.token)).status, 200);
});

// ---------- 7. Biên đúng mốc (skill bắt buộc) ----------

test("boundary: min=2 -> lịch cách 2h00 + 5s hủy được; cách 1h59 bị chặn", async () => {
  assert.equal((await setHours(2)).status, 200);
  const cust = await makeCustomer();
  const okId = await bookAt(cust, 2 + 5 / 3600);
  assert.equal((await cancel(okId, cust.token)).status, 200);
  const cust2 = await makeCustomer();
  const noId = await bookAt(cust2, 119 / 60);
  const c = await cancel(noId, cust2.token);
  assert.equal(c.status, 403);
  assert.match(c.data.error, /2 tiếng/);
});

// ---------- 8. Input bất thường (L1, D6) ----------

test("bad-input: sai kiểu / ngoài khoảng -> 400 { error }, giá trị cũ giữ nguyên", async () => {
  assert.equal((await setHours(4)).status, 200);
  const bad = ["abc", null, undefined, 2.5, -1, 73, "5", true, {}, []];
  for (const v of bad) {
    const r = await call("/settings", { method: "PATCH", token: tokens.admin, body: v === undefined ? {} : { minCancelHours: v } });
    assert.equal(r.status, 400, `giá trị ${JSON.stringify(v)} phải bị 400`);
    assert.ok(r.data && r.data.error, `giá trị ${JSON.stringify(v)} phải có { error }`);
  }
  // Body không phải JSON hợp lệ cũng không treo
  const raw = await fetch(S + "/settings", {
    method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokens.admin}` }, body: "{oops",
  });
  assert.ok(raw.status >= 400 && raw.status < 500);
  assert.equal((await call("/settings", { token: tokens.admin })).data.minCancelHours, 4, "giá trị cũ phải giữ nguyên");
  // Biên hợp lệ: 72 được
  assert.equal((await setHours(72)).data.minCancelHours, 72);
});

// ---------- 9. Quầy hủy hộ không bị giới hạn (H1) ----------

test("staff-unlimited: min=24 -> lễ tân và admin hủy hộ lịch khách cách 2h vẫn thành công", async () => {
  assert.equal((await setHours(24)).status, 200);
  const cust = await makeCustomer();
  const id1 = await bookAt(cust, 2);
  assert.equal((await cancel(id1, cust.token)).status, 403, "khách tự hủy phải bị chặn");
  assert.equal((await cancel(id1, tokens.reception)).status, 200, "lễ tân hủy hộ không giới hạn giờ");
  const id2 = await bookAt(cust, 5);
  assert.equal((await cancel(id2, tokens.admin)).status, 200, "admin hủy hộ không giới hạn giờ");
  assert.equal(await usedOf(cust.pkg._id), 0);
});

// ---------- Bổ sung sau review độc lập (23/08) ----------

test("parallel-patch: 6 PATCH song song (kể cả khi collection trống) -> tất cả 200, vẫn đúng 1 document", async () => {
  await mongoose.connection.db.collection("settings").deleteMany({});
  const vals = [1, 2, 3, 4, 5, 6];
  const rs = await Promise.all(vals.map((v) => setHours(v)));
  for (const r of rs) assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(await mongoose.connection.db.collection("settings").countDocuments(), 1, "unique key -> không sinh 2 document");
  const final = (await mongoose.connection.db.collection("settings").findOne({ key: "studio" })).minCancelHours;
  assert.ok(vals.includes(final));
  assert.equal((await call("/settings", { token: tokens.admin })).data.minCancelHours, final, "cache phải khớp DB sau loạt ghi song song");
});

test("locked-admin: admin bị khoá còn giữ token -> PATCH 403 'bị khoá', giá trị không đổi (H6)", async () => {
  assert.equal((await setHours(7)).status, 200);
  await User.updateOne({ phone: "0999999999" }, { isActive: false });
  try {
    const r = await setHours(1);
    assert.equal(r.status, 403);
    assert.match(r.data.error, /bị khoá/);
  } finally {
    await User.updateOne({ phone: "0999999999" }, { isActive: true });
  }
  assert.equal((await call("/settings", { token: tokens.admin })).data.minCancelHours, 7);
});

test("db-edited-outside: xoá settings thẳng trong DB -> sau khi cache hết hạn server quay về mặc định env (review #3)", async () => {
  assert.equal((await setHours(30)).status, 200);
  await mongoose.connection.db.collection("settings").deleteMany({});
  await sleep(1700); // > SETTINGS_CACHE_MS của server test
  assert.equal((await call("/settings", { token: tokens.admin })).data.minCancelHours, 3);
  assert.equal((await login("0909090909")).config.minCancelHours, 3);
});

test("survive-restart: lưu 9 -> tắt server, bật lại -> vẫn 9 (giá trị nằm ở DB, không chỉ cache RAM)", async () => {
  assert.equal((await setHours(9)).status, 200);
  proc.kill();
  await sleep(500);
  proc = startServer();
  await waitHealthy(S);
  assert.equal((await call("/settings", { token: tokens.admin })).data.minCancelHours, 9);
  assert.equal((await login("0909090909")).config.minCancelHours, 9);
});

// Chỉ 1 document settings sau tất cả các lần lưu (không sinh rác)
test("single-doc: sau nhiều lần lưu vẫn đúng 1 document trong collection settings", async () => {
  assert.equal(await mongoose.connection.db.collection("settings").countDocuments(), 1);
});
