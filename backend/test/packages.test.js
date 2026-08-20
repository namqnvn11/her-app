// Test cho đợt her-05: module gói tập + luật H7 — xem docs-her/testcase/testcase_her-05_package_module.md
// her-35 (19/08): gói tập là gói MIX — nhiều BỘ MÔN (serviceTypes[]) + đúng 1 LOẠI HÌNH
// (1:1/1:2/1:4/1:8). Gói BUỔI chỉ 1:1/1:2/1:4; gói THỜI HẠN chỉ Yoga 1:8. Không còn PT slot:
// mọi buổi là lớp có loại hình, body đặt lịch chỉ còn { classId }.
// Chạy: npm test  (cần MongoDB local: docker start her-mongo)
// Suite này dùng DB riêng her_test_f (tự seed lại mỗi lần chạy) + server thật cổng 4141.
// Mọi khung giờ test tạo mới đều nằm NGOÀI lưới seed 168h (quy ước từ her-04).
// Các test KHÔNG dựa vào gói của seed: mỗi case tự tạo khách + gói riêng (her-35: bộ gói demo đổi).

const { test, before, after } = require("node:test");
const assert = require("node:assert");
const { spawn, spawnSync } = require("node:child_process");
const path = require("node:path");
const mongoose = require("mongoose");

const ROOT = path.join(__dirname, "..");
const URI = "mongodb://localhost:27017/her_test_f";
const S = "http://localhost:4141/api";

const Package = require("../src/models/Package");

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

async function login(phone, password = "123456") {
  const r = await call(S, "/auth/login", { method: "POST", body: { phone, password } });
  assert.equal(r.status, 200, `login ${phone} thất bại: ${JSON.stringify(r.data)}`);
  return r.data;
}

const hoursFromNow = (h) => new Date(Date.now() + h * 3600 * 1000);

let admin, staff, trainer, minhAnh; // { token, user }
let coachIds; // id 3 HLV từ /schedule/trainers

before(async () => {
  const seeded = spawnSync(process.execPath, ["src/scripts/seed.js"], {
    cwd: ROOT,
    env: { ...process.env, MONGODB_URI: URI },
    stdio: "ignore",
  });
  assert.equal(seeded.status, 0, "seed her_test_f thất bại");

  proc = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: "4141", MONGODB_URI: URI, JWT_SECRET: "testsecret", MIN_CANCEL_HOURS: "3" },
    stdio: "ignore",
  });
  await waitHealthy(S);
  await mongoose.connect(URI);
  // her-19: suite này test các bất biến CŨ với coach bất kỳ — gỡ ràng buộc chuyên môn của
  // seed (specialties rỗng = hồ sơ cũ, được phép dạy mọi lớp); luật chuyên môn có test riêng.
  await mongoose.connection.db.collection("trainers").updateMany({}, { $set: { specialties: [] } });

  admin = await login("0999999999");
  staff = await login("0900000000");
  trainer = await login("0911111111");
  minhAnh = await login("0909090909");
  const t = await call(S, "/schedule/trainers", { token: staff.token });
  coachIds = t.data.trainers.map((x) => x.id);
});

after(async () => {
  proc?.kill();
  await mongoose.disconnect();
});

// ---- Tiện ích fixture (đều đi qua API thật) ----

// Lớp giờ xa (ngoài lưới seed): mỗi lần gọi dùng hour KHÁC nhau (cách nhau ≥ 2 tiếng) để
// không chồng giờ — HLV đã có lớp trùng khung giờ thì server chặn ngay khi tạo.
// her-35: sức chứa do LOẠI HÌNH quyết định — server tự gán, client KHÔNG gửi capacity.
async function createClass({ serviceType, format, hour, name = `Lop test ${hour}` }) {
  const r = await call(S, "/schedule/classes", {
    method: "POST",
    token: staff.token,
    body: {
      name,
      serviceType,
      format,
      coachId: coachIds[hour % coachIds.length],
      startAt: hoursFromNow(hour),
      endAt: hoursFromNow(hour + 1),
    },
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data.class;
}

const book = (token, cls) =>
  call(S, "/bookings", { method: "POST", token, body: { classId: cls._id || cls.id } });

let phoneSeq = 0;
async function createCustomer() {
  const phone = `09770000${String(phoneSeq++).padStart(2, "0")}`;
  const r = await call(S, "/accounts", {
    method: "POST",
    token: staff.token,
    body: { name: `KH test ${phone}`, phone, password: "123456", role: "customer" },
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return { account: r.data.account, ...(await login(phone)) };
}

async function createPackage(userId, body, token = staff.token) {
  const r = await call(S, "/packages", { method: "POST", token, body: { userId, ...body } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data.package;
}

// ---------- Ma trận phân quyền route /packages ----------

test("matrix: POST /packages — admin/lễ tân được, HLV/khách 403, anon 401", async () => {
  const kh = await createCustomer();
  const body = { userId: kh.user.id, name: "Goi test", serviceTypes: ["gym"], format: "1:1", price: 100000, totalSessions: 5 };

  assert.equal((await call(S, "/packages", { method: "POST", body })).status, 401);
  assert.equal((await call(S, "/packages", { method: "POST", token: minhAnh.token, body })).status, 403);
  assert.equal((await call(S, "/packages", { method: "POST", token: trainer.token, body })).status, 403);
  assert.equal((await call(S, "/packages", { method: "POST", token: staff.token, body })).status, 201);
  assert.equal((await call(S, "/packages", { method: "POST", token: admin.token, body })).status, 201);
});

test("matrix: GET /packages/customer/:id — admin/lễ tân 200, HLV/khách 403, anon 401, id rác 400", async () => {
  const id = minhAnh.user.id;
  assert.equal((await call(S, `/packages/customer/${id}`)).status, 401);
  assert.equal((await call(S, `/packages/customer/${id}`, { token: minhAnh.token })).status, 403);
  assert.equal((await call(S, `/packages/customer/${id}`, { token: trainer.token })).status, 403);
  assert.equal((await call(S, `/packages/customer/${id}`, { token: staff.token })).status, 200);
  assert.equal((await call(S, `/packages/customer/${id}`, { token: admin.token })).status, 200);
  assert.equal((await call(S, "/packages/customer/khong-phai-id", { token: staff.token })).status, 400);
});

// ---------- Validate tạo gói ----------

test("validate: thiếu cả số buổi lẫn thời hạn -> 400; bộ môn sai -> 400; giá sai -> 400; totalSessions 0 -> 400; userId là HLV -> 404", async () => {
  const kh = await createCustomer();
  const base = { userId: kh.user.id, name: "Goi loi", serviceTypes: ["gym"], format: "1:1", price: 100000 };

  const r1 = await call(S, "/packages", { method: "POST", token: staff.token, body: base });
  assert.equal(r1.status, 400);
  assert.match(r1.data.error, /số buổi hoặc ngày hết hạn/);

  const r2 = await call(S, "/packages", {
    method: "POST", token: staff.token, body: { ...base, serviceTypes: ["mon-khong-co-that"], totalSessions: 5 },
  });
  assert.equal(r2.status, 400);

  const r3 = await call(S, "/packages", {
    method: "POST", token: staff.token, body: { ...base, price: "abc", totalSessions: 5 },
  });
  assert.equal(r3.status, 400);

  const r4 = await call(S, "/packages", {
    method: "POST", token: staff.token, body: { ...base, totalSessions: 0 },
  });
  assert.equal(r4.status, 400);

  const trainerAccounts = await call(S, "/accounts", { token: admin.token });
  const hlv = trainerAccounts.data.accounts.find((a) => a.role === "trainer");
  const r5 = await call(S, "/packages", {
    method: "POST", token: staff.token, body: { ...base, userId: hlv.id, totalSessions: 5 },
  });
  assert.equal(r5.status, 404);

  assert.equal(await Package.countDocuments({ userId: kh.user.id }), 0, "không được tạo gói nào từ input hỏng");
});

// her-35: bộ môn của gói là MẢNG — rỗng / không phải mảng / trùng lặp / ngoài danh mục đều 400
test("validate mix: serviceTypes rỗng, không phải mảng, trùng môn, môn lạ -> 400 đúng lý do", async () => {
  const kh = await createCustomer();
  const base = { userId: kh.user.id, name: "Goi mix loi", format: "1:1", price: 1000, totalSessions: 5 };

  const rEmpty = await call(S, "/packages", { method: "POST", token: staff.token, body: { ...base, serviceTypes: [] } });
  assert.equal(rEmpty.status, 400);
  assert.match(rEmpty.data.error, /ít nhất 1 bộ môn/);

  const rString = await call(S, "/packages", { method: "POST", token: staff.token, body: { ...base, serviceTypes: "gym" } });
  assert.equal(rString.status, 400);
  assert.match(rString.data.error, /ít nhất 1 bộ môn/);

  const rMissing = await call(S, "/packages", { method: "POST", token: staff.token, body: base });
  assert.equal(rMissing.status, 400, "thiếu hẳn serviceTypes cũng phải 400");

  const rDup = await call(S, "/packages", { method: "POST", token: staff.token, body: { ...base, serviceTypes: ["gym", "gym"] } });
  assert.equal(rDup.status, 400);
  assert.match(rDup.data.error, /trùng lặp/);

  const rUnknown = await call(S, "/packages", { method: "POST", token: staff.token, body: { ...base, serviceTypes: ["gym", "abc"] } });
  assert.equal(rUnknown.status, 400);
  assert.match(rUnknown.data.error, /danh mục bộ môn/);

  assert.equal(await Package.countDocuments({ userId: kh.user.id }), 0, "không được tạo gói nào từ input hỏng");
});

test("validate loại hình: thiếu format / format lạ '1:3' -> 400 nói rõ 4 loại hình", async () => {
  const kh = await createCustomer();
  const base = { userId: kh.user.id, name: "Goi format loi", serviceTypes: ["gym"], price: 1000, totalSessions: 5 };

  const rMissing = await call(S, "/packages", { method: "POST", token: staff.token, body: base });
  assert.equal(rMissing.status, 400);
  assert.match(rMissing.data.error, /Loại hình phải là 1:1, 1:2, 1:4 hoặc 1:8/);

  const rBad = await call(S, "/packages", { method: "POST", token: staff.token, body: { ...base, format: "1:3" } });
  assert.equal(rBad.status, 400);
  assert.match(rBad.data.error, /Loại hình phải là 1:1, 1:2, 1:4 hoặc 1:8/);

  assert.equal(await Package.countDocuments({ userId: kh.user.id }), 0, "không được tạo gói nào từ input hỏng");
});

// her-35: 2 loại gói (chốt 19/08) — gói BUỔI 1:1/1:2/1:4; gói THỜI HẠN chỉ Yoga 1:8
test("validate 2 loại gói: gói buổi + 1:8 -> 400; gói thời hạn không phải Yoga 1:8 -> 400; Yoga 1:8 -> 201", async () => {
  const kh = await createCustomer();
  const base = { userId: kh.user.id, name: "Goi 2 loai", price: 1000 };

  const rSession18 = await call(S, "/packages", {
    method: "POST", token: staff.token,
    body: { ...base, serviceTypes: ["yoga"], format: "1:8", totalSessions: 10 },
  });
  assert.equal(rSession18.status, 400);
  assert.match(rSession18.data.error, /Gói buổi chỉ có loại hình 1:1, 1:2 hoặc 1:4/);

  const rDurationGym = await call(S, "/packages", {
    method: "POST", token: staff.token,
    body: { ...base, serviceTypes: ["gym"], format: "1:8", durationDays: 30 },
  });
  assert.equal(rDurationGym.status, 400);
  assert.match(rDurationGym.data.error, /Gói thời hạn chỉ dành cho Yoga, loại hình 1:8/);

  const rDurationYoga11 = await call(S, "/packages", {
    method: "POST", token: staff.token,
    body: { ...base, serviceTypes: ["yoga"], format: "1:1", durationDays: 30 },
  });
  assert.equal(rDurationYoga11.status, 400);
  assert.match(rDurationYoga11.data.error, /Gói thời hạn chỉ dành cho Yoga, loại hình 1:8/);

  const rDurationMix = await call(S, "/packages", {
    method: "POST", token: staff.token,
    body: { ...base, serviceTypes: ["yoga", "gym"], format: "1:8", durationDays: 30 },
  });
  assert.equal(rDurationMix.status, 400, "gói thời hạn nhiều môn cũng bị chặn");

  const ok = await call(S, "/packages", {
    method: "POST", token: staff.token,
    body: { ...base, name: "Yoga 1 thang", serviceTypes: ["yoga"], format: "1:8", durationDays: 30 },
  });
  assert.equal(ok.status, 201, JSON.stringify(ok.data));
  assert.deepEqual(ok.data.package.serviceTypes, ["yoga"]);
  assert.equal(ok.data.package.format, "1:8");
  assert.equal(ok.data.package.totalSessions, null, "gói thời hạn = không giới hạn buổi");

  assert.equal(await Package.countDocuments({ userId: kh.user.id }), 1, "chỉ gói hợp lệ được tạo, 4 body sai không để lại gói rác");
});

// ---------- H7: đúng bộ môn + đúng loại hình mới đặt được ----------

test("H7 bộ môn: gói Yoga 1:4 KHÔNG đặt được lớp Pilates 1:4 (báo đúng bộ môn thiếu), lớp Yoga thì được", async () => {
  const kh = await createCustomer();
  await createPackage(kh.user.id, { name: "Yoga 1:4", serviceTypes: ["yoga"], format: "1:4", price: 1, totalSessions: 5, durationDays: 30 });
  const clsPilates = await createClass({ serviceType: "pilates", format: "1:4", hour: 200 });
  const clsYoga = await createClass({ serviceType: "yoga", format: "1:4", hour: 202 });

  const r1 = await book(kh.token, clsPilates);
  assert.equal(r1.status, 400);
  assert.match(r1.data.error, /Pilates/);

  const r2 = await book(kh.token, clsYoga);
  assert.equal(r2.status, 201, JSON.stringify(r2.data));
});

// Thay cho test "gói PT" cũ (her-35 bỏ hẳn khái niệm PT): cùng bộ môn nhưng SAI loại hình thì chặn
test("H7 loại hình: gói Gym 1:1 KHÔNG đặt được lớp Gym 1:2 (báo đúng loại hình), lớp Gym 1:1 thì được", async () => {
  const kh = await createCustomer();
  await createPackage(kh.user.id, { name: "Gym 1:1", serviceTypes: ["gym"], format: "1:1", price: 1, totalSessions: 5, durationDays: 30 });
  const cls12 = await createClass({ serviceType: "gym", format: "1:2", hour: 210 });
  const cls11 = await createClass({ serviceType: "gym", format: "1:1", hour: 212 });

  const rSai = await book(kh.token, cls12);
  assert.equal(rSai.status, 400);
  assert.match(rSai.data.error, /loại hình/);

  const rDung = await book(kh.token, cls11);
  assert.equal(rDung.status, 201, JSON.stringify(rDung.data));
});

// her-35: gói MIX nhiều bộ môn — mọi bộ môn trong gói dùng CHUNG quỹ buổi
test("mix: gói ['gym','pilates'] 1:1 — đặt lớp gym 1:1 và pilates 1:1 đều trừ CÙNG gói (usedSessions = 2)", async () => {
  const kh = await createCustomer();
  const pkg = await createPackage(kh.user.id, {
    name: "Mix Gym+Pilates 1:1", serviceTypes: ["gym", "pilates"], format: "1:1",
    price: 5000000, totalSessions: 10, durationDays: 60,
  });
  assert.deepEqual(pkg.serviceTypes, ["gym", "pilates"]);
  assert.deepEqual(pkg.serviceLabels, ["Gym", "Pilates"], "serializer trả nhãn hiển thị của TỪNG môn");
  assert.equal(pkg.format, "1:1");

  const clsGym = await createClass({ serviceType: "gym", format: "1:1", hour: 700 });
  const clsPilates = await createClass({ serviceType: "pilates", format: "1:1", hour: 702 });

  const r1 = await book(kh.token, clsGym);
  assert.equal(r1.status, 201, JSON.stringify(r1.data));
  const r2 = await book(kh.token, clsPilates);
  assert.equal(r2.status, 201, JSON.stringify(r2.data));

  assert.equal((await Package.findById(pkg.id)).usedSessions, 2, "2 bộ môn khác nhau vẫn trừ CÙNG 1 gói mix");
  assert.equal(await Package.countDocuments({ userId: kh.user.id }), 1, "khách chỉ có đúng 1 gói");
});

// ---------- 3 kiểu gói (Q3) ----------

test("gói CHỈ thời hạn (Yoga 1:8, không giới hạn buổi): đặt nhiều buổi liên tiếp không bị chặn 'hết buổi'", async () => {
  const kh = await createCustomer();
  const pkg = await createPackage(kh.user.id, {
    name: "Yoga 1 thang", serviceTypes: ["yoga"], format: "1:8", price: 1200000, durationDays: 60,
  });
  assert.equal(pkg.remainingSessions, null, "không giới hạn buổi");

  const c1 = await createClass({ serviceType: "yoga", format: "1:8", hour: 220 });
  const c2 = await createClass({ serviceType: "yoga", format: "1:8", hour: 222 });
  const c3 = await createClass({ serviceType: "yoga", format: "1:8", hour: 224 });
  for (const c of [c1, c2, c3]) {
    const r = await book(kh.token, c);
    assert.equal(r.status, 201, JSON.stringify(r.data));
  }
  assert.equal((await Package.findById(pkg.id)).usedSessions, 3, "vẫn đếm buổi đã dùng để thống kê");
});

test("gói CHỈ số buổi (không thời hạn): đặt buổi ở ngày rất xa vẫn được, không dính 'hết hạn trước ngày tập'", async () => {
  const kh = await createCustomer();
  const pkg = await createPackage(kh.user.id, { name: "Gym 1:1 vo han", serviceTypes: ["gym"], format: "1:1", price: 1, totalSessions: 5 });
  assert.equal(pkg.expiresAt, null);
  const clsFar = await createClass({ serviceType: "gym", format: "1:1", hour: 400 }); // ~16.6 ngày sau
  const r = await book(kh.token, clsFar);
  assert.equal(r.status, 201, JSON.stringify(r.data));
});

// ---------- Q4: thứ tự trừ gói + hoàn đúng gói (L3) ----------

test("Q4: nhiều gói cùng loại -> trừ gói CÓ HẠN gần hết trước; gói không hạn trừ sau cùng; hủy hoàn về đúng gói", async () => {
  const kh = await createCustomer();
  const pkgSoon = await createPackage(kh.user.id, { name: "Pilates 10 ngày", serviceTypes: ["pilates"], format: "1:1", price: 1, totalSessions: 5, durationDays: 10 });
  const pkgLate = await createPackage(kh.user.id, { name: "Pilates 60 ngày", serviceTypes: ["pilates"], format: "1:1", price: 1, totalSessions: 5, durationDays: 60 });
  const pkgNoExp = await createPackage(kh.user.id, { name: "Pilates vô hạn", serviceTypes: ["pilates"], format: "1:1", price: 1, totalSessions: 5 });

  const cls = await createClass({ serviceType: "pilates", format: "1:1", hour: 230 }); // ~9.6 ngày: vẫn trong hạn gói 10 ngày
  const r = await book(kh.token, cls);
  assert.equal(r.status, 201, JSON.stringify(r.data));

  const used = async (id) => (await Package.findById(id)).usedSessions;
  assert.equal(await used(pkgSoon.id), 1, "phải trừ gói hạn GẦN nhất");
  assert.equal(await used(pkgLate.id), 0);
  assert.equal(await used(pkgNoExp.id), 0);

  // Hủy -> hoàn về ĐÚNG gói đã trừ (L3)
  const del = await call(S, `/bookings/${r.data.booking.id}`, { method: "DELETE", token: kh.token });
  assert.equal(del.status, 200);
  assert.equal(await used(pkgSoon.id), 0, "hoàn buổi phải về đúng gói đã trừ");
});

// ---------- Race (L2): 2 request song song với gói chỉ còn 1 buổi ----------

test("race: gói còn đúng 1 buổi + 2 lớp cùng loại -> đúng 1 booking thành công, usedSessions = 1", async () => {
  const kh = await createCustomer();
  const pkg = await createPackage(kh.user.id, { name: "Yoga 1 buổi", serviceTypes: ["yoga"], format: "1:4", price: 1, totalSessions: 1, durationDays: 30 });
  const cA = await createClass({ serviceType: "yoga", format: "1:4", hour: 240 });
  const cB = await createClass({ serviceType: "yoga", format: "1:4", hour: 242 });

  const [rA, rB] = await Promise.all([book(kh.token, cA), book(kh.token, cB)]);
  const oks = [rA, rB].filter((r) => r.status === 201);
  assert.equal(oks.length, 1, `phải đúng 1 thành công: ${rA.status}/${rB.status}`);
  assert.equal((await Package.findById(pkg.id)).usedSessions, 1);
});

// ---------- Học viên tự tra cứu ----------

test("/me/packages: trả đủ gói (kể cả hết hạn) với serviceTypes/serviceLabels/format + status + remaining đúng; gói active xếp trước", async () => {
  const kh = await createCustomer();
  await createPackage(kh.user.id, { name: "Gói đang dùng", serviceTypes: ["pilates", "gym"], format: "1:2", price: 1, totalSessions: 5 });
  // Gói hết hạn tạo thẳng DB (API luôn kích hoạt từ hôm nay nên không tạo được gói quá khứ)
  await Package.create({
    userId: kh.user.id, name: "Gói cũ đã hết hạn", serviceTypes: ["yoga"], format: "1:4", price: 1,
    totalSessions: 5, usedSessions: 5, activatedAt: hoursFromNow(-2000), expiresAt: hoursFromNow(-1000),
  });

  const r = await call(S, "/me/packages", { token: kh.token });
  assert.equal(r.status, 200);
  const items = r.data.packages;
  assert.equal(items.length, 2);

  const cur = items.find((p) => p.name === "Gói đang dùng");
  assert.deepEqual(cur.serviceTypes, ["pilates", "gym"]);
  assert.deepEqual(cur.serviceLabels, ["Pilates", "Gym"]);
  assert.equal(cur.format, "1:2");
  assert.equal(cur.expiresAt, null);
  assert.equal(cur.status, "active");
  assert.equal(cur.remainingSessions, 5);

  const old = items.find((p) => p.name === "Gói cũ đã hết hạn");
  assert.equal(old.status, "expired");
  assert.equal(old.remainingSessions, 0);

  // active đứng trước expired
  assert.ok(items.findIndex((p) => p.status === "active") < items.findIndex((p) => p.status === "expired"));
});

// ---------- Thanh toán khi bán gói (Q10 — 16/08/2026) ----------

test("payment: ghi nhận nợ đúng; method sai/paidAmount sai -> 400; khách còn nợ VẪN đặt được lịch", async () => {
  const kh = await createCustomer();
  // Gói nợ: giá 1tr, mới thu 400k
  const pkg = await createPackage(kh.user.id, {
    name: "Yoga no tien", serviceTypes: ["yoga"], format: "1:4", price: 1000000, totalSessions: 5,
    durationDays: 30, paymentMethod: "cash", paidAmount: 400000,
  });
  assert.equal(pkg.paidAmount, 400000);
  assert.equal(pkg.debt, 600000);
  assert.equal(pkg.isPaid, false);

  // paidAmount > price / âm / method lạ -> 400
  const base = { userId: kh.user.id, name: "Goi loi", serviceTypes: ["yoga"], format: "1:4", price: 100, totalSessions: 5 };
  for (const bad of [
    { ...base, paidAmount: 200 },
    { ...base, paidAmount: -1 },
    { ...base, paymentMethod: "bitcoin", paidAmount: 50 },
  ]) {
    const r = await call(S, "/packages", { method: "POST", token: staff.token, body: bad });
    assert.equal(r.status, 400, JSON.stringify(r.data));
  }
  assert.equal(await Package.countDocuments({ userId: kh.user.id }), 1, "3 body sai không được tạo thêm gói nào");

  // Q10: còn nợ vẫn đặt lịch bình thường
  const cls = await createClass({ serviceType: "yoga", format: "1:4", hour: 300 });
  const r = await book(kh.token, cls);
  assert.equal(r.status, 201, JSON.stringify(r.data));
});

test("pay: thu thêm cộng dồn; thu quá số nợ -> 400; thu đủ -> isPaid; khách/HLV bị 403", async () => {
  const kh = await createCustomer();
  const pkg = await createPackage(kh.user.id, {
    name: "Gym tra gop", serviceTypes: ["gym"], format: "1:1", price: 1000000, totalSessions: 10,
    paymentMethod: "transfer", paidAmount: 100000,
  });

  assert.equal((await call(S, `/packages/${pkg.id}/pay`, { method: "PATCH", token: kh.token, body: { amount: 100 } })).status, 403);
  assert.equal((await call(S, `/packages/${pkg.id}/pay`, { method: "PATCH", token: trainer.token, body: { amount: 100 } })).status, 403);
  assert.equal((await call(S, `/packages/${pkg.id}/pay`, { method: "PATCH", body: { amount: 100 } })).status, 401);

  const r1 = await call(S, `/packages/${pkg.id}/pay`, { method: "PATCH", token: staff.token, body: { amount: 400000 } });
  assert.equal(r1.status, 200, JSON.stringify(r1.data));
  assert.equal(r1.data.package.paidAmount, 500000);
  assert.equal(r1.data.package.isPaid, false);

  // Thu quá số nợ còn lại (còn 500k, đòi thu 600k) -> 400
  const rOver = await call(S, `/packages/${pkg.id}/pay`, { method: "PATCH", token: staff.token, body: { amount: 600000 } });
  assert.equal(rOver.status, 400);

  const r2 = await call(S, `/packages/${pkg.id}/pay`, { method: "PATCH", token: staff.token, body: { amount: 500000 } });
  assert.equal(r2.status, 200);
  assert.equal(r2.data.package.debt, 0);
  assert.equal(r2.data.package.isPaid, true);

  // amount rác -> 400
  assert.equal((await call(S, `/packages/${pkg.id}/pay`, { method: "PATCH", token: staff.token, body: { amount: "abc" } })).status, 400);
  assert.equal((await call(S, `/packages/${pkg.id}/pay`, { method: "PATCH", token: staff.token, body: { amount: 0 } })).status, 400);
});

// ---------- Bảo lưu gói (Q11 — 16/08/2026) ----------

test("pause: gói có hạn bảo lưu được; ĐANG bảo lưu không đặt được lịch (báo rõ); pause 2 lần/gói không hạn -> 400; khách 403", async () => {
  const kh = await createCustomer();
  const pkg = await createPackage(kh.user.id, {
    name: "Pilates bao luu", serviceTypes: ["pilates"], format: "1:1", price: 1, totalSessions: 10, durationDays: 30,
  });
  const pkgNoExp = await createPackage(kh.user.id, {
    name: "Gym khong han", serviceTypes: ["gym"], format: "1:1", price: 1, totalSessions: 10,
  });

  // Khách/HLV không được bảo lưu (Q11: chỉ quầy)
  assert.equal((await call(S, `/packages/${pkg.id}/pause`, { method: "PATCH", token: kh.token })).status, 403);
  assert.equal((await call(S, `/packages/${pkg.id}/pause`, { method: "PATCH", token: trainer.token })).status, 403);

  const r = await call(S, `/packages/${pkg.id}/pause`, { method: "PATCH", token: staff.token });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.package.status, "paused");

  // Đang bảo lưu -> đặt lịch bị chặn, message nêu "bảo lưu"
  const cls = await createClass({ serviceType: "pilates", format: "1:1", hour: 310 });
  const rBook = await book(kh.token, cls);
  assert.equal(rBook.status, 400);
  assert.match(rBook.data.error, /bảo lưu/);

  // Pause lần 2 -> 400; gói không thời hạn -> 400
  assert.equal((await call(S, `/packages/${pkg.id}/pause`, { method: "PATCH", token: staff.token })).status, 400);
  assert.equal((await call(S, `/packages/${pkgNoExp.id}/pause`, { method: "PATCH", token: staff.token })).status, 400);
});

test("resume: hạn được cộng bù đúng khoảng đã ngưng; sau resume đặt lại được; resume gói không bảo lưu -> 400", async () => {
  const kh = await createCustomer();
  const pkg = await createPackage(kh.user.id, {
    name: "Yoga bao luu", serviceTypes: ["yoga"], format: "1:4", price: 1, totalSessions: 10, durationDays: 30,
  });
  const pkgTruoc = await Package.findById(pkg.id);

  // Giả lập đã bảo lưu từ 5 ngày trước (API pause dùng thời điểm hiện tại nên set thẳng DB)
  const fiveDays = 5 * 24 * 3600 * 1000;
  await Package.updateOne({ _id: pkg.id }, { $set: { pausedAt: new Date(Date.now() - fiveDays) } });

  const r = await call(S, `/packages/${pkg.id}/resume`, { method: "PATCH", token: staff.token });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.package.status, "active");

  const pkgSau = await Package.findById(pkg.id);
  const bonus = pkgSau.expiresAt.getTime() - pkgTruoc.expiresAt.getTime();
  assert.ok(Math.abs(bonus - fiveDays) < 60 * 1000, `hạn phải được cộng ~5 ngày, thực tế ${bonus}ms`);
  assert.equal(pkgSau.pausedAt, null);

  // Sau resume đặt lại được
  const cls = await createClass({ serviceType: "yoga", format: "1:4", hour: 320 });
  const rBook = await book(kh.token, cls);
  assert.equal(rBook.status, 201, JSON.stringify(rBook.data));

  // Resume gói không bảo lưu -> 400
  assert.equal((await call(S, `/packages/${pkg.id}/resume`, { method: "PATCH", token: staff.token })).status, 400);
});

test("POST /schedule/classes thiếu/sai serviceType -> 400 rõ ràng", async () => {
  const r = await call(S, "/schedule/classes", {
    method: "POST", token: staff.token,
    body: { name: "Lop thieu bo mon", format: "1:4", coachId: coachIds[0], startAt: hoursFromNow(250), endAt: hoursFromNow(251) },
  });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /[Bb]ộ môn/);
});

// ---------- Adversarial (Task 12): input quái + dữ liệu cũ + đổi bộ môn ----------

test("adversarial: totalSessions 1.5/chuỗi/âm, durationDays khổng lồ -> 400; không tạo gói rác", async () => {
  const kh = await createCustomer();
  const base = { userId: kh.user.id, name: "Goi qua", serviceTypes: ["gym"], format: "1:1", price: 100 };
  for (const bad of [
    { ...base, totalSessions: 1.5 },
    { ...base, totalSessions: "abc" },
    { ...base, totalSessions: -3 },
    { ...base, durationDays: 99999999 },
    { ...base, durationDays: 2.5 },
  ]) {
    const r = await call(S, "/packages", { method: "POST", token: staff.token, body: bad });
    assert.equal(r.status, 400, JSON.stringify({ bad, r: r.data }));
  }
  assert.equal(await Package.countDocuments({ userId: kh.user.id }), 0, "không được tạo gói nào từ input hỏng");
});

test("adversarial: lớp CŨ chưa gán bộ môn (chèn DB) -> đặt bị 400 rõ ràng, KHÔNG trừ buổi", async () => {
  const kh = await createCustomer();
  await createPackage(kh.user.id, { name: "Goi day du", serviceTypes: ["pilates"], format: "1:4", price: 1, totalSessions: 5, durationDays: 30 });
  // Giả lập dữ liệu trước her-05: bỏ qua validate schema bằng collection thẳng
  const trainerDoc = await mongoose.connection.db.collection("trainers").findOne({});
  const ins = await mongoose.connection.db.collection("gymclasses").insertOne({
    name: "Lop co chua gan bo mon", coachId: trainerDoc._id,
    startAt: hoursFromNow(500), endAt: hoursFromNow(501), capacity: 8, bookedCount: 0,
  });
  const r = await call(S, "/bookings", {
    method: "POST", token: kh.token, body: { classId: ins.insertedId.toString() },
  });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /bộ môn/);
  const pkg = await Package.findOne({ userId: kh.user.id });
  assert.equal(pkg.usedSessions, 0, "không được trừ buổi khi từ chối");
});

test("adversarial: lớp CŨ chưa gán loại hình (chèn DB) -> đặt bị 400 rõ ràng, KHÔNG trừ buổi", async () => {
  const kh = await createCustomer();
  await createPackage(kh.user.id, { name: "Goi du loai hinh", serviceTypes: ["pilates"], format: "1:4", price: 1, totalSessions: 5, durationDays: 30 });
  const trainerDoc = await mongoose.connection.db.collection("trainers").findOne({});
  const ins = await mongoose.connection.db.collection("gymclasses").insertOne({
    name: "Lop chua gan loai hinh", serviceType: "pilates", coachId: trainerDoc._id,
    startAt: hoursFromNow(502), endAt: hoursFromNow(503), capacity: 8, bookedCount: 0,
  });
  const r = await call(S, "/bookings", {
    method: "POST", token: kh.token, body: { classId: ins.insertedId.toString() },
  });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /loại hình/);
  assert.equal((await Package.findOne({ userId: kh.user.id })).usedSessions, 0, "không được trừ buổi khi từ chối");
});

test("adversarial: PATCH đổi bộ môn lớp ĐÃ có khách đặt -> bị chặn (khách đã thấy thông tin cũ)", async () => {
  const kh = await createCustomer();
  await createPackage(kh.user.id, { name: "Goi yoga adv", serviceTypes: ["yoga"], format: "1:4", price: 1, totalSessions: 5, durationDays: 30 });
  const cls = await createClass({ serviceType: "yoga", format: "1:4", hour: 510 });
  const bk = await book(kh.token, cls);
  assert.equal(bk.status, 201, JSON.stringify(bk.data));
  const r = await call(S, `/schedule/classes/${cls._id || cls.id}`, {
    method: "PATCH", token: staff.token, body: { serviceType: "gym" },
  });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /bộ môn/);
});

// ---------- Vòng review độc lập (16/08): các fix + coverage bổ sung ----------

test("review-fix: pay gói cũ (paidAmount null) -> 400 nói rõ 'đã thu đủ'; amount lẻ 0.5 -> 400", async () => {
  const kh = await createCustomer();
  // Gói cũ trước đợt thanh toán: chèn thẳng DB không có paidAmount
  const legacy = await Package.create({
    userId: kh.user.id, name: "Goi cu legacy", serviceTypes: ["gym"], format: "1:1", price: 500000,
    totalSessions: 5, activatedAt: new Date(), expiresAt: hoursFromNow(24 * 30),
  });
  const r = await call(S, `/packages/${legacy._id}/pay`, { method: "PATCH", token: staff.token, body: { amount: 1000 } });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /đã thu đủ/);

  const pkg = await createPackage(kh.user.id, { name: "Goi le", serviceTypes: ["gym"], format: "1:1", price: 1000, totalSessions: 5, paidAmount: 100 });
  const r2 = await call(S, `/packages/${pkg.id}/pay`, { method: "PATCH", token: staff.token, body: { amount: 0.5 } });
  assert.equal(r2.status, 400);
});

test("review-fix: giá không nguyên/quá 1 tỷ/tên quá dài -> 400", async () => {
  const kh = await createCustomer();
  const base = { userId: kh.user.id, serviceTypes: ["gym"], format: "1:1", totalSessions: 5 };
  for (const bad of [
    { ...base, name: "Gia le", price: 100.5 },
    { ...base, name: "Gia to", price: 2_000_000_000 },
    { ...base, name: "x".repeat(201), price: 100 },
  ]) {
    const r = await call(S, "/packages", { method: "POST", token: staff.token, body: bad });
    assert.equal(r.status, 400, JSON.stringify({ bad: bad.name, r: r.data }));
  }
  assert.equal(await Package.countDocuments({ userId: kh.user.id }), 0, "không được tạo gói nào từ input hỏng");
});

test("review-fix: Q4 vế 2 — 2 gói KHÔNG hạn cùng loại -> gói kích hoạt trước bị trừ trước", async () => {
  const kh = await createCustomer();
  const p1 = await createPackage(kh.user.id, { name: "Gym som", serviceTypes: ["gym"], format: "1:1", price: 1, totalSessions: 5 });
  await new Promise((r) => setTimeout(r, 20));
  const p2 = await createPackage(kh.user.id, { name: "Gym muon", serviceTypes: ["gym"], format: "1:1", price: 1, totalSessions: 5 });
  const cls = await createClass({ serviceType: "gym", format: "1:1", hour: 600 });
  const r = await book(kh.token, cls);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal((await Package.findById(p1.id)).usedSessions, 1, "gói kích hoạt TRƯỚC phải bị trừ trước");
  assert.equal((await Package.findById(p2.id)).usedSessions, 0);
});

test("review-fix: lớp cũ ĐÃ có khách nhưng chưa có bộ môn -> PATCH gán LẦN ĐẦU được; đổi tiếp thì bị chặn", async () => {
  const kh = await createCustomer();
  await createPackage(kh.user.id, { name: "Pilates legacy", serviceTypes: ["pilates"], format: "1:4", price: 1, totalSessions: 5, durationDays: 60 });
  // Lớp cũ thiếu bộ môn + booking sẵn (chèn DB mô phỏng dữ liệu trước her-05)
  const trainerDoc = await mongoose.connection.db.collection("trainers").findOne({});
  const ins = await mongoose.connection.db.collection("gymclasses").insertOne({
    name: "Lop cu co khach", coachId: trainerDoc._id, format: "1:4",
    startAt: hoursFromNow(610), endAt: hoursFromNow(611), capacity: 4, bookedCount: 1,
  });
  await mongoose.connection.db.collection("bookings").insertOne({
    userId: new mongoose.Types.ObjectId(kh.user.id), classId: ins.insertedId,
    trainerId: trainerDoc._id, title: "Lop cu co khach", format: "1:4",
    startAt: hoursFromNow(610), endAt: hoursFromNow(611), status: "booked",
  });
  // Gán lần đầu -> 200 (không phải đổi thông tin khách đã thấy)
  const first = await call(S, `/schedule/classes/${ins.insertedId}`, {
    method: "PATCH", token: staff.token, body: { serviceType: "pilates" },
  });
  assert.equal(first.status, 200, JSON.stringify(first.data));
  // Đổi sang bộ môn khác khi có khách -> vẫn chặn
  const second = await call(S, `/schedule/classes/${ins.insertedId}`, {
    method: "PATCH", token: staff.token, body: { serviceType: "gym" },
  });
  assert.equal(second.status, 400);
  assert.match(second.data.error, /bộ môn/);
});

test("review-fix: khách CHỈ có gói bảo lưu -> /me/package trả gói status 'paused' (không phải null)", async () => {
  const kh = await createCustomer();
  const pkg = await createPackage(kh.user.id, { name: "Yoga se bao luu", serviceTypes: ["yoga"], format: "1:4", price: 1, totalSessions: 5, durationDays: 30 });
  assert.equal((await call(S, `/packages/${pkg.id}/pause`, { method: "PATCH", token: staff.token })).status, 200);
  const r = await call(S, "/me/package", { token: kh.token });
  assert.equal(r.status, 200);
  assert.ok(r.data.package, "phải trả gói đang bảo lưu thay vì null");
  assert.equal(r.data.package.status, "paused");
});

test("review-fix: hủy booking khi gói nguồn ĐANG bảo lưu -> vẫn hoàn buổi về đúng gói", async () => {
  const kh = await createCustomer();
  const pkg = await createPackage(kh.user.id, { name: "Pilates pause refund", serviceTypes: ["pilates"], format: "1:2", price: 1, totalSessions: 5, durationDays: 60 });
  const cls = await createClass({ serviceType: "pilates", format: "1:2", hour: 620 });
  const bk = await book(kh.token, cls);
  assert.equal(bk.status, 201, JSON.stringify(bk.data));
  assert.equal((await call(S, `/packages/${pkg.id}/pause`, { method: "PATCH", token: staff.token })).status, 200);
  const del = await call(S, `/bookings/${bk.data.booking.id}`, { method: "DELETE", token: kh.token });
  assert.equal(del.status, 200, JSON.stringify(del.data));
  assert.equal((await Package.findById(pkg.id)).usedSessions, 0, "hoàn buổi về gói đang bảo lưu vẫn phải chạy (C2)");
});
