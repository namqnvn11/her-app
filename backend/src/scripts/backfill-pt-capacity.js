// Backfill her-11 (mục 6 — PT nhóm): PTSlot bỏ cờ isBooked, chuyển sang capacity/bookedCount.
// Slot cũ: capacity = 1; bookedCount = isBooked ? 1 : 0; xoá field isBooked.
// Idempotent — chạy lại không hỏng dữ liệu đã chuyển.
//
// Chạy: node src/scripts/backfill-pt-capacity.js   (dùng MONGODB_URI trong .env)
// ⚠️ Quy trình Atlas (bản production) — review her-11 V4:
//    1. Chạy script TRƯỚC khi deploy code mới (như backfill her-05).
//    2. Deploy code mới.
//    3. Chạy script LẦN 2 — dọn các slot code CŨ kịp tạo/đặt (isBooked) trong lúc deploy.
//    Script idempotent, chạy bao nhiêu lần cũng an toàn.

require("dotenv").config();
const mongoose = require("mongoose");

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const col = mongoose.connection.db.collection("ptslots");

  const booked = await col.updateMany(
    { isBooked: true, capacity: { $exists: false } },
    { $set: { capacity: 1, bookedCount: 1 }, $unset: { isBooked: "" } }
  );
  const empty = await col.updateMany(
    { isBooked: { $in: [false, null] }, capacity: { $exists: false } },
    { $set: { capacity: 1, bookedCount: 0 }, $unset: { isBooked: "" } }
  );
  // Sót field isBooked trên doc đã có capacity (chạy dở lần trước) -> chỉ gỡ cờ
  const leftover = await col.updateMany({ isBooked: { $exists: true } }, { $unset: { isBooked: "" } });

  console.log(`Đã chuyển ${booked.modifiedCount} slot đã đặt, ${empty.modifiedCount} slot trống, gỡ cờ thừa ${leftover.modifiedCount}.`);
  const remaining = await col.countDocuments({ capacity: { $exists: false } });
  console.log(remaining === 0 ? "Hoàn tất — mọi slot đã có capacity/bookedCount." : `⚠️ Còn ${remaining} slot chưa có capacity!`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Backfill thất bại:", err);
  process.exit(1);
});
