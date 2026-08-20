// Test her-34 — admin sửa hồ sơ HLV của chính mình: GET/PATCH /api/me/trainer-profile.
// Xem docs-her/testcase/testcase_her-34_admin_trainer_profile_edit.md
// DB riêng her_test_p (tự seed), server cổng 4241.

const { test, before, after } = require("node:test");
const assert = require("node:assert");
const { spawn, spawnSync } = require("node:child_process");
const path = require("node:path");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const ROOT = path.join(__dirname, "..");
const URI = "mongodb://localhost:27017/her_test_p";
const S = "http://localhost:4241/api";

const Trainer = require("../src/models/Trainer");
const User = require("../src/models/User");

let proc;
const tokens = {};
let adminTrainerId;

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

// Admin phụ tạo thẳng DB (POST /accounts không cho tạo role admin — đúng thiết kế)
async function makeAdmin(phone, name) {
  const passwordHash = await bcrypt.hash("123456", 10);
  const u = await User.create({ name, phone, passwordHash, role: "admin" });
  const { token } = await login(phone);
  return { user: u, token };
}

before(async () => {
  const seeded = spawnSync(process.execPath, ["src/scripts/seed.js"], {
    cwd: ROOT,
    env: { ...process.env, MONGODB_URI: URI },
    stdio: "ignore",
  });
  assert.equal(seeded.status, 0, "seed her_test_p thất bại");
  proc = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: "4241", MONGODB_URI: URI, JWT_SECRET: "testsecret", MIN_CANCEL_HOURS: "3" },
    stdio: "ignore",
  });
  await waitHealthy(S);
  await mongoose.connect(URI);

  tokens.admin = (await login("0999999999")).token;
  tokens.staff = (await login("0900000000")).token;
  tokens.trainer = (await login("0911111111")).token; // HLV Linh — CÓ trainerId
  tokens.customer = (await login("0909090909")).token; // Minh Anh

  // Admin chính mở hồ sơ HLV (đường POST sẵn có) — nền cho các case sửa
  const opened = await call("/me/trainer-profile", {
    method: "POST", token: tokens.admin, body: { name: "HLV Chu", specialties: ["pilates", "yoga"] },
  });
  assert.equal(opened.status, 201, JSON.stringify(opened.data));
  adminTrainerId = (await User.findOne({ phone: "0999999999" })).trainerId;
  assert.ok(adminTrainerId, "admin phải có trainerId sau khi mở hồ sơ");
});

after(async () => {
  proc?.kill();
  await mongoose.disconnect();
});

// ---------- 1. GET trả đúng hồ sơ (điền sẵn form) ----------

test("tp-get: GET trả đúng tên + chuyên môn hiện tại của hồ sơ HLV admin", async () => {
  const r = await call("/me/trainer-profile", { token: tokens.admin });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.trainer.name, "HLV Chu");
  assert.deepEqual([...r.data.trainer.specialties].sort(), ["pilates", "yoga"]);
});

// ---------- 2. PATCH đổi tên ----------

test("tp-rename: PATCH đổi tên hiển thị — Trainer đổi theo và hiện trong danh sách HLV", async () => {
  const r = await call("/me/trainer-profile", {
    method: "PATCH", token: tokens.admin, body: { name: "HLV Chu Moi" },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.trainer.name, "HLV Chu Moi");

  const doc = await Trainer.findById(adminTrainerId);
  assert.equal(doc.name, "HLV Chu Moi");
  // Chuyên môn không gửi -> giữ nguyên
  assert.deepEqual([...doc.specialties].sort(), ["pilates", "yoga"]);

  // Tên mới phải hiện ở danh sách HLV khách xem khi đặt PT
  const list = await call("/trainers", { token: tokens.customer });
  assert.equal(list.status, 200);
  assert.ok(list.data.trainers.some((t) => t.name === "HLV Chu Moi"), "danh sách HLV phải có tên mới");
});

// ---------- 3. PATCH đổi chuyên môn ----------

test("tp-specialties: PATCH đổi chuyên môn — lưu keys mới, nhãn tính lại từ danh mục", async () => {
  const r = await call("/me/trainer-profile", {
    method: "PATCH", token: tokens.admin, body: { specialties: ["yoga", "gym"] },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.trainer.specialties, ["yoga", "gym"]);

  const doc = await Trainer.findById(adminTrainerId);
  assert.deepEqual(doc.specialties, ["yoga", "gym"]);
  assert.equal(doc.specialty, "Yoga · Gym"); // nhãn join như lúc tạo
  assert.equal(doc.name, "HLV Chu Moi", "tên không gửi thì giữ nguyên");
});

// ---------- 4. PATCH cả hai field ----------

test("tp-both: PATCH tên + chuyên môn cùng lúc — cả hai đều lưu", async () => {
  const r = await call("/me/trainer-profile", {
    method: "PATCH", token: tokens.admin, body: { name: "HLV Hanh", specialties: ["pilates"] },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const doc = await Trainer.findById(adminTrainerId);
  assert.equal(doc.name, "HLV Hanh");
  assert.deepEqual(doc.specialties, ["pilates"]);
  assert.equal(doc.specialty, "Pilates");
});

// ---------- 5. Ma trận 4 role (L14/H5) — ẩn nút không phải phân quyền (C1) ----------

test("tp-matrix: học viên / lễ tân / HLV thường gọi GET + PATCH đều 403; anon 401", async () => {
  for (const [who, t] of [["customer", tokens.customer], ["staff", tokens.staff], ["trainer", tokens.trainer]]) {
    const g = await call("/me/trainer-profile", { token: t });
    assert.equal(g.status, 403, `${who} GET phải 403: ${JSON.stringify(g.data)}`);
    assert.ok(g.data.error, `${who} GET phải có error`);
    const p = await call("/me/trainer-profile", {
      method: "PATCH", token: t, body: { name: "Hack" },
    });
    assert.equal(p.status, 403, `${who} PATCH phải 403: ${JSON.stringify(p.data)}`);
    assert.ok(p.data.error, `${who} PATCH phải có error`);
  }
  // HLV Linh (có trainerId) bị chặn thì hồ sơ Linh phải còn nguyên
  const linh = await Trainer.findOne({ name: "HLV Linh" });
  assert.ok(linh, "hồ sơ HLV Linh không được đổi tên bởi lượt PATCH bị chặn");

  const anonGet = await call("/me/trainer-profile");
  assert.equal(anonGet.status, 401);
  const anon = await call("/me/trainer-profile", { method: "PATCH", body: { name: "x" } });
  assert.equal(anon.status, 401);
});

// ---------- 6. Admin CHƯA có hồ sơ HLV ----------

test("tp-no-profile: admin chưa bật hồ sơ — GET/PATCH 400 + lý do rõ", async () => {
  const { token } = await makeAdmin("0968000001", "Admin Phu");
  const g = await call("/me/trainer-profile", { token });
  assert.equal(g.status, 400, JSON.stringify(g.data));
  assert.match(g.data.error, /hồ sơ HLV/);
  const p = await call("/me/trainer-profile", { method: "PATCH", token, body: { name: "x" } });
  assert.equal(p.status, 400, JSON.stringify(p.data));
  assert.match(p.data.error, /hồ sơ HLV/);
});

// ---------- 7. Validate tên ----------

test("tp-bad-name: tên rỗng / khoảng trắng / quá 100 ký tự / sai kiểu -> 400", async () => {
  const before = await Trainer.findById(adminTrainerId);
  for (const name of ["", "   ", "x".repeat(101), 123, null, {}, []]) {
    const r = await call("/me/trainer-profile", { method: "PATCH", token: tokens.admin, body: { name } });
    assert.equal(r.status, 400, `name=${JSON.stringify(name)}: ${JSON.stringify(r.data)}`);
    assert.ok(r.data.error);
  }
  const doc = await Trainer.findById(adminTrainerId);
  assert.equal(doc.name, before.name, "tên không được đổi bởi input xấu");
});

// ---------- 8. Validate chuyên môn (C8, L1) ----------

test("tp-bad-specialties: mảng rỗng / môn lạ / kiểu sai -> 400, hồ sơ giữ nguyên", async () => {
  const before = await Trainer.findById(adminTrainerId);
  for (const specialties of [[], ["zumba"], "yoga", [123], [null], ["yoga", null], [["yoga"]], [{}]]) {
    const r = await call("/me/trainer-profile", { method: "PATCH", token: tokens.admin, body: { specialties } });
    assert.equal(r.status, 400, `specialties=${JSON.stringify(specialties)}: ${JSON.stringify(r.data)}`);
    assert.ok(r.data.error);
  }
  const doc = await Trainer.findById(adminTrainerId);
  assert.deepEqual([...doc.specialties], [...before.specialties], "chuyên môn không được đổi bởi input xấu");
});

// Review #6: tên hợp lệ + chuyên môn hỏng trong CÙNG request -> không được ghi một phần
test("tp-partial: name hợp lệ + specialties hỏng -> 400 và tên KHÔNG bị ghi", async () => {
  const before = await Trainer.findById(adminTrainerId);
  const r = await call("/me/trainer-profile", {
    method: "PATCH", token: tokens.admin, body: { name: "Ten Se Khong Duoc Ghi", specialties: ["zumba"] },
  });
  assert.equal(r.status, 400, JSON.stringify(r.data));
  const doc = await Trainer.findById(adminTrainerId);
  assert.equal(doc.name, before.name, "validate hết mới ghi — không ghi nửa chừng");
});

// ---------- 9. Body rỗng ----------

test("tp-empty-body: PATCH {} -> 400 'không có gì để sửa', không âm thầm 200", async () => {
  const r = await call("/me/trainer-profile", { method: "PATCH", token: tokens.admin, body: {} });
  assert.equal(r.status, 400, JSON.stringify(r.data));
  assert.ok(r.data.error);
});

// ---------- 10. Tài khoản khoá (H6) ----------

test("tp-locked: admin bị khoá còn giữ JWT -> PATCH bị từ chối kèm lý do khoá", async () => {
  const { user, token } = await makeAdmin("0968000002", "Admin Bi Khoa");
  await User.updateOne({ _id: user._id }, { $set: { isActive: false } });
  const r = await call("/me/trainer-profile", { method: "PATCH", token, body: { name: "x" } });
  assert.equal(r.status, 403, JSON.stringify(r.data));
  assert.match(r.data.error, /khoá/);
});

// ---------- 11. Hành vi sẵn có: đổi tên TÀI KHOẢN vẫn ghi đè tên hồ sơ HLV ----------

test("tp-account-rename: PATCH /me đổi tên tài khoản -> tên Trainer bị ghi đè (hành vi sẵn có, ghi nhận)", async () => {
  const r = await call("/me", { method: "PATCH", token: tokens.admin, body: { name: "Chu Phong Tap" } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const doc = await Trainer.findById(adminTrainerId);
  assert.equal(doc.name, "Chu Phong Tap");
});

// ---------- 12. Review #1: luật Lịch tự động chặn bỏ chuyên môn đang dùng ----------

test("tp-auto-rule: còn luật Lịch tự động môn nào (kể cả đang TẮT) thì không bỏ được chuyên môn đó", async () => {
  // Luật Pilates gán cho chính admin (23h để né trùng giờ lớp seed)
  const created = await call("/auto-schedule", {
    method: "POST", token: tokens.admin,
    // her-35: luật mang LOẠI HÌNH, sức chứa suy từ loại hình (không còn field capacity)
    body: { serviceType: "pilates", format: "1:4", coachId: adminTrainerId.toString(), hour: 23, minute: 0, daysOfWeek: [1, 3] },
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const ruleId = created.data.rule.id;

  // Bỏ pilates khi luật đang bật -> 400 nói rõ vướng Lịch tự động
  const blocked = await call("/me/trainer-profile", {
    method: "PATCH", token: tokens.admin, body: { specialties: ["yoga"] },
  });
  assert.equal(blocked.status, 400, JSON.stringify(blocked.data));
  assert.match(blocked.data.error, /Lịch tự động/);
  assert.deepEqual([...(await Trainer.findById(adminTrainerId)).specialties], ["pilates"]);

  // Giữ pilates trong danh sách mới -> vẫn sửa được bình thường
  const ok = await call("/me/trainer-profile", {
    method: "PATCH", token: tokens.admin, body: { specialties: ["pilates", "yoga"] },
  });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));

  // Luật TẮT vẫn chặn — bật lại là sinh lớp ngay, PATCH active không re-check chuyên môn
  assert.equal((await call(`/auto-schedule/${ruleId}`, { method: "PATCH", token: tokens.admin, body: { active: false } })).status, 200);
  const stillBlocked = await call("/me/trainer-profile", {
    method: "PATCH", token: tokens.admin, body: { specialties: ["yoga"] },
  });
  assert.equal(stillBlocked.status, 400, JSON.stringify(stillBlocked.data));

  // Xoá luật -> bỏ chuyên môn được
  assert.equal((await call(`/auto-schedule/${ruleId}`, { method: "DELETE", token: tokens.admin })).status, 200);
  const afterDelete = await call("/me/trainer-profile", {
    method: "PATCH", token: tokens.admin, body: { specialties: ["yoga"] },
  });
  assert.equal(afterDelete.status, 200, JSON.stringify(afterDelete.data));
});
