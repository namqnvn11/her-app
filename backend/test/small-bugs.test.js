// Test cho đợt sửa lỗi nhỏ L9–L17 — xem docs-her/testcase/testcase_her-01_small_bugs_L9_L17.md
// Chạy: node --test test/  (cần MongoDB local: docker start her-mongo)
// Dùng node:test có sẵn — dự án chưa chốt test framework nên không thêm dependency.
//
// Dựng 2 server thật với cấu hình khác nhau để kiểm tra các giá trị đọc từ env:
//   A (cổng 4101): cấu hình mặc định — MIN_CANCEL_HOURS=3, register đóng
//   B (cổng 4102): MIN_CANCEL_HOURS=2, register mở, rate-limit 3 lần / cửa sổ 3 giây

const { test, before, after } = require("node:test");
const assert = require("node:assert");
const { spawn, spawnSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");

const ROOT = path.join(__dirname, "..");
const URI_A = "mongodb://localhost:27017/her_test_a";
const URI_B = "mongodb://localhost:27017/her_test_b";
const A = "http://localhost:4101/api";
const B = "http://localhost:4102/api";
const SECRET = "testsecret";

const User = require("../src/models/User");

let procA, procB;

function startServer(port, env) {
  return spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), JWT_SECRET: SECRET, ...env },
    stdio: "ignore",
  });
}

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

async function call(base, pathName, { method = "GET", token, body } = {}) {
  const res = await fetch(base + pathName, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

async function login(base, phone, password = "123456") {
  const r = await call(base, "/auth/login", { method: "POST", body: { phone, password } });
  assert.equal(r.status, 200, `login ${phone} thất bại: ${JSON.stringify(r.data)}`);
  return r.data;
}

const hoursFromNow = (h) => new Date(Date.now() + h * 3600 * 1000);

before(async () => {
  // Seed lại 2 DB test để suite chạy độc lập, không phụ thuộc lần chạy trước
  for (const uri of [URI_A, URI_B]) {
    const seeded = spawnSync(process.execPath, ["src/scripts/seed.js"], {
      cwd: ROOT,
      env: { ...process.env, MONGODB_URI: uri },
      stdio: "ignore",
    });
    assert.equal(seeded.status, 0, `seed ${uri} thất bại`);
  }

  procA = startServer(4101, { MONGODB_URI: URI_A, MIN_CANCEL_HOURS: "3" });
  procB = startServer(4102, {
    MONGODB_URI: URI_B,
    MIN_CANCEL_HOURS: "2",
    ALLOW_SELF_REGISTER: "true",
    LOGIN_MAX_ATTEMPTS: "3",
    LOGIN_BLOCK_MINUTES: "0.1", // ~6 giây — đủ rộng để 3 lần bcrypt không tràn cửa sổ khi CPU bận
  });
  await Promise.all([waitHealthy(A), waitHealthy(B)]);
  await mongoose.connect(URI_A);
  // her-19: suite này test các bất biến CŨ với coach bất kỳ — gỡ ràng buộc chuyên môn của
  // seed (specialties rỗng = hồ sơ cũ, được phép dạy mọi lớp); luật chuyên môn có test riêng.
  await mongoose.connection.db.collection("trainers").updateMany({}, { $set: { specialties: [] } });
});

after(async () => {
  procA?.kill();
  procB?.kill();
  await mongoose.disconnect();
});

// ---------- L9: đăng nhập báo đúng lý do ----------

test("L9: tài khoản khoá + đúng mật khẩu -> 403 'Tài khoản đã bị khoá' ngay lần đầu, không cấp token", async () => {
  await User.updateOne({ phone: "0912345678" }, { isActive: false });
  const r = await call(A, "/auth/login", { method: "POST", body: { phone: "0912345678", password: "123456" } });
  assert.equal(r.status, 403);
  assert.match(r.data.error, /bị khoá/);
  assert.equal(r.data.token, undefined);
});

test("L9: tài khoản khoá + SAI mật khẩu -> 401 thông báo chung (không lộ tình trạng khoá)", async () => {
  try {
    const r = await call(A, "/auth/login", { method: "POST", body: { phone: "0912345678", password: "saimatkhau" } });
    assert.equal(r.status, 401);
    assert.match(r.data.error, /Sai số điện thoại hoặc mật khẩu/);
  } finally {
    await User.updateOne({ phone: "0912345678" }, { isActive: true }); // luôn mở khoá lại cho test sau
  }
});

// ---------- L10: số giờ hủy theo cấu hình, không hardcode ----------

test("L10: login và /me công bố config.minCancelHours đúng theo env từng server", async () => {
  const a = await login(A, "0909090909");
  const b = await login(B, "0909090909");
  assert.equal(a.config.minCancelHours, 3);
  assert.equal(b.config.minCancelHours, 2);
  const meA = await call(A, "/me", { token: a.token });
  assert.equal(meA.data.config.minCancelHours, 3);
});

test("L10: server MIN_CANCEL_HOURS=2 — hủy booking cách 2h30 THÀNH CÔNG, cách 1h bị chặn với message '2 tiếng'", async () => {
  const reception = await login(B, "0900000000");
  const customer = await login(B, "0912345678");

  // Dọn lịch có sẵn của khách này (lễ tân hủy hộ — không giới hạn giờ) để tránh trùng giờ
  const existing = await call(B, "/management/bookings", { token: reception.token });
  for (const bk of existing.data.bookings.filter((x) => x.customer.phone === "0912345678")) {
    await call(B, `/bookings/${bk.id}`, { method: "DELETE", token: reception.token });
  }

  // Buổi test chèn thẳng DB B — luật "HLV không trùng giờ" (đợt her-04) có thể chặn việc tạo
  // buổi sát giờ hiện tại qua API tuỳ thời điểm chạy; test này chỉ kiểm tra LUẬT HỦY.
  const connB = await mongoose.createConnection(URI_B).asPromise();
  const trainerB = await connB.collection("trainers").findOne({});
  // H7 (her-35): đặt buổi cần gói khớp bộ môn + loại hình — chèn cho Thảo Vy 1 gói MIX 1:1
  const vyB = await connB.collection("users").findOne({ phone: "0912345678" });
  await connB.collection("packages").insertOne({
    userId: vyB._id, name: "Gói mix test L10", serviceTypes: ["gym", "pilates"], format: "1:1", price: 1,
    totalSessions: 10, usedSessions: 0, activatedAt: new Date(), expiresAt: null,
    pausedAt: null, paymentMethod: "cash", paidAmount: 1, payments: [],
  });
  let clsSeq = 0;
  const makeClass = async (startH, endH) => {
    const r = await connB.collection("gymclasses").insertOne({
      name: `Buoi test L10 ${clsSeq++}`,
      serviceType: "pilates",
      format: "1:1",
      coachId: trainerB._id,
      startAt: hoursFromNow(startH),
      endAt: hoursFromNow(endH),
      capacity: 1,
      bookedCount: 0,
    });
    return r.insertedId.toString();
  };

  try {
    // Case hủy được: buổi cách 2h30 (> 2h)
    const farId = await makeClass(2.5, 3.5);
    const bookFar = await call(B, "/bookings", { method: "POST", token: customer.token, body: { classId: farId } });
    assert.equal(bookFar.status, 201, JSON.stringify(bookFar.data));
    const cancelFar = await call(B, `/bookings/${bookFar.data.booking.id}`, { method: "DELETE", token: customer.token });
    assert.equal(cancelFar.status, 200, "cách 2h30 với MIN=2 phải hủy được (trước đây app khoá vì hardcode 3)");

    // Case bị chặn: buổi cách 1h (< 2h) — message phải nói "2 tiếng" chứ không phải "3 tiếng"
    const nearId = await makeClass(1, 1.9);
    const bookNear = await call(B, "/bookings", { method: "POST", token: customer.token, body: { classId: nearId } });
    assert.equal(bookNear.status, 201, JSON.stringify(bookNear.data));
    const cancelNear = await call(B, `/bookings/${bookNear.data.booking.id}`, { method: "DELETE", token: customer.token });
    assert.equal(cancelNear.status, 403);
    assert.match(cancelNear.data.error, /2 tiếng/);
  } finally {
    await connB.close();
  }
});

// ---------- L12: tìm kiếm phía DB + phân trang ----------

test("L12: search theo tên/SĐT trả đúng khách, ký tự regex được escape", async () => {
  const staff = await login(A, "0900000000");
  const minh = await call(A, "/management/bookings", { token: staff.token, });
  const searchMinh = await call(A, "/management/bookings?search=Minh", { token: staff.token });
  assert.ok(searchMinh.data.bookings.length > 0);
  assert.ok(searchMinh.data.bookings.every((b) => b.customer.name.includes("Minh")));

  const searchPhone = await call(A, "/management/bookings?search=0912", { token: staff.token });
  assert.ok(searchPhone.data.bookings.every((b) => b.customer.phone.startsWith("0912")));

  // Regex đặc biệt không crash và không match bừa toàn bộ
  const paren = await call(A, "/management/bookings?search=%28", { token: staff.token });
  assert.equal(paren.status, 200);
  assert.equal(paren.data.bookings.length, 0);
  const dotStar = await call(A, "/management/bookings?search=.%2A", { token: staff.token });
  assert.equal(dotStar.status, 200);
  assert.equal(dotStar.data.bookings.length, 0, "'.*' phải được escape, không match tất cả");
  assert.ok(minh.status === 200); // sanity
});

test("L12: phân trang — trang 1 + hasMore, trang 2 phần còn lại, không trùng nhau", async () => {
  const staff = await login(A, "0900000000");
  const all = await call(A, "/management/bookings?range=upcoming", { token: staff.token });
  const total = all.data.bookings.length;
  assert.ok(total >= 3, `cần >=3 booking sắp tới từ seed, đang có ${total}`);

  const p1 = await call(A, "/management/bookings?range=upcoming&limit=2&page=1", { token: staff.token });
  const p2 = await call(A, "/management/bookings?range=upcoming&limit=2&page=2", { token: staff.token });
  assert.equal(p1.data.bookings.length, 2);
  assert.equal(p1.data.hasMore, true);
  assert.equal(p1.data.bookings.length + p2.data.bookings.length, Math.min(total, 4));
  const ids1 = new Set(p1.data.bookings.map((b) => b.id));
  assert.ok(p2.data.bookings.every((b) => !ids1.has(b.id)), "trang 2 không được lặp lại bản ghi trang 1");
});

// ---------- L13: chặn ngày quá khứ + thời lượng ----------

test("L13: parse ngày giờ ở app — ngày quá khứ báo lỗi, không âm thầm đẩy sang năm sau", () => {
  const src = fs
    .readFileSync(path.join(ROOT, "../mobile/src/utils/quickDateTime.js"), "utf8")
    .replace(/^export /gm, "");
  const mod = new Function(`${src}; return { parseQuickDateTime, parseDurationMinutes };`)();

  const now = new Date(2026, 7, 7, 12, 0); // 07/08/2026 12:00
  assert.ok(mod.parseQuickDateTime("05/01 07:00", now).error, "ngày quá khứ phải bị từ chối");
  assert.ok(mod.parseQuickDateTime("31/02 10:00", now).error, "ngày không tồn tại phải bị từ chối");
  assert.ok(mod.parseQuickDateTime("khong-phai-ngay", now).error);

  const ok = mod.parseQuickDateTime("25/12 07:30", now);
  assert.ok(!ok.error);
  assert.equal(ok.date.getFullYear(), 2026, "ngày hợp lệ giữ nguyên năm hiện tại");
  assert.equal(ok.date.getMonth(), 11);

  // Các case bổ sung sau vòng review độc lập
  assert.ok(mod.parseQuickDateTime("25/12 10:99", now).error, "phút 60-99 phải bị từ chối, không âm thầm đổi giờ");
  assert.ok(mod.parseQuickDateTime("25/12 24:00", now).error, "giờ 24 phải bị từ chối");
  const nextYear = mod.parseQuickDateTime("05/01/2027 07:00", now);
  assert.ok(!nextYear.error, "nhập đủ năm phải tạo được lịch cho năm sau");
  assert.equal(nextYear.date.getFullYear(), 2027);

  assert.equal(mod.parseDurationMinutes("90").minutes, 90);
  assert.equal(mod.parseDurationMinutes("").minutes, 60, "bỏ trống = mặc định 60 phút");
  assert.ok(mod.parseDurationMinutes("10").error, "dưới 15 phút bị từ chối");
  assert.ok(mod.parseDurationMinutes("999").error, "trên 240 phút bị từ chối");
  assert.ok(mod.parseDurationMinutes("90.5").error, "thời lượng phải là số nguyên");
});

// ---------- Các fix sau vòng review độc lập ----------

test("Review: login với phone/password không phải string -> 400, server không chết", async () => {
  const r1 = await call(A, "/auth/login", { method: "POST", body: { phone: { a: 1 }, password: "x" } });
  assert.equal(r1.status, 400);
  const r2 = await call(A, "/auth/login", { method: "POST", body: { phone: 123, password: ["x"] } });
  assert.equal(r2.status, 400);
  // Server vẫn sống và đăng nhập bình thường
  await login(A, "0909090909");
});

test("Review: loại hình rác bị chặn khi tạo lớp; PATCH lớp không lách được quy tắc thời gian", async () => {
  const staff = await login(A, "0900000000");
  const trainerId = (await call(A, "/schedule/trainers", { token: staff.token })).data.trainers[0].id;

  // her-35: sức chứa không còn nhận từ client — input rác giờ nằm ở LOẠI HÌNH,
  // gửi format lạ/thiếu phải 400 + { error } chứ không treo request (L1)
  for (const format of ["1:3", -5, null, undefined]) {
    const bad = await call(A, "/schedule/classes", {
      method: "POST", token: staff.token,
      body: { name: "X", serviceType: "pilates", format, coachId: trainerId, startAt: hoursFromNow(170), endAt: hoursFromNow(171) },
    });
    assert.equal(bad.status, 400, `format ${JSON.stringify(format)} phải bị từ chối`);
    assert.match(bad.data.error, /Loại hình/);
  }

  const created = await call(A, "/schedule/classes", {
    method: "POST", token: staff.token,
    body: { name: "Lop de patch", serviceType: "pilates", format: "1:4", coachId: trainerId, startAt: hoursFromNow(172), endAt: hoursFromNow(173) },
  });
  assert.equal(created.status, 201);
  const id = created.data.class._id;

  const toPast = await call(A, `/schedule/classes/${id}`, {
    method: "PATCH", token: staff.token, body: { startAt: hoursFromNow(-48), endAt: hoursFromNow(-47) },
  });
  assert.equal(toPast.status, 400, "PATCH dời lớp về quá khứ phải bị chặn");

  const reversed = await call(A, `/schedule/classes/${id}`, {
    method: "PATCH", token: staff.token, body: { endAt: hoursFromNow(171.5) },
  });
  assert.equal(reversed.status, 400, "PATCH làm endAt <= startAt phải bị chặn");

  const badCoach = await call(A, `/schedule/classes/${id}`, {
    method: "PATCH", token: staff.token, body: { coachId: "khong-phai-objectid" },
  });
  assert.equal(badCoach.status, 404, "coachId rác phải trả 404, không crash");
});

test("Review: search gửi lặp query (?search=a&search=b) không làm crash", async () => {
  const staff = await login(A, "0900000000");
  const r = await call(A, "/management/bookings?search=a&search=b", { token: staff.token });
  assert.equal(r.status, 200);
});

test("L13: gọi thẳng API tạo khung giờ quá khứ (HLV) / khoảng giờ ngược -> 400", async () => {
  const staff = await login(A, "0900000000");
  const trainerId = (await call(A, "/schedule/trainers", { token: staff.token })).data.trainers[0].id;

  // her-39 (20/08): luật "không tạo khung giờ quá khứ" chỉ còn áp cho HLV. QUẦY được dựng lại
  // buổi ĐÃ TẬP trong quá khứ (khách tập trước, đăng ký sau) — xem testcase_her-39.
  const trainer = await login(A, "0911111111"); // HLV Linh
  const trainerSelfId = (await call(A, "/me", { token: trainer.token })).data.user.trainerId;
  const pastByTrainer = await call(A, "/schedule/classes", {
    method: "POST",
    token: trainer.token,
    body: { name: "Lop qua khu HLV", serviceType: "pilates", format: "1:1", coachId: trainerSelfId, startAt: hoursFromNow(-24 * 300), endAt: hoursFromNow(-24 * 300 + 1) },
  });
  assert.equal(pastByTrainer.status, 400, JSON.stringify(pastByTrainer.data));
  assert.match(pastByTrainer.data.error, /quá khứ/);

  const pastByStaff = await call(A, "/schedule/classes", {
    method: "POST",
    token: staff.token,
    body: { name: "Lop qua khu quay", serviceType: "pilates", format: "1:4", coachId: trainerId, startAt: hoursFromNow(-24 * 300), endAt: hoursFromNow(-24 * 300 + 1) },
  });
  assert.equal(pastByStaff.status, 201, `quầy phải tạo được buổi quá khứ (her-39): ${JSON.stringify(pastByStaff.data)}`);

  const reversed = await call(A, "/schedule/classes", {
    method: "POST",
    token: staff.token,
    body: { name: "Lop nguoc gio", serviceType: "pilates", format: "1:1", coachId: trainerId, startAt: hoursFromNow(5), endAt: hoursFromNow(4) },
  });
  assert.equal(reversed.status, 400);
  assert.match(reversed.data.error, /kết thúc phải sau/);

  const valid = await call(A, "/schedule/classes", {
    method: "POST",
    token: staff.token,
    body: { name: "Lop hop le", serviceType: "pilates", format: "1:4", coachId: trainerId, startAt: hoursFromNow(175), endAt: hoursFromNow(176) },
  });
  assert.equal(valid.status, 201, "khung giờ tương lai hợp lệ vẫn tạo được bình thường");
});

// ---------- L14: endpoint tự đăng ký ----------

test("L14: register mặc định ĐÓNG (server A) -> 403", async () => {
  const r = await call(A, "/auth/register", {
    method: "POST",
    body: { name: "Ai Do", phone: "0944444444", password: "matkhau6" },
  });
  assert.equal(r.status, 403);
  assert.match(r.data.error, /không mở đăng ký/);
});

test("L14: bật ALLOW_SELF_REGISTER=true (server B) -> đăng ký được, có validate", async () => {
  const ok = await call(B, "/auth/register", {
    method: "POST",
    body: { name: "Khach Moi", phone: "0955555555", password: "matkhau6" },
  });
  assert.equal(ok.status, 201, JSON.stringify(ok.data));
  assert.equal(ok.data.user.role, "customer");

  const badPhone = await call(B, "/auth/register", {
    method: "POST",
    body: { name: "X", phone: "12345", password: "matkhau6" },
  });
  assert.equal(badPhone.status, 400);
  const shortPass = await call(B, "/auth/register", {
    method: "POST",
    body: { name: "X", phone: "0956666666", password: "123" },
  });
  assert.equal(shortPass.status, 400);
});

// ---------- L15: seed luôn có buổi sát giờ ----------

test("L15: sau seed, Minh Anh luôn có 1 booking cách hiện tại < MIN_CANCEL_HOURS (demo nút hủy khoá)", async () => {
  const { token, config } = await login(A, "0909090909");
  const r = await call(A, "/me/bookings", { token });
  const soon = r.data.bookings.find(
    (b) => (new Date(b.startAt) - Date.now()) / 3600000 < config.minCancelHours
  );
  assert.ok(soon, "phải có ít nhất 1 buổi sát giờ bất kể seed chạy lúc mấy giờ");
});

// ---------- L17: siết bảo mật ----------

test("L17: validate SĐT + mật khẩu khi lễ tân tạo tài khoản", async () => {
  const staff = await login(A, "0900000000");
  const badPhone = await call(A, "/accounts", {
    method: "POST", token: staff.token,
    body: { name: "X", phone: "abc", password: "matkhau6", role: "customer" },
  });
  assert.equal(badPhone.status, 400);
  assert.match(badPhone.data.error, /Số điện thoại không hợp lệ/);

  const shortPass = await call(A, "/accounts", {
    method: "POST", token: staff.token,
    body: { name: "X", phone: "0933333333", password: "123", role: "customer" },
  });
  assert.equal(shortPass.status, 400);
  assert.match(shortPass.data.error, /tối thiểu 6 ký tự/);

  const valid = await call(A, "/accounts", {
    method: "POST", token: staff.token,
    body: { name: "Khach Hop Le", phone: "0933333333", password: "matkhau6", role: "customer" },
  });
  assert.equal(valid.status, 201, JSON.stringify(valid.data));
});

test("L17: JWT hết hạn sau 7 ngày (mặc định mới thay vì 30)", async () => {
  const { token } = await login(A, "0909090909");
  const payload = jwt.decode(token);
  assert.equal(payload.exp - payload.iat, 7 * 24 * 3600);
});

test("L17: chặn đoán mật khẩu — sai quá số lần bị 429 kể cả khi nhập đúng, hết cửa sổ thì login lại được", async () => {
  // Server B: LOGIN_MAX_ATTEMPTS=3, cửa sổ ~3 giây. Dùng SĐT HLV để không đụng test khác.
  const phone = "0911111111";
  for (let i = 0; i < 3; i++) {
    const r = await call(B, "/auth/login", { method: "POST", body: { phone, password: "sai-mat-khau" } });
    assert.equal(r.status, 401);
  }
  const blocked = await call(B, "/auth/login", { method: "POST", body: { phone, password: "123456" } });
  assert.equal(blocked.status, 429, "đúng mật khẩu nhưng đang trong cửa sổ chặn vẫn phải 429");
  assert.match(blocked.data.error, /thử lại sau/);

  await new Promise((r) => setTimeout(r, 7000)); // đợi hết cửa sổ chặn (6s + dư 1s)
  const ok = await call(B, "/auth/login", { method: "POST", body: { phone, password: "123456" } });
  assert.equal(ok.status, 200, "hết cửa sổ chặn phải đăng nhập lại được");
});

// ---------- Hồi quy: luồng chính không vỡ ----------

test("Hồi quy: 4 role đăng nhập, khách đặt lớp + hủy, buổi được hoàn về gói", async () => {
  for (const phone of ["0999999999", "0900000000", "0911111111", "0909090909"]) {
    await login(A, phone);
  }

  const customer = await login(A, "0912345678"); // Thảo Vy — gói yoga (card /me/package trả gói này)
  const before = (await call(A, "/me/package", { token: customer.token })).data.package.usedSessions;

  // Duyệt từ lớp xa nhất (chắc chắn >3h và ít nguy cơ trùng giờ lịch có sẵn), lấy lớp đặt được đầu tiên.
  // Chỉ lấy lớp YOGA để buổi trừ vào đúng gói mà /me/package đang hiển thị (H7 — Thảo Vy có 2 gói)
  const classes = (await call(A, "/classes", { token: customer.token })).data.classes.reverse();
  let booked = null;
  for (const c of classes) {
    if (c.spotsLeft === 0 || c.serviceType !== "yoga") continue;
    assert.ok(c.format, "danh sách lớp phải trả loại hình cho app hiển thị");
    const r = await call(A, "/bookings", { method: "POST", token: customer.token, body: { classId: c.id } });
    if (r.status === 201) { booked = r.data.booking; break; }
  }
  assert.ok(booked, "phải đặt được ít nhất 1 lớp");
  assert.equal((await call(A, "/me/package", { token: customer.token })).data.package.usedSessions, before + 1);

  const cancel = await call(A, `/bookings/${booked.id}`, { method: "DELETE", token: customer.token });
  assert.equal(cancel.status, 200);
  assert.equal(
    (await call(A, "/me/package", { token: customer.token })).data.package.usedSessions,
    before,
    "hủy xong số buổi đã dùng phải quay về như cũ"
  );
});

test("Hồi quy: HLV chỉ thấy lịch của chính mình trong /management/bookings", async () => {
  const trainer = await login(A, "0911111111"); // HLV Linh
  const r = await call(A, "/management/bookings?range=all", { token: trainer.token });
  assert.equal(r.status, 200);
  assert.ok(r.data.bookings.length > 0, "HLV Linh có lớp được đặt trong seed");
  assert.ok(
    r.data.bookings.every((b) => b.coach === "HLV Linh"),
    "không được lộ lịch của HLV khác"
  );
});
