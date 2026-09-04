// her-61 (04/09/2026): ảnh đại diện lưu file trên server — POST/DELETE /api/me/avatar, phát qua /uploads.
// Xem docs-her/testcase/testcase_her-61_avatar_upload.md. DB riêng her_test_ab, server cổng 4361,
// UPLOAD_DIR trỏ thư mục tạm riêng của suite (xoá khi xong).

const { test, before, after } = require("node:test");
const assert = require("node:assert");
const { spawn, spawnSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const mongoose = require("mongoose");

const ROOT = path.join(__dirname, "..");
const URI = "mongodb://localhost:27017/her_test_ab";
const PORT = "4361";
const S = `http://localhost:${PORT}/api`;
const ORIGIN = `http://localhost:${PORT}`;
const UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "her-avatar-"));

const User = require("../src/models/User");

let proc;
const tokens = {};
const SERVER_ENV = { ...process.env, PORT, MONGODB_URI: URI, JWT_SECRET: "testsecret", MIN_CANCEL_HOURS: "3", UPLOAD_DIR };
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
// Upload multipart — field mặc định "avatar"
async function upload(token, bytes, { field = "avatar", filename = "a.jpg", type = "image/jpeg" } = {}) {
  const fd = new FormData();
  fd.append(field, new Blob([bytes], { type }), filename);
  const res = await fetch(`${S}/me/avatar`, { method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {}, body: fd });
  return { status: res.status, data: await res.json().catch(() => null) };
}

// PNG 1×1 hợp lệ (67 byte) và JPEG tối thiểu (chỉ cần đúng magic bytes để nhận diện)
const PNG_1PX = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const JPEG_MIN = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 0), Buffer.from([0xff, 0xd9])]);

before(async () => {
  const seeded = spawnSync(process.execPath, ["src/scripts/seed.js"], { cwd: ROOT, env: { ...process.env, MONGODB_URI: URI }, stdio: "ignore" });
  assert.equal(seeded.status, 0, "seed her_test_ab thất bại");
  await mongoose.connect(URI);
  proc = startServer();
  await waitHealthy(S);
  tokens.admin = (await loginOk("0999999999")).token;
  tokens.reception = (await loginOk("0900000000")).token;
  tokens.trainer = (await loginOk("0911111111")).token;
  tokens.customer = (await loginOk("0909090909")).token;
});
after(async () => {
  proc?.kill();
  await mongoose.disconnect();
  fs.rmSync(UPLOAD_DIR, { recursive: true, force: true });
});

test("upload-ok: khách gửi PNG -> 200, avatarUrl /uploads/avatars/<id>.png?v=; file tồn tại; GET /uploads trả 200 image/png có cache; /me trả cùng URL", async () => {
  const r = await upload(tokens.customer, PNG_1PX, { filename: "anh.png", type: "image/png" });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const me = await User.findOne({ phone: "0909090909" });
  const url = r.data.user.avatarUrl;
  assert.match(url, new RegExp(`^/uploads/avatars/${me._id}\\.png\\?v=\\d+$`));
  assert.ok(fs.existsSync(path.join(UPLOAD_DIR, "avatars", `${me._id}.png`)), "file phải nằm trong UPLOAD_DIR");
  const img = await fetch(ORIGIN + url);
  assert.equal(img.status, 200);
  assert.match(img.headers.get("content-type"), /image\/png/);
  assert.match(img.headers.get("cache-control"), /max-age=604800/, "ảnh được cache 7 ngày (khác API no-store)");
  assert.equal((await img.arrayBuffer()).byteLength, PNG_1PX.length);
  const meRes = await call("/me", { token: tokens.customer });
  assert.equal(meRes.data.user.avatarUrl, url);
});

test("replace: đổi sang JPEG -> file .jpg thay .png (không tồn 2 file), ?v= mới khác cũ; mọi role tự đổi được", async () => {
  const me = await User.findOne({ phone: "0909090909" });
  const before = (await call("/me", { token: tokens.customer })).data.user.avatarUrl;
  await new Promise((r) => setTimeout(r, 5));
  const r = await upload(tokens.customer, JPEG_MIN);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.match(r.data.user.avatarUrl, /\.jpg\?v=/);
  assert.notEqual(r.data.user.avatarUrl, before);
  assert.ok(fs.existsSync(path.join(UPLOAD_DIR, "avatars", `${me._id}.jpg`)));
  assert.ok(!fs.existsSync(path.join(UPLOAD_DIR, "avatars", `${me._id}.png`)), "file png cũ phải bị xoá");
  for (const role of ["trainer", "reception", "admin"]) {
    const x = await upload(tokens[role], PNG_1PX, { type: "image/png" });
    assert.equal(x.status, 200, role);
  }
  // Tên file = id của CHÍNH người gửi — không đổi được ảnh người khác
  const files = fs.readdirSync(path.join(UPLOAD_DIR, "avatars"));
  assert.equal(files.length, 4, files.join(","));
});

test("reject: quá 10 MB -> 400; file text đội lốt .jpg -> 400; sai tên field -> 400; không file -> 400; không token -> 401; đều JSON { error }", async () => {
  const big = await upload(tokens.customer, Buffer.alloc(10 * 1024 * 1024 + 1, 1));
  assert.equal(big.status, 400);
  assert.match(big.data.error, /10 MB/);
  const fake = await upload(tokens.customer, Buffer.from("hello world, toi khong phai anh"), { filename: "x.jpg" });
  assert.equal(fake.status, 400);
  assert.match(fake.data.error, /JPG hoặc PNG/);
  const field = await upload(tokens.customer, PNG_1PX, { field: "photo" });
  assert.equal(field.status, 400);
  assert.ok(field.data.error);
  const empty = await fetch(`${S}/me/avatar`, { method: "POST", headers: { Authorization: `Bearer ${tokens.customer}` }, body: new FormData() });
  assert.equal(empty.status, 400);
  assert.ok((await empty.json()).error);
  const noTok = await upload(null, PNG_1PX);
  assert.equal(noTok.status, 401);
  // Ảnh đang có vẫn nguyên sau các lần bị từ chối
  const me = await User.findOne({ phone: "0909090909" });
  assert.ok(fs.existsSync(path.join(UPLOAD_DIR, "avatars", `${me._id}.jpg`)));
});

test("patch-me-avatarUrl: PATCH /me { avatarUrl } bị bỏ qua (không ghi URL tuỳ ý)", async () => {
  const before = (await call("/me", { token: tokens.customer })).data.user.avatarUrl;
  const r = await call("/me", { method: "PATCH", token: tokens.customer, body: { avatarUrl: "https://evil.example/x.jpg" } });
  assert.equal(r.status, 200);
  assert.equal(r.data.user.avatarUrl, before);
});

test("delete: DELETE /me/avatar -> avatarUrl null, file bị xoá, GET ảnh cũ 404; xoá lần 2 vẫn 200", async () => {
  const me = await User.findOne({ phone: "0909090909" });
  const old = (await call("/me", { token: tokens.customer })).data.user.avatarUrl;
  const r = await call("/me/avatar", { method: "DELETE", token: tokens.customer });
  assert.equal(r.status, 200);
  assert.equal(r.data.user.avatarUrl, null);
  assert.ok(!fs.existsSync(path.join(UPLOAD_DIR, "avatars", `${me._id}.jpg`)));
  assert.equal((await fetch(ORIGIN + old)).status, 404);
  assert.equal((await call("/me/avatar", { method: "DELETE", token: tokens.customer })).status, 200);
});

test("locked: tài khoản bị khoá -> upload 403 có lý do", async () => {
  const cust = await User.findOne({ phone: "0909090909" });
  await User.updateOne({ _id: cust._id }, { $set: { isActive: false } });
  const r = await upload(tokens.customer, PNG_1PX, { type: "image/png" });
  assert.equal(r.status, 403, JSON.stringify(r.data));
  assert.ok(r.data.error);
  await User.updateOne({ _id: cust._id }, { $set: { isActive: true } });
});

test("static-safety: /uploads/../ và file ẩn không lộ; roster/accounts trả avatarUrl", async () => {
  fs.writeFileSync(path.join(UPLOAD_DIR, ".secret"), "x");
  assert.ok([403, 404].includes((await fetch(`${ORIGIN}/uploads/.secret`)).status), "file ẩn không được phát");
  const trav = await fetch(`${ORIGIN}/uploads/..%2f.env`);
  assert.ok([400, 403, 404].includes(trav.status), String(trav.status));
  await upload(tokens.customer, PNG_1PX, { type: "image/png" });
  const list = await call("/accounts?role=customer", { token: tokens.reception });
  const me = list.data.accounts.find((a) => a.phone === "0909090909");
  assert.match(me.avatarUrl, /^\/uploads\/avatars\//);
});
