// Test her-32 — Lịch tự động: luật sinh lớp phủ trước 7 ngày.
// her-35: luật mang LOẠI HÌNH (1:1/1:2/1:4/1:8), sức chứa suy ra từ loại hình — không còn capacity.
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
const AutoScheduleRule = require("../src/models/AutoScheduleRule");
const AutoScheduleLog = require("../src/models/AutoScheduleLog");
const { runAutoSchedule } = require("../src/utils/autoSchedule");

let proc;
const tokens = {};
let linhId;
let thuId;

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
// Mốc giờ CHÍNH XÁC mà luật sẽ sinh ra ở ngày NOW+off — neo test theo mốc này + coachId,
// không dựa vào tên lớp (seed đổi tên hay chạy lẻ 1 test cũng không nhặt nhầm)
const atDay = (off, hour, minute = 0) =>
  new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() + off, hour, minute, 0, 0);

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
  thuId = (await Trainer.findOne({ name: /Thu/ }))._id; // HLV yoga — dùng cho case 1:8
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
  const body = { format: "1:4", serviceType: "pilates", coachId: linhId.toString(), hour: 21, minute: 0, daysOfWeek: [1, 3] };
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
  // her-35: danh mục nay có 5 môn (gym/boxing/stretching/pilates/yoga) -> dùng key NGOÀI danh mục
  await bad({ serviceType: "zumba" }, /danh mục/);
  await bad({ daysOfWeek: [] }, /thứ/);
  await bad({ hour: 25 }, /Giờ/);
  // her-35: thiếu loại hình / loại hình lạ -> 400
  await bad({ format: undefined }, /Loại hình/);
  await bad({ format: "1:3" }, /Loại hình/);
  // her-35: 1:8 chỉ dành cho yoga
  await bad({ format: "1:8" }, /1:8.*[Yy]oga/);
  // HLV sai chuyên môn (Linh chỉ pilates)
  await bad({ serviceType: "gym" }, /chuyên môn/);

  // quầy tạo OK rồi xoá (giữ DB sạch cho các test sau)
  const ok = await call("/auto-schedule", { method: "POST", token: tokens.staff, body });
  assert.equal(ok.status, 201, JSON.stringify(ok.data));
  assert.equal(ok.data.rule.name, "Pilates");
  // her-35: response luật có format, KHÔNG còn capacity
  assert.equal(ok.data.rule.format, "1:4");
  assert.equal(ok.data.rule.capacity, undefined, "luật không còn field capacity");

  const list = await call("/auto-schedule", { token: tokens.staff });
  assert.equal(list.status, 200, JSON.stringify(list.data));
  const listed = list.data.rules.find((r) => r.id === ok.data.rule.id);
  assert.ok(listed, "luật vừa tạo phải có trong danh sách");
  assert.equal(listed.format, "1:4");
  assert.equal(listed.capacity, undefined, "GET cũng không còn capacity");

  assert.equal((await call(`/auto-schedule/${ok.data.rule.id}`, { method: "DELETE", token: tokens.admin })).status, 200);
  // Dọn CHÍNH xác lớp luật vừa sinh: đúng HLV + đúng khung 21:00 tương lai (không đụng seed)
  await GymClass.deleteMany({ coachId: linhId, name: "Pilates", startAt: { $gt: NOW } });
  await AutoScheduleLog.deleteMany({});
});

// ---------- 1a. her-35: case DƯƠNG cho loại hình 1:8 (chỉ yoga) ----------

test("her-35: luật 1:8 + yoga (HLV Thu) -> 201, lớp sinh ra có format 1:8 và sức chứa 8", async () => {
  // 20:00 — ngoài giờ dạy của Thu trong seed
  const body = { format: "1:8", serviceType: "yoga", coachId: thuId.toString(), hour: 20, minute: 0, daysOfWeek: [dow(2)] };
  const r = await call("/auto-schedule", { method: "POST", token: tokens.staff, body });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.rule.format, "1:8");
  assert.equal(r.data.created, 1, "phải sinh đúng 1 buổi trong cửa sổ 7 ngày");

  const born = await GymClass.findOne({ coachId: thuId, startAt: atDay(2, 20, 0) });
  assert.ok(born, "phải có lớp sinh đúng mốc 20:00 ngày +2 của HLV Thu");
  assert.equal(born.format, "1:8");
  assert.equal(born.capacity, 8, "1:8 -> sức chứa 8");
  assert.equal(born.serviceType, "yoga");

  assert.equal((await call(`/auto-schedule/${r.data.rule.id}`, { method: "DELETE", token: tokens.admin })).status, 200);
  await GymClass.deleteOne({ _id: born._id });
  await AutoScheduleLog.deleteMany({});
});

// ---------- 1a2. her-36: luật mang TÊN RIÊNG ----------

test("her-36: luật có TÊN RIÊNG -> lớp sinh ra mang đúng tên đó; bỏ trống tên -> lấy nhãn bộ môn", async () => {
  // Linh (pilates) rảnh khung 13h/14h trong seed (bận 9/11/15)
  const base = { format: "1:2", serviceType: "pilates", coachId: linhId.toString(), daysOfWeek: [dow(2)] };

  const named = await call("/auto-schedule", {
    method: "POST", token: tokens.staff, body: { ...base, hour: 13, minute: 0, name: "Pilates phục hồi" },
  });
  assert.equal(named.status, 201, JSON.stringify(named.data));
  assert.equal(named.data.rule.name, "Pilates phục hồi", "luật giữ tên riêng");
  const bornNamed = await GymClass.findOne({ coachId: linhId, startAt: atDay(2, 13, 0) });
  assert.ok(bornNamed, "phải có lớp sinh đúng mốc 13:00 ngày +2");
  assert.equal(bornNamed.name, "Pilates phục hồi", "buổi luật sinh ra mang TÊN của luật");

  const plain = await call("/auto-schedule", {
    method: "POST", token: tokens.staff, body: { ...base, hour: 14, minute: 0 },
  });
  assert.equal(plain.status, 201, JSON.stringify(plain.data));
  assert.equal(plain.data.rule.name, "Pilates", "bỏ trống tên -> nhãn bộ môn");
  const bornPlain = await GymClass.findOne({ coachId: linhId, startAt: atDay(2, 14, 0) });
  assert.ok(bornPlain);
  assert.equal(bornPlain.name, "Pilates");

  for (const id of [named.data.rule.id, plain.data.rule.id]) {
    assert.equal((await call(`/auto-schedule/${id}`, { method: "DELETE", token: tokens.admin })).status, 200);
  }
  await GymClass.deleteMany({ _id: { $in: [bornNamed._id, bornPlain._id] } });
  await AutoScheduleLog.deleteMany({});
});

test("her-36: tên luật 101 ký tự -> 400; toàn khoảng trắng -> lấy nhãn bộ môn", async () => {
  const base = { format: "1:2", serviceType: "pilates", coachId: linhId.toString(), hour: 16, minute: 0, daysOfWeek: [dow(2)] };

  const tooLong = await call("/auto-schedule", {
    method: "POST", token: tokens.staff, body: { ...base, name: "A".repeat(101) },
  });
  assert.equal(tooLong.status, 400, JSON.stringify(tooLong.data));
  assert.match(tooLong.data.error, /tối đa 100 ký tự/);
  assert.equal(await AutoScheduleRule.countDocuments({ hour: 16 }), 0, "không được tạo luật khi tên quá dài");

  const blank = await call("/auto-schedule", { method: "POST", token: tokens.staff, body: { ...base, name: "   " } });
  assert.equal(blank.status, 201, JSON.stringify(blank.data));
  assert.equal(blank.data.rule.name, "Pilates", "tên toàn khoảng trắng = bỏ trống");
  const born = await GymClass.findOne({ coachId: linhId, startAt: atDay(2, 16, 0) });
  assert.ok(born);
  assert.equal(born.name, "Pilates");

  assert.equal((await call(`/auto-schedule/${blank.data.rule.id}`, { method: "DELETE", token: tokens.admin })).status, 200);
  await GymClass.deleteOne({ _id: born._id });
  await AutoScheduleLog.deleteMany({});
});

// ---------- 1b. Review-fix V1: chặn 2 luật cùng HLV giao giờ + POST trả số buổi sinh ----------

test("review-fix (V1): luật thứ 2 cùng HLV giao giờ chung thứ -> 400; POST trả kèm số buổi đã sinh", async () => {
  // 12:00 — giờ Linh chắc chắn rảnh trong seed (bận 7h lớp, 8/10/15h slot, 19:30 lớp)
  const body = { format: "1:2", serviceType: "pilates", coachId: linhId.toString(), hour: 12, minute: 0, daysOfWeek: [dow(2)] };
  const r1 = await call("/auto-schedule", { method: "POST", token: tokens.admin, body });
  assert.equal(r1.status, 201, JSON.stringify(r1.data));
  assert.ok(typeof r1.data.created === "number" && r1.data.created >= 1, "POST phải trả số buổi vừa sinh");

  // her-35: lớp sinh ra mang đúng loại hình của luật, sức chứa = FORMAT_CAPACITY.
  // Neo theo HLV + đúng mốc 12:00 ngày +2 mà luật sinh, không theo tên lớp.
  const born = await GymClass.findOne({ coachId: linhId, startAt: atDay(2, 12, 0) });
  assert.ok(born, "phải có lớp sinh đúng mốc 12:00 ngày +2");
  assert.equal(born.format, "1:2");
  assert.equal(born.capacity, 2, "1:2 -> sức chứa 2");

  // Giao giờ (12:30 đè 12:00-13:00), chung thứ -> chặn
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
  // Chỉ 2 mốc 12:00 (ngày +2 và +4) của Linh là do 2 luật này sinh
  await GymClass.deleteMany({ coachId: linhId, startAt: { $in: [atDay(2, 12, 0), atDay(4, 12, 0)] } });
  await AutoScheduleLog.deleteMany({});
});

// ---------- 1c. Review-fix N9: 2 lượt sinh SONG SONG không đúp ----------

test("review-fix (N9): 2 runAutoSchedule song song — unique log giữ, không sinh lớp đúp", async () => {
  const rule = await AutoScheduleRule.create({
    serviceType: "pilates", name: "Auto N9", coachId: linhId,
    hour: 23, minute: 0, daysOfWeek: [dow(2)], format: "1:4",
  });
  const [a, b] = await Promise.all([runAutoSchedule(NOW), runAutoSchedule(NOW)]);
  assert.equal(a + b, 1, `tổng sinh phải đúng 1 (nhận ${a}+${b})`);
  assert.equal(await GymClass.countDocuments({ name: "Auto N9" }), 1);
  await rule.deleteOne();
  await GymClass.deleteMany({ name: "Auto N9" });
  await AutoScheduleLog.deleteMany({});
});

// ---------- 2+3. Sinh đúng cửa sổ + idempotent + không sinh lại ----------

test("sinh đúng thứ trong [hôm nay..+7]; chạy 2 lần không đúp; buổi bị XOÁ không sinh lại", async () => {
  // Luật 21:00 vào thứ của (+2) và (+5) — trong cửa sổ 8 ngày mỗi thứ này xuất hiện đúng 1 lần
  const rule = await AutoScheduleRule.create({
    serviceType: "pilates", name: "Auto W7", coachId: linhId,
    hour: 21, minute: 0, daysOfWeek: [...new Set([dow(2), dow(5)])].sort(), format: "1:4",
  });
  const created = await runAutoSchedule(NOW);
  assert.equal(created, 2, "sinh đúng 2 buổi (+2 và +5)");
  const classes = await GymClass.find({ name: "Auto W7", startAt: { $gt: NOW } }).sort({ startAt: 1 });
  assert.equal(classes.length, 2);
  for (const c of classes) {
    assert.equal(c.startAt.getHours(), 21);
    assert.equal(String(c.coachId), String(linhId));
    assert.equal(c.endAt - c.startAt, 3600 * 1000, "60 phút");
    assert.equal(c.format, "1:4");
    assert.equal(c.capacity, 4, "1:4 -> sức chứa 4");
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
    serviceType: "pilates", name: "Auto Qua", coachId: linhId,
    hour: 8, minute: 0, daysOfWeek: [dow(0)], format: "1:2",
  });
  assert.equal(await runAutoSchedule(NOW), 1, "chỉ sinh buổi ngày +7");
  const c = await GymClass.findOne({ name: "Auto Qua" });
  assert.equal(c.startAt.getDate(), new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() + 7).getDate());

  await AutoScheduleRule.updateOne({ _id: rule._id }, { active: false });
  await AutoScheduleLog.deleteMany({ ruleId: rule._id }); // xoá sổ — nếu luật còn bật sẽ sinh lại
  assert.equal(await runAutoSchedule(NOW), 0, "luật tắt không sinh dù sổ trống");

  await rule.deleteOne();
  await GymClass.deleteMany({ name: "Auto Qua" });
});

// ---------- 5. HLV trùng giờ ----------

test("HLV trùng giờ: buổi ngày đó bị bỏ qua (không ghi sổ — lần sau thử lại), ngày khác vẫn sinh", async () => {
  // Chặn ngày +3 lúc 22:00 bằng 1 lớp thủ công của Linh
  const day3 = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() + 3, 22, 0, 0);
  const blocker = await GymClass.create({
    name: "Chặn", serviceType: "pilates", format: "1:1", coachId: linhId,
    startAt: day3, endAt: new Date(day3.getTime() + 3600 * 1000), capacity: 1,
  });
  const rule = await AutoScheduleRule.create({
    serviceType: "pilates", name: "Auto Ban", coachId: linhId,
    hour: 22, minute: 0, daysOfWeek: [...new Set([dow(3), dow(4)])].sort(), format: "1:4",
  });
  assert.equal(await runAutoSchedule(NOW), 1, "ngày +3 bị chặn, chỉ sinh ngày +4");
  assert.equal(await AutoScheduleLog.countDocuments({ ruleId: rule._id }), 1, "ngày lỗi KHÔNG ghi sổ");

  // Gỡ lớp chặn → lần chạy sau sinh bù ngày +3
  await blocker.deleteOne();
  assert.equal(await runAutoSchedule(NOW), 1, "lần sau sinh bù buổi từng bị chặn");

  await rule.deleteOne();
  await GymClass.deleteMany({ name: "Auto Ban" });
  await AutoScheduleLog.deleteMany({});
});
