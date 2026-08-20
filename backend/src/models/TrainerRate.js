const mongoose = require("mongoose");

// Thiết lập thù lao HLV (mục 7) — EFFECTIVE-DATED: mỗi lần admin đổi là 1 bản ghi mới,
// KHÔNG sửa đè. Buổi dạy áp bản ghi có effectiveFrom <= ngày buổi diễn ra (gần nhất) —
// "mức mới chỉ áp dụng từ ngày đổi, buổi đã dạy trước đó giữ mức cũ" (bản gửi khách).
// Mỗi loại hình chọn được cách tính: theo BUỔI dạy hay theo ĐẦU KHÁCH đến
// (quyết định 16/08 — đa năng để chỉnh dần).
const trainerRateSchema = new mongoose.Schema(
  {
    trainerId: { type: mongoose.Schema.Types.ObjectId, ref: "Trainer", required: true },
    baseSalary: { type: Number, default: 0, min: 0 }, // lương cứng VND/tháng
    // her-35: 4 mức hoa hồng theo LOẠI HÌNH (chốt 19/08) — mỗi mức chọn tính theo
    // BUỔI dạy (session) hay theo ĐẦU KHÁCH đến (attendee)
    f11Amount: { type: Number, default: 0, min: 0 },
    f11Per: { type: String, enum: ["session", "attendee"], default: "session" },
    f12Amount: { type: Number, default: 0, min: 0 },
    f12Per: { type: String, enum: ["session", "attendee"], default: "session" },
    f14Amount: { type: Number, default: 0, min: 0 },
    f14Per: { type: String, enum: ["session", "attendee"], default: "session" },
    f18Amount: { type: Number, default: 0, min: 0 },
    f18Per: { type: String, enum: ["session", "attendee"], default: "session" },
    effectiveFrom: { type: Date, required: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

// Tra mức theo thời điểm buổi diễn ra
trainerRateSchema.index({ trainerId: 1, effectiveFrom: -1 });

module.exports = mongoose.model("TrainerRate", trainerRateSchema);
