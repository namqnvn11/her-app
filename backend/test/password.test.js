// Test her-14 — Mục 10: tự đổi mật khẩu (mọi vai trò).
// Xem docs-her/testcase/testcase_her-14_change_password.md
// DB riêng her_test_l (tự seed), server cổng 4201.

const { test, before, after } = require("node:test");
const assert = require("node:assert");
const { spawn, spawnSync } = require("node:child_process");
const path = require("node:path");
const mongoose = require("mongoose");

const ROOT = path.join(__dirname, "..");
const URI = "mongodb://localhost:27017/her_test_l";
const S = "http://localhost:4201/api";

let proc;

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

const login = (phone, password) => call("/auth/login", { method: "POST", body: { phone, password } });
const change = (token, body) => call("/me/change-password", { method: "POST", token, body });

before(async () => {
  const seeded = spawnSync(process.execPath, ["src/scripts/seed.js"], {
    cwd: ROOT,
    env: { ...process.env, MONGODB_URI: URI },
    stdio: "ignore",
  });
  assert.equal(seeded.status, 0, "seed her_test_l thất bại");
  proc = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: "4201", MONGODB_URI: URI, JWT_SECRET: "testsecret", MIN_CANCEL_HOURS: "3" },
    stdio: "ignore",
  });
  await waitHealthy(S);
  await mongoose.connect(URI);
});

after(async () => {
  proc?.kill();
  await mongoose.disconnect();
});

test("all-roles: 4 role đổi được; mật khẩu mới dùng được, cũ bị từ chối; token cũ vẫn sống", async () => {
  for (const phone of ["0999999999", "0900000000", "0911111111", "0909090909"]) {
    const { data } = await login(phone, "123456");
    assert.ok(data.token, `login ${phone}`);
    const r = await change(data.token, { currentPassword: "123456", newPassword: "matkhaumoi" });
    assert.equal(r.status, 200, `${phone}: ${JSON.stringify(r.data)}`);

    // Mật khẩu cũ chết, mới sống
    assert.equal((await login(phone, "123456")).status, 401, `${phone} mật khẩu cũ phải bị từ chối`);
    assert.equal((await login(phone, "matkhaumoi")).status, 200, `${phone} mật khẩu mới phải đăng nhập được`);

    // Token đang dùng vẫn hoạt động (không bắt đăng nhập lại)
    assert.equal((await call("/me", { token: data.token })).status, 200);

    // Trả về 123456 cho các test sau
    assert.equal((await change(data.token, { currentPassword: "matkhaumoi", newPassword: "123456" })).status, 200);
  }
});

test("wrong-current: sai mật khẩu hiện tại -> 400, mật khẩu KHÔNG đổi", async () => {
  const { data } = await login("0909090909", "123456");
  const r = await change(data.token, { currentPassword: "saibetnhe", newPassword: "matkhaumoi" });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /hiện tại/i, "phải nói rõ sai mật khẩu hiện tại (C6)");
  assert.equal((await login("0909090909", "123456")).status, 200, "mật khẩu phải giữ nguyên");
  assert.equal((await login("0909090909", "matkhaumoi")).status, 401);
});

test("validate: mật khẩu mới yếu/thiếu/sai kiểu -> 400; anon -> 401", async () => {
  const { data } = await login("0909090909", "123456");
  for (const body of [
    { currentPassword: "123456", newPassword: "12345" }, // < 6 ký tự
    { currentPassword: "123456" }, // thiếu
    { newPassword: "matkhaumoi" }, // thiếu current
    { currentPassword: "123456", newPassword: 123456789 }, // sai kiểu
    {},
  ]) {
    const r = await change(data.token, body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.ok(r.data.error, "phải có message tiếng Việt");
  }
  assert.equal((await call("/me/change-password", { method: "POST", body: { currentPassword: "x", newPassword: "matkhaumoi" } })).status, 401);
});

// ---------- Vòng review độc lập her-14: regression cho các fix ----------

const User = require("../src/models/User");

test("review-fix (A2): đổi mật khẩu -> token CŨ bị đá; token cấp SAU đổi vẫn dùng được", async () => {
  const oldTok = (await login("0909090909", "123456")).data.token;
  // đợi 3s để iat của token cũ chắc chắn < passwordChangedAt - 2s (biên trừ hao lệch giờ)
  await new Promise((r) => setTimeout(r, 3100));
  assert.equal((await change(oldTok, { currentPassword: "123456", newPassword: "matkhaumoi" })).status, 200);

  const rOld = await call("/me", { token: oldTok });
  assert.equal(rOld.status, 401, "token cấp TRƯỚC khi đổi phải chết");
  assert.match(rOld.data.error, /đăng nhập lại/i);

  const newTok = (await login("0909090909", "matkhaumoi")).data.token;
  assert.equal((await call("/me", { token: newTok })).status, 200, "token mới sống bình thường");
  assert.equal((await change(newTok, { currentPassword: "matkhaumoi", newPassword: "123456" })).status, 200);
});

test("review-fix (A2b): QUẦY cấp lại mật khẩu -> mọi phiên cũ của khách bị đá", async () => {
  const staffTok = (await login("0900000000", "123456")).data.token;
  const khTok = (await login("0912345678", "123456")).data.token;
  await new Promise((r) => setTimeout(r, 3100));

  const kh = await User.findOne({ phone: "0912345678" });
  const reset = await call(`/accounts/${kh._id}`, { method: "PATCH", token: staffTok, body: { password: "matkhauquay" } });
  assert.equal(reset.status, 200, JSON.stringify(reset.data));

  assert.equal((await call("/me", { token: khTok })).status, 401, "phiên cũ của khách phải chết sau khi quầy cấp lại");
  assert.equal((await login("0912345678", "123456")).status, 401, "mật khẩu cũ chết");
  const again = await login("0912345678", "matkhauquay");
  assert.equal(again.status, 200, "mật khẩu quầy cấp dùng được");
  // trả về 123456 giữ bộ demo
  assert.equal((await change(again.data.token, { currentPassword: "matkhauquay", newPassword: "123456" })).status, 200);
});

test("review-fix (A1): sai mật khẩu hiện tại quá 5 lần -> 429, đúng cũng không qua được trong cửa chặn", async () => {
  const tok = (await login("0911111111", "123456")).data.token;
  for (let i = 0; i < 5; i++) {
    assert.equal((await change(tok, { currentPassword: "saibet" + i, newPassword: "matkhaumoi" })).status, 400);
  }
  const blocked = await change(tok, { currentPassword: "saibet", newPassword: "matkhaumoi" });
  assert.equal(blocked.status, 429, "lần 6 phải bị chặn rate-limit");
  assert.match(blocked.data.error, /phút/);
  // Kể cả nhập ĐÚNG trong lúc bị chặn cũng không đổi được (chặn dò)
  assert.equal((await change(tok, { currentPassword: "123456", newPassword: "matkhaumoi" })).status, 429);
});

test("review-fix (C2/C3): user bị KHOÁ -> 403; kiểu mảng/object -> 400 không crash; body JSON hỏng -> 400", async () => {
  const adminTok = (await login("0999999999", "123456")).data.token;
  const khTok = (await login("0909090909", "123456")).data.token;
  const kh = await User.findOne({ phone: "0909090909" });
  assert.equal((await call(`/accounts/${kh._id}`, { method: "PATCH", token: adminTok, body: { isActive: false } })).status, 200);
  assert.equal((await change(khTok, { currentPassword: "123456", newPassword: "matkhaumoi" })).status, 403, "tài khoản khoá bị chặn (H6)");
  assert.equal((await call(`/accounts/${kh._id}`, { method: "PATCH", token: adminTok, body: { isActive: true } })).status, 200);

  const tok = (await login("0909090909", "123456")).data.token;
  for (const bad of [{ currentPassword: ["123456"], newPassword: "matkhaumoi" }, { currentPassword: { $gt: "" }, newPassword: "matkhaumoi" }]) {
    const r = await change(tok, bad);
    assert.equal(r.status, 400, JSON.stringify(bad));
  }
  const raw = await fetch(S + "/me/change-password", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
    body: "{hong json",
  });
  assert.equal(raw.status, 400);
  const j = await raw.json();
  assert.ok(j.error);
});
