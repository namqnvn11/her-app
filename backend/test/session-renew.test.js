// Test her-45 — phiên đăng nhập 30 ngày + GIA HẠN TRƯỢT ở GET /me
// Xem docs-her/testcase/testcase_her-45_session_renew.md
// DB riêng her_test_s (tự seed), server cổng 4271.

const { test, before, after } = require("node:test");
const assert = require("node:assert");
const { spawn, spawnSync } = require("node:child_process");
const path = require("node:path");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");

const ROOT = path.join(__dirname, "..");
const URI = "mongodb://localhost:27017/her_test_s";
const S = "http://localhost:4271/api";
const SECRET = "testsecret";
const EXPIRES_IN = "30d";

const User = require("../src/models/User");

let proc;
const tokens = {};
const users = {};

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

const decode = (t) => jwt.decode(t);
const daysFromNow = (t) => (decode(t).exp * 1000 - Date.now()) / 86400000;

// Token "cũ" thật sự: tự ký với iat lùi về quá khứ. jsonwebtoken tính exp = iat + expiresIn,
// nên token vẫn CÒN HẠN nhưng đã quá ngưỡng gia hạn.
const tokenIssuedDaysAgo = (user, days, expiresIn = EXPIRES_IN) =>
  jwt.sign(
    { sub: user._id.toString(), role: user.role, iat: Math.floor(Date.now() / 1000) - Math.round(days * 86400) },
    SECRET,
    { expiresIn }
  );

before(async () => {
  const seeded = spawnSync(process.execPath, ["src/scripts/seed.js"], {
    cwd: ROOT,
    env: { ...process.env, MONGODB_URI: URI },
    stdio: "ignore",
  });
  assert.equal(seeded.status, 0, "seed her_test_s thất bại");
  proc = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: "4271", MONGODB_URI: URI, JWT_SECRET: SECRET, JWT_EXPIRES_IN: EXPIRES_IN },
    stdio: "ignore",
  });
  await waitHealthy(S);
  await mongoose.connect(URI);

  tokens.customer = (await login("0909090909")).token;
  tokens.staff = (await login("0900000000")).token;
  users.customer = await User.findOne({ phone: "0909090909" });
  users.staff = await User.findOne({ phone: "0900000000" });
  users.trainer = await User.findOne({ phone: "0911111111" });
});

after(async () => {
  proc?.kill();
  await mongoose.disconnect();
});

// ---------- 1. Hạn phiên ----------

test("expiry-30d: token cấp lúc đăng nhập có hạn đúng 30 ngày", async () => {
  const d = daysFromNow(tokens.customer);
  assert.ok(d > 29.9 && d <= 30.01, `hạn phải ~30 ngày, nhận ${d.toFixed(2)}`);
});

// ---------- 2. Gia hạn trượt ----------

test("renew: token đã cũ (5 ngày) -> /me trả token MỚI, hạn tính lại 30 ngày từ BÂY GIỜ", async () => {
  const old = tokenIssuedDaysAgo(users.customer, 5);
  assert.ok(daysFromNow(old) < 25.1, "token cũ chỉ còn ~25 ngày");

  const r = await call("/me", { token: old });
  assert.equal(r.status, 200);
  assert.ok(r.data.token, "phải trả token mới");
  const d = daysFromNow(r.data.token);
  assert.ok(d > 29.9 && d <= 30.01, `token mới phải ~30 ngày, nhận ${d.toFixed(2)}`);

  // Token mới phải DÙNG ĐƯỢC và vẫn đúng người, đúng vai trò (không leo quyền)
  const me2 = await call("/me", { token: r.data.token });
  assert.equal(me2.status, 200);
  assert.equal(me2.data.user.id, users.customer._id.toString());
  assert.equal(decode(r.data.token).role, "customer");
  assert.equal(decode(r.data.token).sub, users.customer._id.toString());
});

test("renew-off: token vừa cấp (chưa tới 1 ngày) -> /me KHÔNG trả token", async () => {
  const r = await call("/me", { token: tokens.customer });
  assert.equal(r.status, 200);
  assert.equal(r.data.token, undefined, "chưa tới ngưỡng thì không được ký lại + bắt app ghi bộ nhớ");
});

test("renew-bien: 23h chưa gia hạn, 25h thì có (ngưỡng 1 ngày)", async () => {
  const chua = await call("/me", { token: tokenIssuedDaysAgo(users.customer, 23 / 24) });
  assert.equal(chua.data.token, undefined, "23 tiếng: chưa gia hạn");
  const roi = await call("/me", { token: tokenIssuedDaysAgo(users.customer, 25 / 24) });
  assert.ok(roi.data.token, "25 tiếng: phải gia hạn");
});

test("renew-lien-tuc: mở app đều đặn 29 ngày/lần thì phiên KHÔNG bao giờ chết", async () => {
  // Mô phỏng 3 lần mở app cách nhau 29 ngày: mỗi lần nhận token mới, lần sau vẫn còn hạn
  let t = tokens.customer;
  for (let lan = 1; lan <= 3; lan++) {
    const cu = tokenIssuedDaysAgo(users.customer, 29); // như thể token nhận lần trước đã 29 ngày
    const r = await call("/me", { token: cu });
    assert.equal(r.status, 200, `lần mở app thứ ${lan} phải còn dùng được`);
    assert.ok(r.data.token, `lần ${lan} phải được gia hạn`);
    t = r.data.token;
  }
  assert.ok(daysFromNow(t) > 29.9, "sau 3 vòng vẫn còn ~30 ngày");
});

// ---------- 3. Gia hạn KHÔNG được cứu phiên đáng lẽ phải chết ----------

test("renew-het-han: token đã QUÁ hạn -> 401, không gia hạn", async () => {
  const chet = jwt.sign(
    { sub: users.customer._id.toString(), role: "customer", iat: Math.floor(Date.now() / 1000) - 40 * 86400 },
    SECRET,
    { expiresIn: EXPIRES_IN } // exp = iat + 30 ngày -> đã qua 10 ngày
  );
  const r = await call("/me", { token: chet });
  assert.equal(r.status, 401);
  assert.equal(r.data.token, undefined, "hết hạn thì tuyệt đối không được cấp token mới");
  assert.match(r.data.error, /hết hạn|không hợp lệ/i);
});

test("renew-khoa: tài khoản BỊ KHOÁ -> 403, không gia hạn (H6)", async () => {
  const u = await User.findOne({ phone: "0977000002" }) || users.trainer;
  const cu = tokenIssuedDaysAgo(u, 5);
  await User.updateOne({ _id: u._id }, { $set: { isActive: false } });
  try {
    const r = await call("/me", { token: cu });
    assert.equal(r.status, 403);
    assert.equal(r.data.token, undefined, "tài khoản khoá mà còn gia hạn là hở H6");
    assert.match(r.data.error, /khoá/i);
  } finally {
    await User.updateOne({ _id: u._id }, { $set: { isActive: true } });
  }
});

test("renew-doi-mat-khau: token cấp TRƯỚC lần đổi mật khẩu -> 401, không gia hạn", async () => {
  const cu = tokenIssuedDaysAgo(users.staff, 5);
  await User.updateOne({ _id: users.staff._id }, { $set: { passwordChangedAt: new Date() } });
  try {
    const r = await call("/me", { token: cu });
    assert.equal(r.status, 401);
    assert.equal(r.data.token, undefined, "đổi mật khẩu phải cắt phiên cũ, gia hạn không được cứu");
    assert.match(r.data.error, /Mật khẩu đã được thay đổi/);
  } finally {
    await User.updateOne({ _id: users.staff._id }, { $unset: { passwordChangedAt: "" } });
  }
});

test("renew-token-rac: chữ ký sai -> 401, không gia hạn", async () => {
  const gia = jwt.sign(
    { sub: users.customer._id.toString(), role: "admin", iat: Math.floor(Date.now() / 1000) - 5 * 86400 },
    "secret-gia",
    { expiresIn: EXPIRES_IN }
  );
  const r = await call("/me", { token: gia });
  assert.equal(r.status, 401);
  assert.equal(r.data.token, undefined);
});

// ---------- 4. Không phá phần cũ ----------

test("renew-khong-doi-shape: /me vẫn trả user + config như cũ", async () => {
  const r = await call("/me", { token: tokens.staff });
  assert.equal(r.status, 200);
  assert.ok(r.data.user && r.data.user.id && r.data.user.role === "reception");
  assert.equal(typeof r.data.config.minCancelHours, "number");
  assert.equal(typeof r.data.config.attendanceOpenBeforeMinutes, "number");
  assert.equal(typeof r.data.config.minPasswordLength, "number");
});

test("renew-chi-o-me: endpoint khác KHÔNG tự trả token (một đường gia hạn duy nhất)", async () => {
  const cu = tokenIssuedDaysAgo(users.staff, 5);
  for (const p of ["/dashboard", "/accounts?role=customer", "/me/packages"]) {
    const r = await call(p, { token: cu });
    assert.ok(r.status === 200 || r.status === 403, `${p}: ${r.status}`);
    if (r.data) assert.equal(r.data.token, undefined, `${p} không được trả token`);
  }
});

test("renew-anon: không có token -> 401, không có gì được cấp", async () => {
  const r = await call("/me");
  assert.equal(r.status, 401);
  assert.equal(r.data.token, undefined);
});
