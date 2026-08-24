// her-48: khách để lại thông tin đặt hẹn tư vấn từ trang web (her-pilates.com)
// -> POST /api/leads công khai (validate + rate-limit); quầy/admin đọc & đổi trạng thái.
// Xem docs-her/testcase/testcase_her-48_web_leads.md. DB her_test_u, cổng 4291.

const { test, before, after } = require("node:test");
const assert = require("node:assert");
const { spawn, spawnSync } = require("node:child_process");
const path = require("node:path");
const mongoose = require("mongoose");

const ROOT = path.join(__dirname, "..");
const URI = "mongodb://localhost:27017/her_test_u";
const S = "http://localhost:4291/api";

let proc;
const tokens = {};

async function waitHealthy() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${S}/health`); if (r.ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("Server không khởi động được");
}
async function call(pathName, { method = "GET", token, body, headers = {} } = {}) {
  const res = await fetch(S + pathName, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}
async function login(phone, password = "123456") {
  const r = await call("/auth/login", { method: "POST", body: { phone, password } });
  assert.equal(r.status, 200);
  return r.data;
}
// Mỗi lead 1 IP riêng (header X-Real-IP như nginx gửi) để không dính rate-limit chéo giữa các test
let ipSeq = 1;
const send = (body, ip) => call("/leads", { method: "POST", body, headers: { "X-Real-IP": ip || `10.9.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}` } });

before(async () => {
  const seeded = spawnSync(process.execPath, ["src/scripts/seed.js"], {
    cwd: ROOT, env: { ...process.env, MONGODB_URI: URI }, stdio: "ignore",
  });
  assert.equal(seeded.status, 0, "seed thất bại");
  proc = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: "4291", MONGODB_URI: URI, JWT_SECRET: "testsecret", MIN_CANCEL_HOURS: "3", LEAD_MAX_PER_WINDOW: "3", LEAD_WINDOW_MINUTES: "5" },
    stdio: "ignore",
  });
  await waitHealthy();
  await mongoose.connect(URI);
  tokens.admin = (await login("0999999999")).token;
  tokens.reception = (await login("0900000000")).token;
  tokens.trainer = (await login("0911111111")).token;
  tokens.customer = (await login("0909090909")).token;
});
after(async () => { proc?.kill(); await mongoose.disconnect(); });

// ---------- 1. Gửi hợp lệ ----------
test("submit-ok: khách gửi tên+SĐT (không cần đăng nhập) -> 201, lưu trạng thái 'new', trim dữ liệu", async () => {
  const r = await send({ name: "  Ngọc Lan  ", phone: "0912000001", interest: "pilates", note: "Gọi giúp em sau 18h" });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const doc = await mongoose.connection.db.collection("leads").findOne({ phone: "0912000001" });
  assert.equal(doc.name, "Ngọc Lan");
  assert.equal(doc.status, "new");
  assert.equal(doc.interest, "pilates");
});

// ---------- 2. Validate ----------
test("validate: thiếu tên/SĐT sai/interest lạ/note quá dài/kiểu sai -> 400 { error }, không lưu rác", async () => {
  const bads = [
    { name: "A", phone: "123" },                               // SĐT sai
    { name: "A", phone: "0912000002", interest: "bơi lội" },   // interest ngoài danh mục
    { name: "A".repeat(101), phone: "0912000002" },            // tên quá dài
    { name: "A", phone: "0912000002", note: "x".repeat(501) }, // note quá dài
    { name: ["x"], phone: "0912000002" },                      // kiểu sai
    "chuỗi trần",
  ];
  for (const b of bads) {
    const r = await send(b);
    assert.equal(r.status, 400, JSON.stringify(b).slice(0, 60));
    assert.ok(r.data?.error);
  }
  assert.equal(await mongoose.connection.db.collection("leads").countDocuments({ phone: "0912000002" }), 0);
});

// ---------- 2b. Form nhanh: chỉ SĐT (mẫu Editorial her-48b) ----------
test("quick-phone-only: chỉ gửi SĐT (dải form nhanh) -> 201, tên mặc định 'Khách để lại SĐT'", async () => {
  const r = await send({ phone: "0912000051" });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const doc = await mongoose.connection.db.collection("leads").findOne({ phone: "0912000051" });
  assert.equal(doc.name, "Khách để lại SĐT");
});

// ---------- 3. Honeypot bot ----------
test("honeypot: field 'website' có giá trị (bot điền) -> trả 201 giả nhưng KHÔNG lưu", async () => {
  const r = await send({ name: "Bot", phone: "0912000003", website: "http://spam" });
  assert.equal(r.status, 201);
  assert.equal(await mongoose.connection.db.collection("leads").countDocuments({ phone: "0912000003" }), 0);
});

// ---------- 4. Rate limit theo IP ----------
test("rate-limit: cùng IP gửi quá LEAD_MAX_PER_WINDOW(3) trong cửa sổ 5 phút -> 429; IP khác vẫn gửi được", async () => {
  const ip = "10.8.8.8";
  for (let i = 1; i <= 3; i++) {
    assert.equal((await send({ name: `K${i}`, phone: `091200001${i}` }, ip)).status, 201);
  }
  const r4 = await send({ name: "K4", phone: "0912000014" }, ip);
  assert.equal(r4.status, 429);
  assert.ok(r4.data.error);
  assert.equal((await send({ name: "K5", phone: "0912000015" })).status, 201, "IP khác không bị vạ lây");
});

// ---------- 5. Trùng SĐT đang chờ ----------
test("dup-phone: cùng SĐT gửi lại khi lead cũ còn 'new' -> 200 báo đã nhận, không tạo bản ghi đúp", async () => {
  assert.equal((await send({ name: "Trang", phone: "0912000021" })).status, 201);
  const r = await send({ name: "Trang gửi lại", phone: "0912000021" });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(await mongoose.connection.db.collection("leads").countDocuments({ phone: "0912000021" }), 1);
});

// ---------- 6. Phân quyền đọc/sửa ----------
test("role-matrix: GET/PATCH /leads — quầy+admin được; HLV/khách 403; anon 401", async () => {
  await send({ name: "Ma trận", phone: "0912000031" });
  const id = (await mongoose.connection.db.collection("leads").findOne({ phone: "0912000031" }))._id;
  for (const [who, tk, want] of [["admin", tokens.admin, 200], ["reception", tokens.reception, 200], ["trainer", tokens.trainer, 403], ["customer", tokens.customer, 403], ["anon", null, 401]]) {
    assert.equal((await call("/leads", { token: tk })).status, want, `GET ${who}`);
    const p = await call(`/leads/${id}`, { method: "PATCH", token: tk, body: { status: "contacted" } });
    assert.equal(p.status, want, `PATCH ${who}`);
  }
});

// ---------- 7. Đổi trạng thái + ghi dấu ----------
test("status-flow: quầy chuyển new->contacted->done, ghi người+lúc xử lý; trạng thái lạ 400; id rác 400/404", async () => {
  await send({ name: "Hạnh", phone: "0912000041" });
  const id = (await mongoose.connection.db.collection("leads").findOne({ phone: "0912000041" }))._id;
  const r1 = await call(`/leads/${id}`, { method: "PATCH", token: tokens.reception, body: { status: "contacted" } });
  assert.equal(r1.status, 200);
  const doc = await mongoose.connection.db.collection("leads").findOne({ _id: id });
  assert.equal(doc.status, "contacted");
  assert.ok(doc.handledBy && doc.handledAt, "phải ghi ai xử lý, lúc nào");
  assert.equal((await call(`/leads/${id}`, { method: "PATCH", token: tokens.reception, body: { status: "xong-roi" } })).status, 400);
  assert.equal((await call(`/leads/rac-id`, { method: "PATCH", token: tokens.reception, body: { status: "done" } })).status, 400);
});

// ---------- 8. Lọc danh sách ----------
test("list-filter: GET /leads?status=new chỉ trả lead mới, sort mới nhất trước, có đủ field cho web quản lý", async () => {
  const r = await call("/leads?status=new", { token: tokens.reception });
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.data.leads) && r.data.leads.length >= 1);
  for (const l of r.data.leads) assert.equal(l.status, "new");
  const l0 = r.data.leads[0];
  assert.ok(l0.id && l0.name && l0.phone && l0.createdAt !== undefined);
  const all = await call("/leads", { token: tokens.reception });
  assert.ok(all.data.leads.length >= r.data.leads.length);
});
