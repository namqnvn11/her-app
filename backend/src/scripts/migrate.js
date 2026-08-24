// her-47 (24/08/2026): MIGRATION tự động khi deploy — deploy.sh gọi `npm run migrate`
// TRƯỚC khi restart API, nên push code là DB tự cập nhật theo, không phải nhớ lệnh gì.
//
// Cách viết 1 migration: tạo file trong backend/migrations/ tên dạng `001-mo-ta-ngan.js`
// (số thứ tự tăng dần — chạy theo alphabet), nội dung:
//     module.exports = { up: async (db) => { /* db = mongoose.connection.db */ } };
// Mỗi file chỉ chạy MỘT LẦN trên mỗi DB (ghi sổ vào collection `migrations`); viết up()
// kiểu chạy-lại-vô-hại (idempotent) để lỡ chạy tay lần nữa cũng không phá dữ liệu.
//
// Ngoài các file trên, MỖI LẦN chạy đều syncIndexes() toàn bộ model — thêm/xoá index
// trong schema là deploy xong DB có theo, không cần viết migration riêng cho index.
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const connectDB = require("../config/db");

const MODELS_DIR = path.join(__dirname, "..", "models");
const MIGRATIONS_DIR = path.join(__dirname, "..", "..", "migrations");

async function run() {
  await connectDB();

  // 1. Index của mọi model khớp schema hiện tại (idempotent, an toàn chạy mỗi deploy)
  for (const f of fs.readdirSync(MODELS_DIR).filter((f) => f.endsWith(".js")).sort()) {
    const model = require(path.join(MODELS_DIR, f));
    if (model?.syncIndexes) {
      await model.syncIndexes();
      console.log(`[migrate] syncIndexes ${model.modelName}`);
    }
  }

  // 2. Các file migration chưa chạy, theo thứ tự tên file
  const applied = new Set(
    (await mongoose.connection.db.collection("migrations").find({}).toArray()).map((m) => m.name)
  );
  const files = fs.existsSync(MIGRATIONS_DIR)
    ? fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".js")).sort()
    : [];
  let ran = 0;
  for (const name of files) {
    if (applied.has(name)) continue;
    const mod = require(path.join(MIGRATIONS_DIR, name));
    if (typeof mod?.up !== "function") throw new Error(`Migration ${name} thiếu hàm up()`);
    console.log(`[migrate] chạy ${name}...`);
    await mod.up(mongoose.connection.db); // lỗi thì DỪNG và exit 1 — deploy.sh sẽ dừng theo, không restart API
    await mongoose.connection.db.collection("migrations").insertOne({ name, appliedAt: new Date() });
    ran += 1;
  }
  console.log(`[migrate] xong — ${ran} migration mới, ${files.length - ran} đã chạy từ trước.`);
  await mongoose.disconnect();
}

run().catch((err) => { console.error("[migrate] LỖI:", err); process.exit(1); });
