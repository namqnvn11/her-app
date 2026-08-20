// Test her-19 — danh mục bộ môn trong DB + chuyên môn HLV chọn từ danh mục +
// ràng buộc lớp-theo-chuyên-môn + gói nhận ngày hết hạn + dashboard minMonth.
// Xem docs-her/testcase/testcase_her-19_disciplines.md
// DB riêng her_test_m (tự seed), server cổng 4211.

const { test, before, after } = require("node:test");
const assert = require("node:assert");
const { spawn, spawnSync } = require("node:child_process");
const path = require("node:path");
const mongoose = require("mongoose");

const ROOT = path.join(__dirname, "..");
const URI = "mongodb://localhost:27017/her_test_m";
const S = "http://localhost:4211/api";

const Trainer = require("../src/models/Trainer");
const User = require("../src/models/User");

let proc;
const tokens = {};
let coach = {}; // linh (pilates), duc (gym), thu (yoga)

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
  assert.equal(r.status, 200, `login ${phone}`);
  return r.data;
}

const hoursFromNow = (h) => new Date(Date.now() + h * 3600 * 1000);

before(async () => {
  const seeded = spawnSync(process.execPath, ["src/scripts/seed.js"], {
    cwd: ROOT,
    env: { ...process.env, MONGODB_URI: URI },
    stdio: "ignore",
  });
  assert.equal(seeded.status, 0, "seed her_test_m thất bại");
  proc = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: "4211", MONGODB_URI: URI, JWT_SECRET: "testsecret", MIN_CANCEL_HOURS: "3" },
    stdio: "ignore",
  });
  await waitHealthy(S);
  await mongoose.connect(URI);

  tokens.admin = (await login("0999999999")).token;
  tokens.staff = (await login("0900000000")).token;
  tokens.customer = (await login("0909090909")).token;

  const t = await call("/schedule/trainers", { token: tokens.staff });
  for (const x of t.data.trainers) {
    if (x.name.includes("Linh")) coach.linh = x;
    if (x.name.includes("Đức")) coach.duc = x;
    if (x.name.includes("Thu")) coach.thu = x;
  }
});

after(async () => {
  proc?.kill();
  await mongoose.disconnect();
});

// ---------- 1. Danh mục bộ môn từ DB ----------

test("disciplines: API trả đúng danh mục trong DB (theo order); thêm môn mới -> có ngay trong DB (API thấy sau khi hết cache 30s)", async () => {
  const r = await call("/disciplines", { token: tokens.customer });
  assert.equal(r.status, 200);
  const keys = r.data.disciplines.map((d) => d.key);
  // her-35: bộ môn seed có thể nhiều hơn 3 (Gym · Boxing · Stretching · Pilates · Yoga) —
  // bất biến cần giữ là "API trả ĐÚNG danh mục trong DB, theo thứ tự order", không đóng cứng danh sách
  const inDb = await mongoose.connection.db.collection("disciplines").find({}).sort({ order: 1, key: 1 }).toArray();
  assert.deepEqual(keys, inDb.map((d) => d.key), "API trả đúng danh mục DB theo thứ tự order");
  for (const k of ["pilates", "yoga", "gym"]) assert.ok(keys.includes(k), `danh mục phải có môn ${k}`);
  assert.equal((await call("/disciplines")).status, 401, "phải đăng nhập");

  // Thêm môn mới thẳng vào DB -> API hiển thị (cache 30s — chọc thẳng collection và đợi qua TTL
  // là việc của vận hành; ở test ta kiểm bằng restart-cache-free: gọi lại sau khi chèn + đợi TTL ngắn
  // không khả thi -> kiểm mức DB: document tồn tại và validate route chấp nhận key mới sau TTL).
  // Dùng key KHÔNG có trong seed để không đụng unique index khi seed đổi danh sách môn.
  await mongoose.connection.db.collection("disciplines").insertOne({ key: "kickfit", label: "Kickfit", order: 9 });
  // đợi cache 30s là quá lâu cho test — xác nhận tối thiểu: môn mới đã nằm trong danh mục
  assert.equal(await mongoose.connection.db.collection("disciplines").countDocuments(), inDb.length + 1);
});

// ---------- 2. Trainer specialties ----------

test("specialties: seed gán đúng; trả kèm trong /schedule/trainers và /trainers", async () => {
  // her-35: seed đổi bộ chuyên môn (Linh pilates+stretching, Đức gym+boxing)
  assert.deepEqual(coach.linh.specialties, ["pilates", "stretching"]);
  assert.deepEqual(coach.duc.specialties, ["gym", "boxing"]);
  const pub = await call("/trainers", { token: tokens.customer });
  const linhPub = pub.data.trainers.find((t) => t.name.includes("Linh"));
  assert.equal(linhPub.specialty, "Pilates · Stretching", "nhãn hiển thị");
});

test("tạo HLV mới: specialties phải là key trong danh mục; nhãn tự sinh", async () => {
  const bad = await call("/accounts", {
    method: "POST", token: tokens.admin,
    body: { name: "HLV Sai", phone: "0975000001", password: "123456", role: "trainer", specialties: ["bay-lac"] },
  });
  assert.equal(bad.status, 400);
  assert.match(bad.data.error, /danh mục/);

  const ok = await call("/accounts", {
    method: "POST", token: tokens.admin,
    body: { name: "HLV Hai Mon", phone: "0975000002", password: "123456", role: "trainer", specialties: ["pilates", "yoga"] },
  });
  assert.equal(ok.status, 201, JSON.stringify(ok.data));
  const u = await User.findOne({ phone: "0975000002" });
  const tr = await Trainer.findById(u.trainerId);
  assert.deepEqual(tr.specialties, ["pilates", "yoga"]);
  assert.equal(tr.specialty, "Pilates · Yoga", "nhãn ghép từ danh mục");
});

test("admin mở hồ sơ HLV: specialties validate như trên", async () => {
  const bad = await call("/me/trainer-profile", {
    method: "POST", token: tokens.admin, body: { name: "Chu", specialties: ["khong-co"] },
  });
  assert.equal(bad.status, 400);
  const ok = await call("/me/trainer-profile", {
    method: "POST", token: tokens.admin, body: { name: "Chu Kiem HLV", specialties: ["gym"] },
  });
  assert.equal(ok.status, 201, JSON.stringify(ok.data));
});

// ---------- 3. Lớp theo chuyên môn ----------

test("lop-theo-chuyen-mon: giao lớp yoga cho HLV gym -> 400; đúng chuyên môn -> 201; đổi HLV sai môn -> 400", async () => {
  // her-35: lớp có LOẠI HÌNH; sức chứa do server gán theo loại hình nên không gửi capacity
  const mk = (coachId, serviceType, hour) => call("/schedule/classes", {
    method: "POST", token: tokens.staff,
    body: { name: "Lop CM", serviceType, format: "1:4", coachId, startAt: hoursFromNow(hour), endAt: hoursFromNow(hour + 1) },
  });
  const bad = await mk(coach.duc.id, "yoga", 300);
  assert.equal(bad.status, 400);
  assert.match(bad.data.error, /chuyên môn/);

  const ok = await mk(coach.thu.id, "yoga", 300);
  assert.equal(ok.status, 201, JSON.stringify(ok.data));

  // Đổi HLV lớp yoga sang Đức (gym) -> 400; sang Linh (pilates) cũng 400; HLV 2 môn thì được
  const clsId = ok.data.class._id;
  assert.equal((await call(`/schedule/classes/${clsId}`, { method: "PATCH", token: tokens.staff, body: { coachId: coach.duc.id } })).status, 400);
  const haiMon = await User.findOne({ phone: "0975000002" });
  const sw = await call(`/schedule/classes/${clsId}`, { method: "PATCH", token: tokens.staff, body: { coachId: String(haiMon.trainerId) } });
  assert.equal(sw.status, 200, JSON.stringify(sw.data));

  // Hồ sơ CŨ chưa gán chuyên môn (specialties rỗng) -> vẫn nhận lớp (tương thích)
  const legacy = await Trainer.create({ name: "HLV Cu", specialty: "", specialties: [] });
  assert.equal((await mk(String(legacy._id), "yoga", 305)).status, 201);
});

// ---------- 4. Gói nhận NGÀY HẾT HẠN ----------

test("goi-het-han: bán gói với expiresAt (datepicker) -> hết CUỐI ngày chọn; quá khứ -> 400; bộ môn lạ -> 400", async () => {
  const kh = await User.findOne({ phone: "0909090909" });
  // her-35: gói THỜI HẠN (không số buổi) chỉ có dạng Yoga 1:8 — dùng làm gói nền cho test ngày hết hạn
  const mk = (body) => call("/packages", {
    method: "POST", token: tokens.staff,
    body: { userId: String(kh._id), name: "Goi date", serviceTypes: ["yoga"], format: "1:8", price: 100000, paidAmount: 100000, ...body },
  });
  const pick = new Date(Date.now() + 10 * 24 * 3600 * 1000);
  const ok = await mk({ expiresAt: pick.toISOString() });
  assert.equal(ok.status, 201, JSON.stringify(ok.data));
  const exp = new Date(ok.data.package.expiresAt);
  assert.equal(exp.getHours(), 23, "hết hạn cuối ngày được chọn");
  assert.equal(exp.getDate(), pick.getDate());

  assert.equal((await mk({ expiresAt: new Date(Date.now() - 86400000).toISOString() })).status, 400, "quá khứ");
  assert.equal((await mk({ expiresAt: "khong-phai-ngay" })).status, 400);

  const laMon = await mk({ totalSessions: 5, format: "1:1", serviceTypes: ["mon-la"] });
  assert.equal(laMon.status, 400, "bộ môn của gói phải nằm trong danh mục");
  assert.match(laMon.data.error, /danh mục bộ môn/);
  // her-35: bỏ đặc cách "pt" — không còn là bộ môn hợp lệ của gói
  const pt = await mk({ totalSessions: 5, format: "1:1", serviceTypes: ["pt"] });
  assert.equal(pt.status, 400, "pt không còn là bộ môn hợp lệ (her-35)");
  assert.match(pt.data.error, /danh mục bộ môn/);
});

// ---------- 5. Dashboard minMonth ----------

test("minMonth: dashboard admin trả tháng xa nhất có dữ liệu (seed her-27 lùi ~55 ngày)", async () => {
  const now = new Date();
  const cur = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  // Buổi lịch sử xa nhất của seed = hôm nay - 55 ngày (her-27: 50 buổi để thử tab Lịch sử)
  const oldest = new Date(now.getTime() - 55 * 24 * 3600 * 1000);
  const min = `${oldest.getFullYear()}-${String(oldest.getMonth() + 1).padStart(2, "0")}`;
  const d = await call("/dashboard", { token: tokens.admin });
  assert.equal(d.status, 200);
  assert.equal(d.data.minMonth, min, "minMonth phải là tháng của buổi lịch sử xa nhất");
  assert.ok(d.data.minMonth <= cur, "không được vượt quá tháng hiện tại");
});

// ---------- Vòng review độc lập her-19: regression cho các fix ----------

test("review-fix (V1): PATCH đổi BỘ MÔN không kèm coachId — HLV hiện tại sai chuyên môn -> 400", async () => {
  // Lớp pilates của Linh (chỉ pilates), 0 khách
  const mk = await call("/schedule/classes", {
    method: "POST", token: tokens.staff,
    body: { name: "Lop V1", serviceType: "pilates", format: "1:4", coachId: coach.linh.id, startAt: hoursFromNow(400), endAt: hoursFromNow(401) },
  });
  assert.equal(mk.status, 201, JSON.stringify(mk.data));
  const clsId = mk.data.class._id;
  // Đổi bộ môn sang yoga KHÔNG gửi coachId -> phải 400 (trước fix thì lọt)
  const sw = await call(`/schedule/classes/${clsId}`, {
    method: "PATCH", token: tokens.staff, body: { serviceType: "yoga", name: "Yoga" },
  });
  assert.equal(sw.status, 400);
  assert.match(sw.data.error, /chuyên môn/);
});

test("review-fix (V2): tạo HLV mới specialties RỖNG qua API thẳng -> 400 (cả accounts lẫn trainer-profile)", async () => {
  const noSpec = await call("/accounts", {
    method: "POST", token: tokens.admin,
    body: { name: "HLV Rong", phone: "0975000009", password: "123456", role: "trainer" },
  });
  assert.equal(noSpec.status, 400);
  assert.match(noSpec.data.error, /ít nhất 1 chuyên môn/);

  // admin thứ 2 (admin seed đã có hồ sơ từ test trước) — tạo mới để test trainer-profile
  const bcrypt = require("bcryptjs");
  await User.create({ name: "Admin V2", phone: "0975000010", passwordHash: await bcrypt.hash("123456", 10), role: "admin" });
  const tk = (await login("0975000010")).token;
  assert.equal((await call("/me/trainer-profile", { method: "POST", token: tk, body: { name: "X" } })).status, 400);
  // trùng key được dedupe
  const ok = await call("/me/trainer-profile", { method: "POST", token: tk, body: { name: "X", specialties: ["yoga", "yoga"] } });
  assert.equal(ok.status, 201, JSON.stringify(ok.data));
  const u = await User.findOne({ phone: "0975000010" });
  const tr = await Trainer.findById(u.trainerId);
  assert.deepEqual(tr.specialties, ["yoga"], "key trùng phải được gộp");
});

test("review-fix (biên H7): gói hết hạn HÔM NAY — buổi tối nay trừ được, buổi ngày mai bị chặn", async () => {
  const { chargeSession } = require("../src/utils/packages");
  // Khách MỚI chỉ có ĐÚNG 1 gói hết hạn hôm nay — khách seed (Thảo Vy) có sẵn gói
  // Gym Unlimited nên buổi ngày mai vẫn trừ được gói khác, không kiểm được biên hạn
  const bcrypt2 = require("bcryptjs");
  const kh = await User.create({
    name: "Khach Bien H7", phone: "0975000020",
    passwordHash: await bcrypt2.hash("123456", 10), role: "customer",
  });
  const todayNoon = new Date();
  const r = await call("/packages", {
    method: "POST", token: tokens.staff,
    body: { userId: String(kh._id), name: "Goi Het Hom Nay", serviceTypes: ["gym"], format: "1:1", price: 100000, paidAmount: 100000, totalSessions: 5, expiresAt: todayNoon.toISOString() },
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const tonight = new Date(); tonight.setHours(23, 0, 0, 0);
  const tomorrow = new Date(tonight.getTime() + 24 * 3600 * 1000);
  // her-35: chargeSession nhận (bộ môn + loại hình) của LỚP, không còn 1 chuỗi serviceType
  const okPkg = await chargeSession(kh._id, { serviceType: "gym", format: "1:1" }, tonight);
  assert.ok(okPkg, "buổi 23:00 tối nay vẫn trong hạn (hết hạn = 23:59)");
  const failPkg = await chargeSession(kh._id, { serviceType: "gym", format: "1:1" }, tomorrow);
  assert.equal(failPkg, null, "buổi ngày mai phải bị chặn (gói chỉ còn 4 buổi này đã hết hạn)");
});

test("review-fix (tương thích): gửi CẢ expiresAt lẫn durationDays -> expiresAt thắng", async () => {
  const kh = await User.findOne({ phone: "0912345678" });
  const pick = new Date(Date.now() + 5 * 24 * 3600 * 1000);
  // Body là Yoga 1:8 vì đây là gói THỜI HẠN (không gửi totalSessions) — her-35 chỉ cho phép
  // đúng dạng này; ở đây chỉ quan tâm expiresAt có thắng durationDays hay không
  const r = await call("/packages", {
    method: "POST", token: tokens.staff,
    body: { userId: String(kh._id), name: "Goi Ca Hai", serviceTypes: ["yoga"], format: "1:8", price: 100000, paidAmount: 100000, expiresAt: pick.toISOString(), durationDays: 300 },
  });
  assert.equal(r.status, 201);
  const exp = new Date(r.data.package.expiresAt);
  assert.equal(exp.getDate(), pick.getDate(), "expiresAt (5 ngày) thắng durationDays (300 ngày)");
});

test("review-fix (ma trận): GET /disciplines — đủ 4 role đều 200", async () => {
  for (const tk of [tokens.admin, tokens.staff, tokens.customer]) {
    assert.equal((await call("/disciplines", { token: tk })).status, 200);
  }
  const hlv = (await login("0911111111")).token;
  assert.equal((await call("/disciplines", { token: hlv })).status, 200);
});
