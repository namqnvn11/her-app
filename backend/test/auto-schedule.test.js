// Test her-32 — Lịch tự động: luật sinh lớp group phủ trước 7 ngày.
// Xem docs-her/testcase/testcase_her-32_auto_schedule.md
// DB riêng her_test_o (tự seed), server cổng 4231.

const { test, before, after } = require("node:test");
const assert = require("node:assert");
const { spawn, spawnSync } = require("node:child_process");
const path = require("node:path");
const mongoose = require("mongoose");

const ROOT = path.join(__dirname, "..");
const URI = "mongodb://localhost:27017/her_test_o";
const S = "http://localhost:4231/api";

const GymClass = require("../src/models/GymClass");
const Trainer = require("../src/models/Trainer");
const User = require("../src/models/User");
const AutoScheduleRule = require("../src/models/AutoScheduleRule");
const AutoScheduleLog = require("../src/models/AutoScheduleLog");
const { runAutoSchedule } = require("../src/utils/autoSchedule");

let proc;
const tokens = {};
let linhId;

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

// now ghim CỐ ĐỊNH ở 12:00 hôm nay — mọi phép tính thứ/giờ đều xác định
const NOW = (() => { const d = new Date(); d.setHours(12, 0, 0, 0); return d; })();
const dow = (off) => new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() + off).getDay();

before(async () => {
  const seeded = spawnSync(process.execPath, ["src/scripts/seed.js"], {
    cwd: ROOT,
    env: { ...process.env, MONGODB_URI: URI },
    stdio: "ignore",
  });
  assert.equal(seeded.status, 0, "seed her_test_o thất bại");
  proc = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: "4231", MONGODB_URI: URI, JWT_SECRET: "testsecret", MIN_CANCEL_HOURS: "3" },
    stdio: "ignore",
  });
  await waitHealthy(S);
  await mongoose.connect(URI);

  tokens.admin = (await login("0999999999")).token;
  tokens.staff = (await login("0900000000")).token;
  tokens.trainer = (await login("0911111111")).token;
  tokens.customer = (await login("0909090909")).token;
  linhId = (await Trainer.findOne({ name: /Linh/ }))._id;
  // Suite này tự điều khiển máy sinh — xoá mọi thứ server nền có thể đã sinh lúc boot
  await AutoScheduleRule.deleteMany({});
  await AutoScheduleLog.deleteMany({});
});

after(async () => {
  proc?.kill();
  await mongoose.disconnect();
});

// ---------- 1. Ma trận quyền + validate ----------

test("matrix + validate: quầy/admin OK; HLV/khách 403; input sai 400", async () => {
  const body = { serviceType: "pilates", coachId: linhId.toString(), hour: 21, minute: 0, daysOfWeek: [1, 3], capacity: 8 };
  assert.equal((await call("/auto-schedule", { method: "POST", token: tokens.trainer, body })).status, 403);
  assert.equal((await call("/auto-schedule", { method: "POST", token: tokens.customer, body })).status, 403);
  assert.equal((await call("/auto-schedule", { token: tokens.customer })).status, 403);
  assert.equal((await call("/auto-schedule", {})).status, 401);

  // validate
  const bad = async (patch, msgRe) => {
    const r = await call("/auto-schedule", { method: "POST", token: tokens.admin, body: { ...body, ...patch } });
    assert.equal(r.status, 400, JSON.stringify(r.data));
    assert.match(r.data.error, msgRe);
  };
  await bad({ serviceType: "boxing" }, /danh mục/);
  await bad({ daysOfWeek: [] }, /thứ/);
  await bad({ hour: 25 }, /Giờ/);
  await bad({ capacity: 0 }, /Sức chứa/);
  // HLV sai chuyên môn (Linh chỉ pilates)
  await bad({ serviceType: "gym" }, /chuyên môn/);

  // quầy tạo OK rồi xoá (giữ DB sạch cho các test sau)
  const ok = await call("/auto-schedule", { method: "POST", token: tokens.staff, body });
  assert.equal(ok.status, 201, JSON.stringify(ok.data));
  assert.equal(ok.data.rule.name, "Pilates");
  assert.equal((await call(`/auto-schedule/${ok.data.rule.id}`, { method: "DELETE", token: tokens.admin })).status, 200);
  await GymClass.deleteMany({ startAt: { $gte: new Date() }, name: "Pilates", capacity: 8 });
  await AutoScheduleLog.deleteMany({});
});

// ---------- 1b. Review-fix V1: chặn 2 luật cùng HLV giao giờ + POST trả số buổi sinh ----------

test("review-fix (V1): luật thứ 2 cùng HLV giao giờ chung thứ -> 400; POST trả kèm số buổi đã sinh", async () => {
  // 12:00 — giờ Linh chắc chắn rảnh trong seed (bận 7h lớp, 8/10/15h slot, 19:30 lớp)
  const body = { serviceType: "pilates", coachId: linhId.toString(), hour: 12, minute: 0, daysOfWeek: [dow(2)], capacity: 6 };
  const r1 = await call("/auto-schedule", { method: "POST", token: tokens.admin, body });
  assert.equal(r1.status, 201, JSON.stringify(r1.data));
  assert.ok(typeof r1.data.created === "number" && r1.data.created >= 1, "POST phải trả số buổi vừa sinh");

  // Giao giờ (20:30 đè 20:00-21:00), chung thứ -> chặn
  const clash = await call("/auto-schedule", {
    method: "POST", token: tokens.admin,
    body: { ...body, minute: 30 },
  });
  assert.equal(clash.status, 400, JSON.stringify(clash.data));
  assert.match(clash.data.error, /lịch tự động khác/);

  // Cùng giờ nhưng KHÁC thứ -> vẫn tạo được
  const otherDay = await call("/auto-schedule", {
    method: "POST", token: tokens.admin,
    body: { ...body, daysOfWeek: [dow(4)] },
  });
  assert.equal(otherDay.status, 201, JSON.stringify(otherDay.data));

  for (const id of [r1.data.rule.id, otherDay.data.rule.id]) {
    await call(`/auto-schedule/${id}`, { method: "DELETE", token: tokens.admin });
  }
  await GymClass.deleteMany({ capacity: 6 });
  await AutoScheduleLog.deleteMany({});
});

// ---------- 1c. Review-fix N9: 2 lượt sinh SONG SONG không đúp ----------

test("review-fix (N9): 2 runAutoSchedule song song — unique log giữ, không sinh lớp đúp", async () => {
  const rule = await AutoScheduleRule.create({
    serviceType: "pilates", name: "Pilates", coachId: linhId,
    hour: 23, minute: 0, daysOfWeek: [dow(2)], capacity: 4,
  });
  const [a, b] = await Promise.all([runAutoSchedule(NOW), runAutoSchedule(NOW)]);
  assert.equal(a + b, 1, `tổng sinh phải đúng 1 (nhận ${a}+${b})`);
  assert.equal(await GymClass.countDocuments({ capacity: 4 }), 1);
  await rule.deleteOne();
  await GymClass.deleteMany({ capacity: 4 });
  await AutoScheduleLog.deleteMany({});
});

// ---------- 2+3. Sinh đúng cửa sổ + idempotent + không sinh lại ----------

test("sinh đúng thứ trong [hôm nay..+7]; chạy 2 lần không đúp; buổi bị XOÁ không sinh lại", async () => {
  // Luật 21:00 vào thứ của (+2) và (+5) — trong cửa sổ 8 ngày mỗi thứ này xuất hiện đúng 1 lần
  const rule = await AutoScheduleRule.create({
    serviceType: "pilates", name: "Pilates", coachId: linhId,
    hour: 21, minute: 0, daysOfWeek: [...new Set([dow(2), dow(5)])].sort(), capacity: 8,
  });
  const created = await runAutoSchedule(NOW);
  assert.equal(created, 2, "sinh đúng 2 buổi (+2 và +5)");
  const classes = await GymClass.find({ name: "Pilates", capacity: 8, startAt: { $gt: NOW } }).sort({ startAt: 1 });
  assert.equal(classes.length, 2);
  for (const c of classes) {
    assert.equal(c.startAt.getHours(), 21);
    assert.equal(String(c.coachId), String(linhId));
    assert.equal(c.endAt - c.startAt, 3600 * 1000, "60 phút");
  }
  assert.equal(await AutoScheduleLog.countDocuments({ ruleId: rule._id }), 2, "sổ ghi đủ");

  // Idempotent
  assert.equal(await runAutoSchedule(NOW), 0, "chạy lần 2 không sinh trùng");

  // Admin XOÁ 1 buổi đã sinh → không sinh lại (sổ còn)
  await GymClass.deleteOne({ _id: classes[0]._id });
  assert.equal(await runAutoSchedule(NOW), 0, "buổi đã xoá KHÔNG được tạo lại");

  await rule.deleteOne();
  await GymClass.deleteMany({ _id: classes[1]._id });
  await AutoScheduleLog.deleteMany({});
});

// ---------- 4. Giờ hôm nay đã qua + luật tắt ----------

test("giờ hôm nay đã qua thì bỏ (chỉ sinh lần lặp sau); luật tắt không sinh", async () => {
  // 08:00 (< NOW 12:00) vào thứ HÔM NAY → hôm nay bỏ, chỉ sinh ngày +7 (cùng thứ)
  const rule = await AutoScheduleRule.create({
    serviceType: "pilates", name: "Pilates", coachId: linhId,
    hour: 8, minute: 0, daysOfWeek: [dow(0)], capacity: 9,
  });
  assert.equal(await runAutoSchedule(NOW), 1, "chỉ sinh buổi ngày +7");
  const c = await GymClass.findOne({ capacity: 9 });
  assert.equal(c.startAt.getDate(), new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() + 7).getDate());

  await AutoScheduleRule.updateOne({ _id: rule._id }, { active: false });
  await AutoScheduleLog.deleteMany({ ruleId: rule._id }); // xoá sổ — nếu luật còn bật sẽ sinh lại
  assert.equal(await runAutoSchedule(NOW), 0, "luật tắt không sinh dù sổ trống");

  await rule.deleteOne();
  await GymClass.deleteMany({ capacity: 9 });
});

// ---------- 5. HLV trùng giờ ----------

test("HLV trùng giờ: buổi ngày đó bị bỏ qua (không ghi sổ — lần sau thử lại), ngày khác vẫn sinh", async () => {
  // Chặn ngày +3 lúc 22:00 bằng 1 lớp thủ công của Linh
  const day3 = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() + 3, 22, 0, 0);
  const blocker = await GymClass.create({
    name: "Chặn", serviceType: "pilates", coachId: linhId,
    startAt: day3, endAt: new Date(day3.getTime() + 3600 * 1000), capacity: 5,
  });
  const rule = await AutoScheduleRule.create({
    serviceType: "pilates", name: "Pilates", coachId: linhId,
    hour: 22, minute: 0, daysOfWeek: [...new Set([dow(3), dow(4)])].sort(), capacity: 7,
  });
  assert.equal(await runAutoSchedule(NOW), 1, "ngày +3 bị chặn, chỉ sinh ngày +4");
  assert.equal(await AutoScheduleLog.countDocuments({ ruleId: rule._id }), 1, "ngày lỗi KHÔNG ghi sổ");

  // Gỡ lớp chặn → lần chạy sau sinh bù ngày +3
  await blocker.deleteOne();
  assert.equal(await runAutoSchedule(NOW), 1, "lần sau sinh bù buổi từng bị chặn");

  await rule.deleteOne();
  await GymClass.deleteMany({ capacity: 7 });
  await AutoScheduleLog.deleteMany({});
});
