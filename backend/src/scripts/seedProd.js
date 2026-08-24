// Seed CHẠY THẬT (her-47, 24/08/2026) — khác seed.js (demo trình diễn):
// CHỈ tạo (1) danh mục 5 bộ môn — bắt buộc để tạo buổi/gói (H7), (2) 1 tài khoản ADMIN.
// KHÔNG tạo HLV/lễ tân/khách/gói/lịch demo — chủ phòng tập tự tạo trong app.
// KHÔNG xoá gì nếu DB đã có dữ liệu — chỉ thêm phần còn thiếu, chạy lại bao nhiêu lần cũng an toàn.
// Chạy: npm run seed:prod   (mật khẩu admin ban đầu: 123456 — ĐỔI NGAY sau lần đăng nhập đầu)
require("dotenv").config();
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const connectDB = require("../config/db");

const User = require("../models/User");
const Discipline = require("../models/Discipline");
const Booking = require("../models/Booking");
const Setting = require("../models/Setting");

const ADMIN_PHONE = process.env.SEED_ADMIN_PHONE || "0999999999";

async function run() {
  await connectDB();

  // Index chống đặt trùng + settings phải có trước khi server nhận request thật
  await Booking.syncIndexes();
  await Setting.syncIndexes();

  // Danh mục bộ môn: thêm môn còn thiếu, không đụng môn đã có
  const disciplines = [
    { key: "gym", label: "Gym", order: 1 },
    { key: "boxing", label: "Boxing", order: 2 },
    { key: "stretching", label: "Stretching", order: 3 },
    { key: "pilates", label: "Pilates", order: 4 },
    { key: "yoga", label: "Yoga", order: 5 },
  ];
  for (const d of disciplines) {
    await Discipline.updateOne({ key: d.key }, { $setOnInsert: d }, { upsert: true });
  }

  const existing = await User.findOne({ phone: ADMIN_PHONE });
  if (existing) {
    console.log(`Tài khoản ${ADMIN_PHONE} đã tồn tại (role ${existing.role}) — giữ nguyên, không tạo lại.`);
  } else {
    await User.create({
      name: "Chủ phòng tập",
      phone: ADMIN_PHONE,
      passwordHash: await bcrypt.hash("123456", 10),
      role: "admin",
    });
    console.log(`Đã tạo ADMIN ${ADMIN_PHONE} / mật khẩu 123456 — ĐỔI MẬT KHẨU NGAY sau khi đăng nhập.`);
  }

  console.log(`Bộ môn trong danh mục: ${(await Discipline.countDocuments())}. Xong.`);
  await mongoose.disconnect();
}

run().catch((err) => { console.error("Seed prod lỗi:", err); process.exit(1); });
