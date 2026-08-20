// Test cho đợt sửa lỗi nghiêm trọng L1–L3 — xem docs-her/testcase/testcase_her-02_serious_bugs_L1_L3.md
// her-35: mọi buổi đều là LỚP có loại hình (1:1/1:2/1:4/1:8), gói tập là gói MIX
// (mảng serviceTypes + 1 loại hình) — PTSlot đã xoá, body đặt lịch chỉ còn { classId }.
// Chạy: npm test  (cần MongoDB local: docker start her-mongo)
// Suite này dùng DB riêng her_test_c (tự seed lại mỗi lần chạy) + server thật cổng 4111.

const { test, before, after } = require("node:test");
const assert = require("node:assert");
const { spawn, spawnSync } = require("node:child_process");
const path = require("node:path");
const mongoose = require("mongoose");

const ROOT = path.join(__dirname, "..");
const URI = "mongodb://localhost:27017/her_test_c";
const S = "http://localhost:4111/api";
const SECRET = "testsecret";

const Booking = require("../src/models/Booking");
const Package = require("../src/models/Package");
const GymClass = require("../src/models/GymClass");
const { FORMAT_CAPACITY } = require("../src/utils/formats");

let proc;
let coachId; // HLV dùng cho MỌI lớp test — lấy 1 lần ở before()

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

const userIdOf = async (phone) =>
  (await mongoose.connection.db.collection("users").findOne({ phone }))._id;

// Tổng số buổi ĐÃ TRỪ trên MỌI gói của khách — bất biến "không được mất buổi" (C2)
// không phụ thuộc vào gói nào đang được /me/package chọn hiển thị
const totalUsed = async (userId) =>
  (await Package.find({ userId })).reduce((sum, p) => sum + p.usedSessions, 0);

// Mỗi lớp test lấy 1 khung giờ riêng, cách nhau 3 tiếng: mọi lớp đều giao cho CÙNG 1 HLV
// nên trùng/chồng giờ sẽ bị trainerOverlapError chặn ngay khi tạo
let hourCursor = 200;
const nextHour = () => (hourCursor += 3);

// Khách MỚI cho mỗi case cần "chỉ có đúng gói này" — không phụ thuộc dữ liệu seed
// lẫn thứ tự chạy của các test khác
let phoneSeq = 0;
const nextPhone = () => `09760${String(10000 + ++phoneSeq)}`;

async function createCustomer(staffToken, name = "Khach test") {
  const phone = nextPhone();
  const r = await call(S, "/accounts", {
    method: "POST",
    token: staffToken,
    body: { name, phone, password: "123456", role: "customer" },
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const logged = await login(phone);
  return { phone, token: logged.token, userId: await userIdOf(phone) };
}

// Cấp 1 gói khớp (bộ môn + loại hình) cho khách — hạn mặc định xa hơn mọi lớp trong suite
async function givePackage(userId, serviceTypes, format, extra = {}) {
  return Package.create({
    userId,
    name: `Goi test ${serviceTypes.join("+")} ${format}`,
    serviceTypes,
    format,
    price: 1000,
    totalSessions: 10,
    usedSessions: 0,
    activatedAt: new Date(),
    expiresAt: hoursFromNow(24 * 60),
    ...extra,
  });
}

// Tiện ích: lễ tân tạo 1 buổi ở giờ xa (không đụng lịch seed). Sức chứa do LOẠI HÌNH
// quyết định (server tự gán = FORMAT_CAPACITY[format]) — client không gửi capacity nữa.
async function createClass(staffToken, { hour = nextHour(), format = "1:4", name = "Lop test", serviceType = "pilates" } = {}) {
  const r = await call(S, "/schedule/classes", {
    method: "POST",
    token: staffToken,
    body: {
      name,
      serviceType,
      format,
      coachId,
      startAt: hoursFromNow(hour),
      endAt: hoursFromNow(hour + 1),
    },
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data.class;
}

before(async () => {
  // Seed lại DB riêng của suite này để mỗi lần chạy đều sạch
  const seeded = spawnSync(process.execPath, ["src/scripts/seed.js"], {
    cwd: ROOT,
    env: { ...process.env, MONGODB_URI: URI },
    stdio: "ignore",
  });
  assert.equal(seeded.status, 0, "seed her_test_c thất bại");

  proc = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: "4111", MONGODB_URI: URI, JWT_SECRET: SECRET, MIN_CANCEL_HOURS: "3" },
    stdio: "ignore",
  });
  await waitHealthy(S);
  await mongoose.connect(URI);
  // her-19: suite này test các bất biến CŨ với coach bất kỳ — gỡ ràng buộc chuyên môn của
  // seed (specialties rỗng = hồ sơ cũ, được phép dạy mọi lớp); luật chuyên môn có test riêng.
  await mongoose.connection.db.collection("trainers").updateMany({}, { $set: { specialties: [] } });

  const staff = await login("0900000000");
  const trainers = await call(S, "/schedule/trainers", { token: staff.token });
  coachId = trainers.data?.trainers?.[0]?.id;
  assert.ok(coachId, `seed phải có ít nhất 1 HLV để xếp lịch: ${JSON.stringify(trainers.data)}`);
});

after(async () => {
  proc?.kill();
  await mongoose.disconnect();
});

// ---------- L1: async error không crash / không treo ----------

test("L1: ObjectId sai kiểu -> 400 JSON rõ ràng, không crash, không treo", async () => {
  const customer = await login("0909090909");
  const staff = await login("0900000000");

  const del = await call(S, "/bookings/khong-phai-id", { method: "DELETE", token: customer.token });
  assert.equal(del.status, 400);
  assert.match(del.data.error, /không hợp lệ/);

  const cust = await call(S, "/management/customers/abc/bookings", { token: staff.token });
  assert.equal(cust.status, 400);

  // Server vẫn sống
  const health = await call(S, "/health");
  assert.equal(health.status, 200);
});

test("L1: POST /bookings với classId rác -> lỗi thân thiện và KHÔNG bị trừ buổi", async () => {
  const customer = await login("0909090909");
  const userId = await userIdOf("0909090909");
  const before = await totalUsed(userId);

  const r = await call(S, "/bookings", { method: "POST", token: customer.token, body: { classId: "xyz" } });
  assert.equal(r.status, 404);

  assert.equal(await totalUsed(userId), before, "thất bại giữa chừng không được để mất buổi của khách");
});

test("L1: bắn loạt request dữ liệu rác qua nhiều route — server sống, login vẫn hoạt động", async () => {
  const customer = await login("0909090909");
  const staff = await login("0900000000");
  const garbage = [
    () => call(S, "/bookings", { method: "POST", token: customer.token, body: { classId: 12345 } }),
    () => call(S, "/bookings", { method: "POST", token: customer.token, body: {} }),
    () => call(S, "/bookings/[object]", { method: "DELETE", token: customer.token }),
    () => call(S, "/schedule/classes?from=khong-phai-ngay", { token: staff.token }),
    () => call(S, "/schedule/classes/abc", { method: "PATCH", token: staff.token, body: { startAt: "xyz" } }),
    () => call(S, "/accounts/abc", { method: "PATCH", token: staff.token, body: { isActive: false } }),
    () => call(S, "/management/classes/xyz/roster", { token: staff.token }),
  ];
  for (const fire of garbage) {
    const r = await fire();
    assert.ok((r.status >= 400 && r.status < 500) || r.status === 200, `phải trả 2xx/4xx thân thiện, nhận ${r.status}: ${JSON.stringify(r.data)}`);
    assert.ok(r.data !== null, "phải trả JSON, không được treo/đóng kết nối");
  }
  await login("0909090909"); // server vẫn đăng nhập được bình thường
});

// ---------- L2: race condition ----------

test("L2: 2 khách giành 1 chỗ cuối cùng lúc (lớp 1:1) -> đúng 1 người thắng, lớp không vượt sức chứa", async () => {
  const staff = await login("0900000000");
  const c1 = await login("0909090909");
  const c2 = await login("0912345678");
  const [id1, id2] = [await userIdOf("0909090909"), await userIdOf("0912345678")];
  await givePackage(id1, ["boxing"], "1:1");
  await givePackage(id2, ["boxing"], "1:1");
  const cls = await createClass(staff.token, { format: "1:1", serviceType: "boxing", name: "Race 1 cho" });

  const [u1Before, u2Before] = [await totalUsed(id1), await totalUsed(id2)];

  const [r1, r2] = await Promise.all([
    call(S, "/bookings", { method: "POST", token: c1.token, body: { classId: cls._id } }),
    call(S, "/bookings", { method: "POST", token: c2.token, body: { classId: cls._id } }),
  ]);
  const statuses = [r1.status, r2.status].sort();
  assert.deepEqual(statuses, [201, 400], `phải đúng 1 thắng 1 thua, nhận ${JSON.stringify([r1, r2])}`);

  const dbClass = await GymClass.findById(cls._id);
  assert.equal(dbClass.bookedCount, 1, "bookedCount phải đúng 1 — trước đây race làm thành 2");
  const count = await Booking.countDocuments({ classId: cls._id, status: "booked" });
  assert.equal(count, 1);

  // Người THUA phải được hoàn buổi đã trừ tạm — tổng số buổi bị trừ của cả 2 người đúng bằng 1
  const [u1After, u2After] = [await totalUsed(id1), await totalUsed(id2)];
  assert.equal(u1After - u1Before + (u2After - u2Before), 1, "người thua race không được mất buổi");
});

test("L2: lớp 1:2 còn ĐÚNG 1 chỗ, 2 khách bắn song song -> 1 người thắng, lớp kín đúng 2", async () => {
  const staff = await login("0900000000");
  const c1 = await login("0909090909");
  const c2 = await login("0912345678");
  const [id1, id2] = [await userIdOf("0909090909"), await userIdOf("0912345678")];
  await givePackage(id1, ["gym"], "1:2");
  await givePackage(id2, ["gym"], "1:2");
  const cls = await createClass(staff.token, { format: "1:2", serviceType: "gym", name: "Race 1:2" });
  // Mô phỏng 1 khách khác đã đặt trước -> lớp còn đúng 1 chỗ khi 2 người cùng bấm
  await GymClass.updateOne({ _id: cls._id }, { $inc: { bookedCount: 1 } });

  const [u1Before, u2Before] = [await totalUsed(id1), await totalUsed(id2)];

  const [r1, r2] = await Promise.all([
    call(S, "/bookings", { method: "POST", token: c1.token, body: { classId: cls._id } }),
    call(S, "/bookings", { method: "POST", token: c2.token, body: { classId: cls._id } }),
  ]);
  assert.deepEqual([r1.status, r2.status].sort(), [201, 400], JSON.stringify([r1.data, r2.data]));

  const dbClass = await GymClass.findById(cls._id);
  assert.equal(dbClass.bookedCount, 2, "lớp 1:2 chỉ được kín đúng 2 chỗ");
  assert.equal(await Booking.countDocuments({ classId: cls._id, status: "booked" }), 1);

  const [u1After, u2After] = [await totalUsed(id1), await totalUsed(id2)];
  assert.equal(u1After - u1Before + (u2After - u2Before), 1, "người thua race không được mất buổi");
});

test("H7: gói đúng bộ môn nhưng SAI loại hình -> 400 nói rõ 'loại hình', không trừ buổi", async () => {
  const staff = await login("0900000000");
  const kh = await createCustomer(staff.token, "Khach sai loai hinh");
  await givePackage(kh.userId, ["stretching"], "1:1"); // chỉ có gói 1:1
  const cls = await createClass(staff.token, { format: "1:2", serviceType: "stretching", name: "Sai loai hinh" });

  const r = await call(S, "/bookings", { method: "POST", token: kh.token, body: { classId: cls._id } });
  assert.equal(r.status, 400, JSON.stringify(r.data));
  assert.match(r.data.error, /loại hình/, "phải nói rõ lý do sai LOẠI HÌNH (C6), không báo chung chung");
  assert.equal(await totalUsed(kh.userId), 0, "đặt hỏng không được trừ buổi");
  assert.equal((await GymClass.findById(cls._id)).bookedCount, 0);
});

test("H7: khách chưa có gói của bộ môn lớp -> 400 nói rõ thiếu gói bộ môn nào, không trừ chỗ", async () => {
  const staff = await login("0900000000");
  const kh = await createCustomer(staff.token, "Khach chua co goi"); // khách mới, chưa có gói nào
  const cls = await createClass(staff.token, { format: "1:4", serviceType: "pilates", name: "Chua co goi" });

  const r = await call(S, "/bookings", { method: "POST", token: kh.token, body: { classId: cls._id } });
  assert.equal(r.status, 400, JSON.stringify(r.data));
  assert.match(r.data.error, /cần gói có bộ môn Pilates/, "phải nói rõ thiếu gói BỘ MÔN nào (C6)");
  assert.equal((await GymClass.findById(cls._id)).bookedCount, 0);
});

test("H7: gói MIX 2 bộ môn — lớp yoga 1:4 trừ đúng gói mix; lớp gym 1:4 (ngoài gói) bị chặn", async () => {
  const staff = await login("0900000000");
  const kh = await createCustomer(staff.token, "Khach goi mix");
  const pkg = await givePackage(kh.userId, ["pilates", "yoga"], "1:4");
  const clsYoga = await createClass(staff.token, { format: "1:4", serviceType: "yoga", name: "Mix yoga" });
  const clsPilates = await createClass(staff.token, { format: "1:4", serviceType: "pilates", name: "Mix pilates" });
  const clsGym = await createClass(staff.token, { format: "1:4", serviceType: "gym", name: "Mix gym" });

  const okYoga = await call(S, "/bookings", { method: "POST", token: kh.token, body: { classId: clsYoga._id } });
  assert.equal(okYoga.status, 201, JSON.stringify(okYoga.data));
  assert.equal(
    (await Booking.findById(okYoga.data.booking.id)).packageId.toString(),
    pkg._id.toString(),
    "buổi phải trừ vào chính gói mix chứa bộ môn đó"
  );

  // Bộ môn thứ 2 trong CÙNG gói cũng dùng được
  const okPilates = await call(S, "/bookings", { method: "POST", token: kh.token, body: { classId: clsPilates._id } });
  assert.equal(okPilates.status, 201, JSON.stringify(okPilates.data));
  assert.equal((await Package.findById(pkg._id)).usedSessions, 2, "2 bộ môn trong gói mix trừ chung 1 gói");

  const blocked = await call(S, "/bookings", { method: "POST", token: kh.token, body: { classId: clsGym._id } });
  assert.equal(blocked.status, 400, JSON.stringify(blocked.data));
  assert.match(blocked.data.error, /chưa có gói Gym/, "bộ môn NGOÀI gói mix phải bị chặn, nói rõ thiếu môn nào");
  assert.equal((await Package.findById(pkg._id)).usedSessions, 2, "lớp ngoài gói không được trừ buổi");
  assert.equal((await GymClass.findById(clsGym._id)).bookedCount, 0);
});

test("H7: gói THỜI HẠN yoga 1:8 (không giới hạn buổi) — đặt nhiều buổi OK, hủy vẫn hoàn đối xứng", async () => {
  const staff = await login("0900000000");
  const kh = await createCustomer(staff.token, "Khach goi thoi han");
  const pkg = await Package.create({
    userId: kh.userId,
    name: "Yoga 1 thang",
    serviceTypes: ["yoga"],
    format: "1:8",
    price: 1200000,
    totalSessions: null, // không giới hạn số buổi (Q3)
    activatedAt: new Date(),
    expiresAt: hoursFromNow(24 * 60),
  });

  const bookingIds = [];
  for (let i = 0; i < 3; i++) {
    const cls = await createClass(staff.token, { format: "1:8", serviceType: "yoga", name: `Yoga thoi han ${i}` });
    const r = await call(S, "/bookings", { method: "POST", token: kh.token, body: { classId: cls._id } });
    assert.equal(r.status, 201, `buổi thứ ${i + 1} phải đặt được, gói thời hạn không chặn số buổi: ${JSON.stringify(r.data)}`);
    bookingIds.push(r.data.booking.id);
  }
  assert.equal((await Package.findById(pkg._id)).usedSessions, 3, "gói không giới hạn buổi vẫn đếm usedSessions để thống kê");

  const cancel = await call(S, `/bookings/${bookingIds[0]}`, { method: "DELETE", token: kh.token });
  assert.equal(cancel.status, 200, JSON.stringify(cancel.data));
  assert.equal(
    (await Package.findById(pkg._id)).usedSessions,
    2,
    "hủy phải hoàn 1 buổi kể cả gói không giới hạn — trừ/hoàn đối xứng (C2)"
  );
});

test("Q11: gói khớp nhưng ĐANG BẢO LƯU -> 400 báo đúng lý do, không trừ buổi", async () => {
  const staff = await login("0900000000");
  const kh = await createCustomer(staff.token, "Khach goi bao luu");
  const pkg = await givePackage(kh.userId, ["gym"], "1:2", { pausedAt: new Date() });
  const cls = await createClass(staff.token, { format: "1:2", serviceType: "gym", name: "Goi bao luu" });

  const r = await call(S, "/bookings", { method: "POST", token: kh.token, body: { classId: cls._id } });
  assert.equal(r.status, 400, JSON.stringify(r.data));
  assert.match(r.data.error, /bảo lưu/, "phải nói rõ gói đang bảo lưu (C6)");
  assert.equal((await Package.findById(pkg._id)).usedSessions, 0, "gói bảo lưu không được trừ buổi");
  assert.equal((await GymClass.findById(cls._id)).bookedCount, 0);
});

test("L2: bấm đúp — 8 request giống hệt song song -> 1 booking, trừ đúng 1 buổi", async () => {
  const staff = await login("0900000000");
  const c1 = await login("0909090909");
  const id1 = await userIdOf("0909090909");
  await givePackage(id1, ["pilates"], "1:4");
  const cls = await createClass(staff.token, { format: "1:4", serviceType: "pilates", name: "Race double tap" });

  const usedBefore = await totalUsed(id1);

  const results = await Promise.all(
    Array.from({ length: 8 }, () =>
      call(S, "/bookings", { method: "POST", token: c1.token, body: { classId: cls._id } })
    )
  );
  const wins = results.filter((r) => r.status === 201);
  assert.equal(wins.length, 1, `phải đúng 1 thành công, nhận ${results.map((r) => r.status)}`);

  assert.equal(await Booking.countDocuments({ classId: cls._id, status: "booked" }), 1);
  const dbClass = await GymClass.findById(cls._id);
  assert.equal(dbClass.bookedCount, 1, "các lượt thua phải trả lại chỗ đã giành tạm");

  assert.equal(await totalUsed(id1), usedBefore + 1, "chỉ được trừ đúng 1 buổi dù bấm 8 lần");
});

test("L2: gói còn đúng 1 buổi, đặt 2 lớp khác nhau song song -> chỉ 1 thành công, không trừ quá", async () => {
  const staff = await login("0900000000");
  const kh = await createCustomer(staff.token, "Khach con 1 buoi");
  // Gói yoga 1:4 DUY NHẤT của khách này và chỉ còn 1 buổi
  const pkg = await givePackage(kh.userId, ["yoga"], "1:4", { totalSessions: 3, usedSessions: 2 });
  const clsA = await createClass(staff.token, { format: "1:4", serviceType: "yoga", name: "Race buoi cuoi A" });
  const clsB = await createClass(staff.token, { format: "1:4", serviceType: "yoga", name: "Race buoi cuoi B" });

  const [r1, r2] = await Promise.all([
    call(S, "/bookings", { method: "POST", token: kh.token, body: { classId: clsA._id } }),
    call(S, "/bookings", { method: "POST", token: kh.token, body: { classId: clsB._id } }),
  ]);
  assert.deepEqual([r1.status, r2.status].sort(), [201, 400], JSON.stringify([r1.data, r2.data]));

  const pkgAfter = await Package.findById(pkg._id);
  assert.equal(pkgAfter.usedSessions, pkgAfter.totalSessions, "usedSessions không được vượt totalSessions");

  const [bookedA, bookedB] = [
    (await GymClass.findById(clsA._id)).bookedCount,
    (await GymClass.findById(clsB._id)).bookedCount,
  ];
  assert.equal(bookedA + bookedB, 1, "lớp THUA phải được trả lại chỗ (chỉ 1 lớp có người)");
  assert.equal(
    await Booking.countDocuments({ userId: kh.userId, status: "booked" }),
    1,
    "chỉ được tạo đúng 1 booking"
  );
});

// ---------- L3: hoàn buổi về đúng gói ----------

test("L3: khách có 2 gói cùng bộ môn+loại hình — hủy hoàn về ĐÚNG gói đã trừ, gói kia không đổi", async () => {
  const staff = await login("0900000000");
  const c1 = await login("0909090909");
  const id1 = await userIdOf("0909090909");
  const cls = await createClass(staff.token, { format: "1:2", serviceType: "pilates", name: "Refund dung goi" });

  const pkgOld = await givePackage(id1, ["pilates"], "1:2", { expiresAt: hoursFromNow(24 * 50) });
  // Q4 (12/08): gói HẠN GẦN trừ trước -> gói này phải là gói bị trừ
  const pkgNew = await givePackage(id1, ["pilates"], "1:2", { expiresAt: hoursFromNow(24 * 20) });
  const oldUsedBefore = pkgOld.usedSessions;

  const booked = await call(S, "/bookings", { method: "POST", token: c1.token, body: { classId: cls._id } });
  assert.equal(booked.status, 201, JSON.stringify(booked.data));

  const bookingDoc = await Booking.findById(booked.data.booking.id);
  assert.equal(bookingDoc.packageId.toString(), pkgNew._id.toString(), "booking phải ghi lại gói đã trừ");
  assert.equal(bookingDoc.serviceType, "pilates", "booking phải snapshot bộ môn của lớp");
  assert.equal(bookingDoc.format, "1:2", "booking phải snapshot loại hình của lớp");
  assert.equal((await Package.findById(pkgNew._id)).usedSessions, 1);

  const cancel = await call(S, `/bookings/${booked.data.booking.id}`, { method: "DELETE", token: c1.token });
  assert.equal(cancel.status, 200);

  assert.equal((await Package.findById(pkgNew._id)).usedSessions, 0, "buổi phải hoàn về gói ĐÃ trừ");
  assert.equal((await Package.findById(pkgOld._id)).usedSessions, oldUsedBefore, "gói kia không được đụng vào");
});

test("L3: lễ tân hủy hộ — vẫn hoàn về đúng gói ghi trên booking", async () => {
  const staff = await login("0900000000");
  const c1 = await login("0909090909");
  const cls = await createClass(staff.token, { format: "1:2", serviceType: "pilates", name: "Staff refund dung goi" });

  const booked = await call(S, "/bookings", { method: "POST", token: c1.token, body: { classId: cls._id } });
  assert.equal(booked.status, 201, JSON.stringify(booked.data));
  const bookingDoc = await Booking.findById(booked.data.booking.id);
  const usedBefore = (await Package.findById(bookingDoc.packageId)).usedSessions;

  const cancel = await call(S, `/bookings/${booked.data.booking.id}`, { method: "DELETE", token: staff.token });
  assert.equal(cancel.status, 200);
  assert.equal(
    (await Package.findById(bookingDoc.packageId)).usedSessions,
    usedBefore - 1,
    "lễ tân hủy cũng phải hoàn đúng gói, không theo 'gói mới nhất'"
  );
});

test("L2+L3: hủy 2 lần song song cùng 1 booking -> chỉ hoàn buổi và trả chỗ 1 lần", async () => {
  const staff = await login("0900000000");
  const c1 = await login("0909090909");
  const id1 = await userIdOf("0909090909");
  await givePackage(id1, ["boxing"], "1:4");
  const cls = await createClass(staff.token, { format: "1:4", serviceType: "boxing", name: "Double cancel" });

  const booked = await call(S, "/bookings", { method: "POST", token: c1.token, body: { classId: cls._id } });
  assert.equal(booked.status, 201, JSON.stringify(booked.data));
  const bookingDoc = await Booking.findById(booked.data.booking.id);
  const usedAfterBook = (await Package.findById(bookingDoc.packageId)).usedSessions;

  const [r1, r2] = await Promise.all([
    call(S, `/bookings/${booked.data.booking.id}`, { method: "DELETE", token: c1.token }),
    call(S, `/bookings/${booked.data.booking.id}`, { method: "DELETE", token: c1.token }),
  ]);
  assert.deepEqual([r1.status, r2.status].sort(), [200, 400], "chỉ 1 lần hủy có hiệu lực");

  assert.equal((await Package.findById(bookingDoc.packageId)).usedSessions, usedAfterBook - 1, "buổi chỉ hoàn 1 lần");
  assert.equal((await GymClass.findById(cls._id)).bookedCount, 0, "chỗ chỉ trả 1 lần, không âm");
});

test("L3: booking không có packageId — fallback hoàn vào gói khớp bộ môn+loại hình, chỗ không âm", async () => {
  const staff = await login("0900000000");
  const kh = await createCustomer(staff.token, "Khach booking le");
  const cls = await createClass(staff.token, { format: "1:4", serviceType: "gym", name: "Legacy booking" });

  const pkg = await givePackage(kh.userId, ["gym"], "1:4", { usedSessions: 5 });
  // Gói khác bộ môn của cùng khách — fallback KHÔNG được đụng vào gói này
  const pkgKhac = await givePackage(kh.userId, ["boxing"], "1:4", { usedSessions: 5 });

  // Booking "dữ liệu bất thường" ghi thẳng vào DB: không có packageId, chỗ chưa từng được giành
  const legacy = await Booking.create({
    userId: kh.userId,
    classId: cls._id,
    trainerId: cls.coachId,
    title: cls.name,
    serviceType: "gym",
    format: "1:4",
    startAt: cls.startAt,
    endAt: cls.endAt,
    packageId: null,
  });

  const cancel = await call(S, `/bookings/${legacy._id}`, { method: "DELETE", token: staff.token });
  assert.equal(cancel.status, 200, JSON.stringify(cancel.data));
  assert.equal((await Package.findById(pkg._id)).usedSessions, 4, "fallback hoàn về gói khớp bộ môn + loại hình");
  assert.equal((await Package.findById(pkgKhac._id)).usedSessions, 5, "gói bộ môn khác không được đụng vào");
  assert.equal((await GymClass.findById(cls._id)).bookedCount, 0, "guard không cho bookedCount âm");
});

test("L3: hủy buổi 1:1 — chỗ mở lại cho người khác đặt được, buổi hoàn đúng gói", async () => {
  const staff = await login("0900000000");
  const c1 = await login("0909090909");
  const c2 = await login("0912345678");
  await givePackage(await userIdOf("0909090909"), ["boxing"], "1:1");
  await givePackage(await userIdOf("0912345678"), ["boxing"], "1:1");
  const cls = await createClass(staff.token, { format: "1:1", serviceType: "boxing", name: "Huy mo lai cho" });

  const booked = await call(S, "/bookings", { method: "POST", token: c1.token, body: { classId: cls._id } });
  assert.equal(booked.status, 201, JSON.stringify(booked.data));
  const bookingDoc = await Booking.findById(booked.data.booking.id);
  const usedAfterBook = (await Package.findById(bookingDoc.packageId)).usedSessions;
  assert.equal((await GymClass.findById(cls._id)).bookedCount, 1);

  // Lớp 1:1 đang kín -> người khác chưa đặt được
  const blocked = await call(S, "/bookings", { method: "POST", token: c2.token, body: { classId: cls._id } });
  assert.equal(blocked.status, 400, JSON.stringify(blocked.data));

  const cancel = await call(S, `/bookings/${booked.data.booking.id}`, { method: "DELETE", token: c1.token });
  assert.equal(cancel.status, 200);
  assert.equal((await GymClass.findById(cls._id)).bookedCount, 0, "chỗ phải mở lại cho người khác đặt");
  assert.equal((await Package.findById(bookingDoc.packageId)).usedSessions, usedAfterBook - 1);

  const retry = await call(S, "/bookings", { method: "POST", token: c2.token, body: { classId: cls._id } });
  assert.equal(retry.status, 201, JSON.stringify(retry.data));
});

test("H7: gói đúng bộ môn+loại hình nhưng ĐÃ hết hạn -> 400, báo đúng lý do", async () => {
  const staff = await login("0900000000");
  const kh = await createCustomer(staff.token, "Khach goi het han");
  await givePackage(kh.userId, ["boxing"], "1:2", { expiresAt: hoursFromNow(-24) });
  const cls = await createClass(staff.token, { format: "1:2", serviceType: "boxing", name: "Het han goi" });

  const r = await call(S, "/bookings", { method: "POST", token: kh.token, body: { classId: cls._id } });
  assert.equal(r.status, 400, JSON.stringify(r.data));
  assert.match(r.data.error, /đã hết hạn/);
  assert.equal(await totalUsed(kh.userId), 0, "đặt hỏng không được trừ buổi");
});

test("H7: gói còn hạn HÔM NAY nhưng hết hạn TRƯỚC ngày tập -> 400, không trừ buổi", async () => {
  const staff = await login("0900000000");
  const kh = await createCustomer(staff.token, "Khach goi chet som");
  // Gói yoga 1:2 duy nhất: còn hạn 10 ngày; lớp được xếp sau đó (mọi lớp test đều > 200h)
  const pkg = await givePackage(kh.userId, ["yoga"], "1:2", { expiresAt: hoursFromNow(24 * 10) });
  // Giờ cố định 12 ngày tới — nằm ngoài dải nextHour() nên không đụng lớp nào khác
  const cls = await createClass(staff.token, { hour: 24 * 12, format: "1:2", serviceType: "yoga", name: "Goi chet truoc ngay tap" });

  const r = await call(S, "/bookings", { method: "POST", token: kh.token, body: { classId: cls._id } });
  assert.equal(r.status, 400, JSON.stringify(r.data));
  assert.match(r.data.error, /hết hạn trước ngày/);
  assert.equal((await Package.findById(pkg._id)).usedSessions, 0, "không được trừ buổi vào gói sắp chết");
  assert.equal((await GymClass.findById(cls._id)).bookedCount, 0);
});

test("Review T4: gọi thẳng API đặt lớp đã qua giờ -> 400, không mất buổi", async () => {
  const c1 = await login("0909090909");
  const id1 = await userIdOf("0909090909");
  const before = await totalUsed(id1);

  // Lớp quá khứ không tạo được qua API (đã chặn) — chèn thẳng DB để mô phỏng dữ liệu cũ
  const pastClass = await GymClass.create({
    name: "Lop da qua",
    serviceType: "pilates",
    format: "1:4",
    coachId,
    startAt: hoursFromNow(-5),
    endAt: hoursFromNow(-4),
    capacity: FORMAT_CAPACITY["1:4"],
  });
  const r = await call(S, "/bookings", { method: "POST", token: c1.token, body: { classId: pastClass._id } });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /đã qua/);

  assert.equal(await totalUsed(id1), before, "thử đặt lớp quá khứ không được làm mất buổi");
});

// ---------- Hồi quy ----------

test("Hồi quy: đặt rồi hủy tuần tự vẫn chuẩn — số buổi và chỗ quay về như cũ", async () => {
  const staff = await login("0900000000");
  const kh = await createCustomer(staff.token, "Khach hoi quy");
  const pkg = await givePackage(kh.userId, ["stretching"], "1:4");
  const cls = await createClass(staff.token, { format: "1:4", serviceType: "stretching", name: "Regression flow" });

  const before = (await Package.findById(pkg._id)).usedSessions;
  const booked = await call(S, "/bookings", { method: "POST", token: kh.token, body: { classId: cls._id } });
  assert.equal(booked.status, 201, JSON.stringify(booked.data));
  assert.equal((await Package.findById(pkg._id)).usedSessions, before + 1);

  const cancel = await call(S, `/bookings/${booked.data.booking.id}`, { method: "DELETE", token: kh.token });
  assert.equal(cancel.status, 200);
  assert.equal((await Package.findById(pkg._id)).usedSessions, before, "hủy phải hoàn đúng gói đã trừ");
  assert.equal((await GymClass.findById(cls._id)).bookedCount, 0);
});
