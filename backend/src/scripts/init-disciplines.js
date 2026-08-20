// Khởi tạo DANH MỤC BỘ MÔN cho DB chưa có (her-19: app đọc danh mục từ DB —
// danh mục trống thì không tạo được lớp/gói). KHÔNG phải seed demo: chỉ thêm
// 5 môn gốc khi collection đang trống, DB đã có danh mục thì không đụng gì.
//
// Chạy: node src/scripts/init-disciplines.js   (dùng MONGODB_URI trong .env)

require("dotenv").config();
const mongoose = require("mongoose");
const Discipline = require("../models/Discipline");

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const n = await Discipline.countDocuments();
  if (n > 0) {
    console.log(`Danh mục đã có ${n} môn — không đụng gì.`);
  } else {
    await Discipline.create([
      { key: "gym", label: "Gym", order: 1 },
      { key: "boxing", label: "Boxing", order: 2 },
      { key: "stretching", label: "Stretching", order: 3 },
      { key: "pilates", label: "Pilates", order: 4 },
      { key: "yoga", label: "Yoga", order: 5 },
    ]);
    console.log("Đã thêm danh mục bộ môn: Gym, Boxing, Stretching, Pilates, Yoga.");
  }
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Khởi tạo danh mục thất bại:", err);
  process.exit(1);
});
