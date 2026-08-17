require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const GymClass = require("../models/GymClass");
const Package = require("../models/Package");

// Gán bộ môn cho dữ liệu CŨ chưa có serviceType, đoán theo tên (Q8 12/08/2026).
// Chỉ ghi bản ghi chưa có — không đè cái đã gán. In báo cáo để chủ dự án soát lại;
// tên không đoán được thì liệt kê chứ KHÔNG gán bừa.
// Chạy: node src/scripts/backfill-service-type.js  (dùng MONGODB_URI trong .env)
function guessType(name, allowPT) {
  const n = (name || "").toLowerCase();
  if (/pilates/.test(n)) return "pilates";
  if (/yoga/.test(n)) return "yoga";
  if (allowPT && (/\bpt\b/.test(n) || n.includes("1:1"))) return "pt";
  if (/gym|circuit|strength|cardio/.test(n)) return "gym";
  return null;
}

async function run() {
  await connectDB();
  const updated = [];
  const unknown = [];
  const targets = [
    [GymClass, "Lớp", false],
    [Package, "Gói", true],
  ];
  for (const [Model, label, allowPT] of targets) {
    const docs = await Model.find({
      $or: [{ serviceType: null }, { serviceType: { $exists: false } }],
    });
    for (const d of docs) {
      const t = guessType(d.name, allowPT);
      if (t) {
        await Model.updateOne({ _id: d._id }, { $set: { serviceType: t } });
        updated.push(`${label} "${d.name}" -> ${t}`);
      } else {
        unknown.push(`${label} "${d.name}" (id ${d._id}) — cần gán tay`);
      }
    }
  }
  console.log(`Đã gán ${updated.length} bản ghi:`);
  updated.forEach((l) => console.log("  +", l));
  if (unknown.length) {
    console.log(`\nKHÔNG đoán được ${unknown.length} bản ghi (chủ dự án gán tay):`);
    unknown.forEach((l) => console.log("  ?", l));
  } else {
    console.log("\nKhông còn bản ghi nào thiếu bộ môn.");
  }
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
