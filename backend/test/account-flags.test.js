// Test her-43 — khối "Cần xử lý" của lễ tân bấm được: GET /accounts?flag=debt|expiring
// Xem docs-her/testcase/testcase_her-43_todo_deeplink.md
// DB riêng her_test_r (tự seed), server cổng 4261.

const { test, before, after } = require("node:test");
const assert = require("node:assert");
const { spawn, spawnSync } = require("node:child_process");
const path = require("node:path");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const ROOT = path.join(__dirname, "..");
const URI = "mongodb://localhost:27017/her_test_r";
const S = "http://localhost:4261/api";

const Package = require("../src/models/Package");
const User = require("../src/models/User");

let proc;
const tokens = {};
const ids = {};

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

const inDays = (n) => new Date(Date.now() + n * 24 * 3600 * 1000);
const names = (res) => (res.data.accounts || []).map((a) => a.name).sort();

before(async () => {
  const seeded = spawnSync(process.execPath, ["src/scripts/seed.js"], {
    cwd: ROOT,
    env: { ...process.env, MONGODB_URI: URI },
    stdio: "ignore",
  });
  assert.equal(seeded.status, 0, "seed her_test_r thất bại");
  proc = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: "4261", MONGODB_URI: URI, JWT_SECRET: "testsecret" },
    stdio: "ignore",
  });
  await waitHealthy(S);
  await mongoose.connect(URI);

  // Suite này cần đếm CHÍNH XÁC nên dọn sạch gói demo của seed rồi tự dựng fixture
  await Package.deleteMany({});

  tokens.admin = (await login("0999999999")).token;
  tokens.staff = (await login("0900000000")).token;
  tokens.trainer = (await login("0911111111")).token;
  tokens.customer = (await login("0909090909")).token;

  const passwordHash = await bcrypt.hash("123456", 10);
  const mkCustomer = async (name, phone, isActive = true) =>
    (await User.create({ name, phone, passwordHash, role: "customer", isActive }))._id;

  // --- Nhóm CÒN NỢ ---
  ids.no1 = await mkCustomer("Flag No Mot", "0961000001");
  await Package.create({
    userId: ids.no1, name: "G1", serviceTypes: ["gym"], format: "1:1", price: 1000000, paidAmount: 400000,
    totalSessions: 10, activatedAt: new Date(), expiresAt: inDays(90),
  });
  // Nợ ở 2 gói -> phải CỘNG DỒN, và khách chỉ xuất hiện 1 lần
  await Package.create({
    userId: ids.no1, name: "G2", serviceTypes: ["gym"], format: "1:1", price: 500000, paidAmount: 300000,
    totalSessions: 10, activatedAt: new Date(), expiresAt: inDays(90),
  });
  ids.no2 = await mkCustomer("Flag No Hai", "0961000002");
  await Package.create({
    userId: ids.no2, name: "G3", serviceTypes: ["yoga"], format: "1:8", price: 800000, paidAmount: 0,
    totalSessions: null, activatedAt: new Date(), expiresAt: inDays(90),
  });
  // Khách nợ nhưng ĐÃ KHOÁ -> không được vào danh sách (review V4)
  ids.noKhoa = await mkCustomer("Flag No Khoa", "0961000003", false);
  await Package.create({
    userId: ids.noKhoa, name: "G4", serviceTypes: ["gym"], format: "1:1", price: 900000, paidAmount: 100000,
    totalSessions: 10, activatedAt: new Date(), expiresAt: inDays(90),
  });
  // Trả ĐỦ -> không nợ
  ids.duTien = await mkCustomer("Flag Du Tien", "0961000004");
  await Package.create({
    userId: ids.duTien, name: "G5", serviceTypes: ["gym"], format: "1:1", price: 700000, paidAmount: 700000,
    totalSessions: 10, activatedAt: new Date(), expiresAt: inDays(90),
  });

  // --- Nhóm SẮP HẾT HẠN (trong 7 ngày) ---
  ids.hh1 = await mkCustomer("Flag Han Mot", "0961000011");
  await Package.create({
    userId: ids.hh1, name: "H1", serviceTypes: ["pilates"], format: "1:2", price: 100, paidAmount: 100,
    totalSessions: 10, usedSessions: 2, activatedAt: new Date(), expiresAt: inDays(5),
  });
  // Cùng khách, gói thứ 2 hạn GẦN HƠN -> expiringAt phải lấy cái gần nhất
  await Package.create({
    userId: ids.hh1, name: "H2", serviceTypes: ["pilates"], format: "1:2", price: 100, paidAmount: 100,
    totalSessions: 10, usedSessions: 1, activatedAt: new Date(), expiresAt: inDays(2),
  });
  // Hạn 20 ngày -> ngoài cửa sổ 7 ngày
  ids.hhXa = await mkCustomer("Flag Han Xa", "0961000012");
  await Package.create({
    userId: ids.hhXa, name: "H3", serviceTypes: ["gym"], format: "1:1", price: 100, paidAmount: 100,
    totalSessions: 10, activatedAt: new Date(), expiresAt: inDays(20),
  });
  // Sắp hết hạn nhưng đang BẢO LƯU -> bỏ
  ids.hhBaoLuu = await mkCustomer("Flag Han Bao Luu", "0961000013");
  await Package.create({
    userId: ids.hhBaoLuu, name: "H4", serviceTypes: ["gym"], format: "1:1", price: 100, paidAmount: 100,
    totalSessions: 10, activatedAt: new Date(), expiresAt: inDays(3), pausedAt: new Date(),
  });
  // Sắp hết hạn nhưng ĐÃ HẾT BUỔI -> bỏ
  ids.hhHetBuoi = await mkCustomer("Flag Han Het Buoi", "0961000014");
  await Package.create({
    userId: ids.hhHetBuoi, name: "H5", serviceTypes: ["gym"], format: "1:1", price: 100, paidAmount: 100,
    totalSessions: 10, usedSessions: 10, activatedAt: new Date(), expiresAt: inDays(3),
  });
  // Sắp hết hạn nhưng khách ĐÃ KHOÁ -> bỏ
  ids.hhKhoa = await mkCustomer("Flag Han Khoa", "0961000015", false);
  await Package.create({
    userId: ids.hhKhoa, name: "H6", serviceTypes: ["gym"], format: "1:1", price: 100, paidAmount: 100,
    totalSessions: 10, activatedAt: new Date(), expiresAt: inDays(3),
  });
});

after(async () => {
  proc?.kill();
  await mongoose.disconnect();
});

// ---------- 1. Lọc CÒN NỢ ----------

test("flag-debt: đúng nhóm khách còn nợ — cộng dồn nhiều gói, bỏ khách khoá và khách trả đủ", async () => {
  const r = await call("/accounts?role=customer&flag=debt", { token: tokens.staff });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(names(r), ["Flag No Hai", "Flag No Mot"], "chỉ 2 khách còn nợ đang hoạt động");

  const mot = r.data.accounts.find((a) => a.name === "Flag No Mot");
  assert.equal(mot.debt, 600000 + 200000, "nợ 2 gói phải CỘNG DỒN (600k + 200k)");
  const hai = r.data.accounts.find((a) => a.name === "Flag No Hai");
  assert.equal(hai.debt, 800000, "gói chưa trả đồng nào -> nợ nguyên giá");
});

test("flag-debt-khop-dashboard: con số 'n khách còn nợ' của Tổng quan = số dòng danh sách", async () => {
  const dash = await call("/dashboard", { token: tokens.staff });
  assert.equal(dash.status, 200);
  const list = await call("/accounts?role=customer&flag=debt", { token: tokens.staff });
  assert.equal(
    dash.data.unpaid,
    list.data.accounts.length,
    "lệch số giữa dashboard và danh sách là mất tin cậy cả màn"
  );
  const row = dash.data.todo.find((t) => t.flag === "debt");
  assert.ok(row, "dòng 'còn nợ' phải mang flag=debt để app biết dẫn đi đâu");
  assert.match(row.title, new RegExp(`^${dash.data.unpaid} khách`), "tiêu đề dòng nói đúng con số đó");
});

// ---------- 2. Lọc SẮP HẾT HẠN ----------

test("flag-expiring: chỉ khách có gói hết hạn ≤7 ngày — bỏ bảo lưu / hết buổi / khoá / hạn xa", async () => {
  const r = await call("/accounts?role=customer&flag=expiring", { token: tokens.staff });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(names(r), ["Flag Han Mot"], "chỉ 1 khách đủ điều kiện");
  const hh = r.data.accounts[0];
  const days = Math.round((new Date(hh.expiringAt) - Date.now()) / 86400000);
  assert.equal(days, 2, "khách 2 gói -> lấy hạn GẦN NHẤT (2 ngày), không phải 5 ngày");
});

test("flag-expiring-khop-dashboard: dòng todo đếm GÓI, danh sách gom theo KHÁCH", async () => {
  const dash = await call("/dashboard", { token: tokens.staff });
  const row = dash.data.todo.find((t) => t.flag === "expiring");
  assert.ok(row, "dòng 'sắp hết hạn' phải mang flag=expiring");
  assert.match(row.title, /^2 gói sắp hết hạn trong 7 ngày$/, "2 gói của cùng 1 khách vẫn đếm là 2 gói");
  const list = await call("/accounts?role=customer&flag=expiring", { token: tokens.staff });
  assert.equal(list.data.accounts.length, 1, "nhưng danh sách chỉ 1 dòng khách");
});

// ---------- 3. Phân quyền + input xấu (H5, C8) ----------

test("flag-matrix: HLV/khách/anon không gọi được; admin gọi được; lễ tân gọi được", async () => {
  for (const [who, token] of [["trainer", tokens.trainer], ["customer", tokens.customer]]) {
    const r = await call("/accounts?role=customer&flag=debt", { token });
    assert.equal(r.status, 403, `${who} phải bị 403`);
    assert.ok(r.data.error, "phải kèm lý do tiếng Việt");
  }
  const anon = await call("/accounts?role=customer&flag=debt");
  assert.equal(anon.status, 401, "chưa đăng nhập -> 401");
  for (const [who, token] of [["admin", tokens.admin], ["staff", tokens.staff]]) {
    const r = await call("/accounts?role=customer&flag=debt", { token });
    assert.equal(r.status, 200, `${who} phải xem được`);
  }
});

test("flag-bad-input: flag lạ -> 400; flag rỗng -> 400; ghép với role khác học viên -> 400", async () => {
  const bad = await call("/accounts?role=customer&flag=vip", { token: tokens.staff });
  assert.equal(bad.status, 400);
  assert.match(bad.data.error, /Bộ lọc không hợp lệ/);

  const empty = await call("/accounts?role=customer&flag=", { token: tokens.staff });
  assert.equal(empty.status, 400, "flag rỗng không được coi là 'không lọc'");

  const wrongRole = await call("/accounts?role=trainer&flag=debt", { token: tokens.admin });
  assert.equal(wrongRole.status, 400, "lọc này chỉ dành cho học viên");
  assert.match(wrongRole.data.error, /học viên/);
});

test("flag-khong-lam-hong-danh-sach-thuong: bỏ flag thì trả đủ như cũ", async () => {
  const all = await call("/accounts?role=customer", { token: tokens.staff });
  assert.equal(all.status, 200);
  const filtered = await call("/accounts?role=customer&flag=debt", { token: tokens.staff });
  assert.ok(all.data.accounts.length > filtered.data.accounts.length, "danh sách đầy đủ phải nhiều hơn");
  assert.ok(
    all.data.accounts.every((a) => a.debt === undefined && a.expiringAt === undefined),
    "không lọc thì KHÔNG đính kèm số nợ/hạn (giữ nguyên shape cũ)"
  );
});
