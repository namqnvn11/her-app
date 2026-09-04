// her-59 (04/09/2026): hồ sơ khách mở rộng — email, giới tính, liên hệ khẩn cấp, sức khỏe, mục tiêu.
// Xem docs-her/testcase/testcase_her-59_customer_profile_fields.md. DB riêng her_test_y, server cổng 4341.

const { test, before, after } = require("node:test");
const assert = require("node:assert");
const { spawn, spawnSync } = require("node:child_process");
const path = require("node:path");
const mongoose = require("mongoose");

const ROOT = path.join(__dirname, "..");
const URI = "mongodb://localhost:27017/her_test_y";
const S = "http://localhost:4341/api";

const User = require("../src/models/User");
const Booking = require("../src/models/Booking");

let proc;
const tokens = {};
const SERVER_ENV = { ...process.env, PORT: "4341", MONGODB_URI: URI, JWT_SECRET: "testsecret", MIN_CANCEL_HOURS: "3" };
const startServer = () => spawn(process.execPath, ["server.js"], { cwd: ROOT, env: SERVER_ENV, stdio: "ignore" });
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

const FULL = {
  email: "Lan.Nguyen@Example.com",
  gender: "female",
  emergencyContact: { name: "Nguyễn Văn Chồng", phone: "0912345678" },
  healthNotes: "Đau lưng dưới, thoát vị L4-L5",
  goals: "Cải thiện tư thế, giảm đau mỏi",
};

let seq = 0;
const newPhone = () => `0967${String(seq++).padStart(6, "0")}`;
async function createCustomer(extra = {}, token = tokens.reception) {
  const phone = newPhone();
  const r = await call("/accounts", { method: "POST", token, body: { name: `Khach her59 ${seq}`, phone, password: "123456", role: "customer", ...extra } });
  return { r, phone };
}

before(async () => {
  const seeded = spawnSync(process.execPath, ["src/scripts/seed.js"], { cwd: ROOT, env: { ...process.env, MONGODB_URI: URI }, stdio: "ignore" });
  assert.equal(seeded.status, 0, "seed her_test_y thất bại");
  await mongoose.connect(URI);
  proc = startServer();
  await waitHealthy(S);
  tokens.admin = (await loginOk("0999999999")).token;
  tokens.reception = (await loginOk("0900000000")).token;
  tokens.trainer = (await loginOk("0911111111")).token;
  tokens.customer = (await loginOk("0909090909")).token;
  coachId = (await User.findOne({ phone: "0911111111" })).trainerId;
});
after(async () => { proc?.kill(); await mongoose.disconnect(); });

test("create-full: lễ tân tạo khách đủ trường -> 201, trả đủ; email hạ chữ thường; login trả đủ trường", async () => {
  const { r, phone } = await createCustomer(FULL);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const a = r.data.account;
  assert.equal(a.email, "lan.nguyen@example.com");
  assert.equal(a.gender, "female");
  assert.deepEqual(a.emergencyContact, FULL.emergencyContact);
  assert.equal(a.healthNotes, FULL.healthNotes);
  assert.equal(a.goals, FULL.goals);
  const me = await loginOk(phone);
  assert.equal(me.user.goals, FULL.goals);
  assert.deepEqual(me.user.emergencyContact, FULL.emergencyContact);
});

test("create-empty: không gửi trường nào -> 201, mặc định null/rỗng (không bắt buộc)", async () => {
  const { r } = await createCustomer();
  assert.equal(r.status, 201);
  const a = r.data.account;
  assert.equal(a.gender, null);
  assert.deepEqual(a.emergencyContact, { name: "", phone: "" });
  assert.equal(a.healthNotes, "");
  assert.equal(a.goals, "");
});

test("validate: email sai / SĐT khẩn cấp sai / giới tính lạ / ghi chú > 500 / kiểu sai -> 400 { error } tiếng Việt", async () => {
  const bad = [
    [{ email: "khong-phai-email" }, /email/i],
    [{ email: 123 }, /email/i],
    [{ emergencyContact: { name: "A", phone: "12345" } }, /khẩn cấp/i],
    [{ emergencyContact: "0912345678" }, /khẩn cấp/i],
    [{ gender: "alien" }, /giới tính/i],
    [{ healthNotes: "x".repeat(501) }, /sức khỏe/i],
    [{ goals: ["giam can"] }, /mục tiêu/i],
    [{ goals: "y".repeat(501) }, /mục tiêu/i],
  ];
  for (const [extra, re] of bad) {
    const { r } = await createCustomer(extra);
    assert.equal(r.status, 400, `${JSON.stringify(extra)} -> ${JSON.stringify(r.data)}`);
    assert.match(r.data.error, re, JSON.stringify(extra));
  }
  // Rỗng = xoá, hợp lệ
  const { r } = await createCustomer({ email: "", emergencyContact: { name: "", phone: "" }, gender: null });
  assert.equal(r.status, 201, JSON.stringify(r.data));
});

test("patch-accounts: lễ tân sửa từng trường của khách -> 200; rỗng xoá; HLV/khách -> 403; lễ tân sửa HLV -> 403; admin sửa HLV -> 200", async () => {
  const { r } = await createCustomer(FULL);
  const id = r.data.account.id;
  const p = await call(`/accounts/${id}`, { method: "PATCH", token: tokens.reception, body: { goals: "Giảm cân", email: "", gender: "other" } });
  assert.equal(p.status, 200, JSON.stringify(p.data));
  assert.equal(p.data.account.goals, "Giảm cân");
  assert.equal(p.data.account.email, null, "email rỗng = xoá");
  assert.equal(p.data.account.gender, "other");
  assert.equal(p.data.account.healthNotes, FULL.healthNotes, "trường không gửi giữ nguyên");
  const bad = await call(`/accounts/${id}`, { method: "PATCH", token: tokens.reception, body: { emergencyContact: { name: "B", phone: "abc" } } });
  assert.equal(bad.status, 400);
  for (const role of ["trainer", "customer"]) {
    const x = await call(`/accounts/${id}`, { method: "PATCH", token: tokens[role], body: { goals: "hack" } });
    assert.equal(x.status, 403, role);
  }
  const trainerUser = await User.findOne({ phone: "0911111111" });
  const byRec = await call(`/accounts/${trainerUser._id}`, { method: "PATCH", token: tokens.reception, body: { gender: "male" } });
  assert.equal(byRec.status, 403);
  const byAdmin = await call(`/accounts/${trainerUser._id}`, { method: "PATCH", token: tokens.admin, body: { gender: "male", email: "hlv@her.vn" } });
  assert.equal(byAdmin.status, 200, JSON.stringify(byAdmin.data));
  assert.equal(byAdmin.data.account.email, "hlv@her.vn");
});

test("patch-me: khách tự sửa sức khỏe/mục tiêu/khẩn cấp/email/giới tính -> 200; phone/role/isActive gửi kèm bị bỏ qua; sai -> 400", async () => {
  const { r, phone } = await createCustomer();
  const { token } = await loginOk(phone);
  const p = await call("/me", { method: "PATCH", token, body: { ...FULL, phone: "0900000001", role: "admin", isActive: false, name: "Tên mới" } });
  assert.equal(p.status, 200, JSON.stringify(p.data));
  assert.equal(p.data.user.name, "Tên mới");
  assert.equal(p.data.user.phone, phone, "không đổi SĐT qua /me");
  assert.equal(p.data.user.role, "customer");
  assert.equal(p.data.user.isActive, true);
  assert.equal(p.data.user.healthNotes, FULL.healthNotes);
  assert.equal(p.data.user.email, "lan.nguyen@example.com");
  const bad = await call("/me", { method: "PATCH", token, body: { gender: "x" } });
  assert.equal(bad.status, 400);
  // HLV cũng tự sửa được email/giới tính của mình
  const t = await call("/me", { method: "PATCH", token: tokens.trainer, body: { gender: "female" } });
  assert.equal(t.status, 200);
  assert.equal(t.data.user.gender, "female");
});

test("roster: HLV thấy sức khỏe + mục tiêu nhưng KHÔNG thấy SĐT/email/khẩn cấp; lễ tân & admin thấy đủ", async () => {
  const { r } = await createCustomer(FULL);
  const custId = r.data.account.id;
  const startAt = new Date(Date.now() + 24 * 3600 * 1000);
  const cls = await mongoose.connection.db.collection("gymclasses").insertOne({
    name: "Buoi her59", serviceType: "pilates", format: "1:1", coachId, startAt,
    endAt: new Date(startAt.getTime() + 3600 * 1000), capacity: 1, bookedCount: 1,
  });
  await Booking.create({ userId: custId, classId: cls.insertedId, trainerId: coachId, status: "booked", startAt, endAt: new Date(startAt.getTime() + 3600 * 1000), title: "Buoi her59", serviceType: "pilates", format: "1:1" });
  const asTrainer = await call(`/management/classes/${cls.insertedId}/roster`, { token: tokens.trainer });
  assert.equal(asTrainer.status, 200, JSON.stringify(asTrainer.data));
  const k = asTrainer.data.customers[0];
  assert.equal(k.healthNotes, FULL.healthNotes);
  assert.equal(k.goals, FULL.goals);
  assert.equal(k.phone, undefined);
  assert.equal(k.email, undefined);
  assert.equal(k.emergencyContact, undefined);
  for (const role of ["reception", "admin"]) {
    const s = await call(`/management/classes/${cls.insertedId}/roster`, { token: tokens[role] });
    assert.equal(s.status, 200);
    const c = s.data.customers[0];
    assert.equal(c.healthNotes, FULL.healthNotes);
    assert.ok(c.phone);
    assert.equal(c.email, "lan.nguyen@example.com");
    assert.deepEqual(c.emergencyContact, FULL.emergencyContact);
  }
});
