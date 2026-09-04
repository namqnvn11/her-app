// her-60 (04/09/2026): lịch sử gói bán — GET /api/packages?month&q&page&limit (admin + lễ tân).
// Xem docs-her/testcase/testcase_her-60_sold_packages_history.md. DB riêng her_test_aa, server cổng 4351.

const { test, before, after } = require("node:test");
const assert = require("node:assert");
const { spawn, spawnSync } = require("node:child_process");
const path = require("node:path");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const ROOT = path.join(__dirname, "..");
const URI = "mongodb://localhost:27017/her_test_aa";
const S = "http://localhost:4351/api";

const User = require("../src/models/User");
const Package = require("../src/models/Package");

let proc;
const tokens = {};
const SERVER_ENV = { ...process.env, PORT: "4351", MONGODB_URI: URI, JWT_SECRET: "testsecret", MIN_CANCEL_HOURS: "3" };
const startServer = () => spawn(process.execPath, ["server.js"], { cwd: ROOT, env: SERVER_ENV, stdio: "ignore" });

async function waitHealthy(base) {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${base}/health`); if (r.ok) return; } catch {}
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
const ym = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const now = new Date();
const thisMonth = ym(now);
const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 10, 9, 0, 0);
const lastMonth = ym(lastMonthDate);

let seq = 0;
async function makeCustomer(name) {
  const phone = `0966${String(seq++).padStart(6, "0")}`;
  const passwordHash = await bcrypt.hash("123456", 10);
  const user = await User.create({ name, phone, passwordHash, role: "customer" });
  return { user, phone, id: user._id.toString() };
}
async function sell(cust, { name, price, paid, soldAt }) {
  const r = await call("/packages", {
    method: "POST", token: tokens.reception,
    body: { userId: cust.id, name, serviceTypes: ["pilates"], format: "1:1", price, totalSessions: 10, paidAmount: paid, soldAt: soldAt?.toISOString(), durationDays: 365 },
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data.package;
}
// token: undefined = lễ tân (mặc định); null = KHÔNG gửi token
const list = (query = "", token = tokens.reception) => call(`/packages${query}`, { token: token === null ? undefined : token });

let A, B, C; // khách
let pkgA1, pkgA2, pkgB, pkgC;
before(async () => {
  const seeded = spawnSync(process.execPath, ["src/scripts/seed.js"], { cwd: ROOT, env: { ...process.env, MONGODB_URI: URI }, stdio: "ignore" });
  assert.equal(seeded.status, 0, "seed her_test_aa thất bại");
  await mongoose.connect(URI);
  // Dọn gói seed để đếm được chính xác
  await Package.deleteMany({});
  proc = startServer();
  await waitHealthy(S);
  tokens.admin = (await loginOk("0999999999")).token;
  tokens.reception = (await loginOk("0900000000")).token;
  tokens.trainer = (await loginOk("0911111111")).token;
  tokens.customer = (await loginOk("0909090909")).token;
  A = await makeCustomer("Nguyễn Thị Lan Anh");
  B = await makeCustomer("Trần Đức");
  C = await makeCustomer("Khách Bị Xoá");
  pkgA1 = await sell(A, { name: "Pilates 10", price: 1000000, paid: 1000000 });
  pkgA2 = await sell(A, { name: "Pilates 10 nợ", price: 2000000, paid: 500000 });
  pkgB = await sell(B, { name: "Gói tháng trước", price: 3000000, paid: 3000000, soldAt: lastMonthDate });
  pkgC = await sell(C, { name: "Gói khách xoá", price: 700000, paid: 700000 });
});
after(async () => { proc?.kill(); await mongoose.disconnect(); });

test("month-filter: mặc định tháng này (2 gói của A + gói C); ?month=tháng trước chỉ gói B; summary đúng; sắp xếp mới nhất trước; có customer & minMonth", async () => {
  const r = await list();
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.month, thisMonth);
  const names = r.data.packages.map((p) => p.name);
  assert.deepEqual(names, ["Gói khách xoá", "Pilates 10 nợ", "Pilates 10"], "ngày bán mới nhất trước");
  assert.equal(r.data.total, 3);
  assert.equal(r.data.hasMore, false);
  assert.deepEqual(r.data.summary, { count: 3, revenue: 1000000 + 500000 + 700000, debt: 1500000 });
  assert.equal(r.data.minMonth, lastMonth);
  const a = r.data.packages.find((p) => p.name === "Pilates 10");
  assert.equal(a.customer.id, A.id);
  assert.equal(a.customer.name, A.user.name);
  assert.equal(a.customer.phone, A.phone);
  assert.equal(a.customer.deleted, false);
  assert.equal(a.debt, 0);

  const r2 = await list(`?month=${lastMonth}`);
  assert.equal(r2.status, 200);
  assert.deepEqual(r2.data.packages.map((p) => p.name), ["Gói tháng trước"]);
  assert.deepEqual(r2.data.summary, { count: 1, revenue: 3000000, debt: 0 });
});

test("search q: theo tên có dấu/không dấu/hoa thường và theo SĐT; không khớp -> rỗng; q chỉ lọc trong tháng", async () => {
  for (const q of ["lan anh", "Lan%20Anh", "lan"]) {
    const r = await list(`?q=${q}`);
    assert.equal(r.status, 200, q);
    assert.deepEqual(r.data.packages.map((p) => p.name).sort(), ["Pilates 10", "Pilates 10 nợ"], q);
  }
  const byPhone = await list(`?q=${A.phone}`);
  assert.equal(byPhone.data.total, 2);
  const none = await list("?q=khongcoai");
  assert.equal(none.data.total, 0);
  assert.deepEqual(none.data.summary, { count: 0, revenue: 0, debt: 0 });
  // B bán tháng trước — tìm trong tháng này không ra, đúng tháng thì ra
  assert.equal((await list("?q=duc")).data.total, 0);
  assert.equal((await list(`?q=duc&month=${lastMonth}`)).data.total, 1);
});

test("soft-deleted: gói xoá mềm biến mất; khách xoá mềm thì gói vẫn hiện, customer.deleted=true", async () => {
  const del = await call(`/packages/${pkgA1.id}`, { method: "DELETE", token: tokens.admin });
  assert.equal(del.status, 200, JSON.stringify(del.data));
  const r = await list();
  assert.ok(!r.data.packages.some((p) => p.id === pkgA1.id), "gói xoá mềm không hiện");
  assert.equal(r.data.summary.count, 2);
  // Xoá mềm khách C
  const delC = await call(`/accounts/${C.id}`, { method: "DELETE", token: tokens.admin });
  assert.equal(delC.status, 200, JSON.stringify(delC.data));
  const r2 = await list();
  const c = r2.data.packages.find((p) => p.id === pkgC.id);
  assert.ok(c, "gói của khách đã xoá vẫn nằm trong lịch sử bán");
  assert.equal(c.customer.deleted, true);
  assert.equal(c.customer.name, C.user.name);
  // Hoàn tác để test sau không lệ thuộc
  await Package.updateOne({ _id: pkgA1.id }, { $set: { deletedAt: null, deletedBy: null } });
  await User.updateOne({ _id: C.id }, { $set: { deletedAt: null, isActive: true } });
});

test("paging: limit=2 -> 2 gói + hasMore; page=2 -> 1 gói; limit>100 bị kẹp; page rác = 1", async () => {
  const p1 = await list("?limit=2");
  assert.equal(p1.data.packages.length, 2);
  assert.equal(p1.data.hasMore, true);
  assert.equal(p1.data.total, 3);
  const p2 = await list("?limit=2&page=2");
  assert.equal(p2.data.packages.length, 1);
  assert.equal(p2.data.hasMore, false);
  const ids = [...p1.data.packages, ...p2.data.packages].map((p) => p.id);
  assert.equal(new Set(ids).size, 3, "không lặp giữa 2 trang");
  const big = await list("?limit=999");
  assert.equal(big.data.limit, 100);
  const junk = await list("?page=abc&limit=xyz");
  assert.equal(junk.status, 200);
  assert.equal(junk.data.page, 1);
});

test("month-invalid: 2026-13 / abc / 1999-01 -> 400 { error }", async () => {
  for (const m of ["2026-13", "abc", "1999-01", "26-08"]) {
    const r = await list(`?month=${m}`);
    assert.equal(r.status, 400, m);
    assert.match(r.data.error, /tháng/i);
  }
});

test("role-matrix: admin 200, lễ tân 200, HLV 403, khách 403, không token 401", async () => {
  assert.equal((await list("", tokens.admin)).status, 200);
  assert.equal((await list("", tokens.reception)).status, 200);
  for (const role of ["trainer", "customer"]) {
    const r = await list("", tokens[role]);
    assert.equal(r.status, 403, role);
    assert.ok(r.data.error);
  }
  assert.equal((await list("", null)).status, 401);
});
