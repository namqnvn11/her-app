const mongoose = require("mongoose");

// Khung giờ PT — từ her-11 (mục 6) hỗ trợ PT NHÓM: capacity 1..10 (1 = PT 1:1 như cũ).
// "Kín chỗ" = bookedCount >= capacity (suy ra, không lưu cờ riêng).
// Dữ liệu cũ dùng isBooked boolean — đã migrate bằng src/scripts/backfill-pt-capacity.js.
const ptSlotSchema = new mongoose.Schema(
  {
    trainerId: { type: mongoose.Schema.Types.ObjectId, ref: "Trainer", required: true },
    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true },
    capacity: { type: Number, default: 1, min: 1, max: 10 },
    bookedCount: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

// Query khung giờ theo thời gian và theo HLV
ptSlotSchema.index({ startAt: 1 });
ptSlotSchema.index({ trainerId: 1, startAt: 1 });

module.exports = mongoose.model("PTSlot", ptSlotSchema);
