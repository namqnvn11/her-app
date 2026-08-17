const mongoose = require("mongoose");

// Thiết lập thù lao HLV (mục 7) — EFFECTIVE-DATED: mỗi lần admin đổi là 1 bản ghi mới,
// KHÔNG sửa đè. Buổi dạy áp bản ghi có effectiveFrom <= ngày buổi diễn ra (gần nhất) —
// "mức mới chỉ áp dụng từ ngày đổi, buổi đã dạy trước đó giữ mức cũ" (bản gửi khách).
// Lớp nhóm & PT nhóm chọn được cách tính: theo BUỔI dạy hay theo ĐẦU KHÁCH đến
// (quyết định 16/08 — đa năng để chỉnh dần); PT 1:1 luôn theo buổi (1 buổi = 1 khách).
const trainerRateSchema = new mongoose.Schema(
  {
    trainerId: { type: mongoose.Schema.Types.ObjectId, ref: "Trainer", required: true },
    baseSalary: { type: Number, default: 0, min: 0 }, // lương cứng VND/tháng
    groupAmount: { type: Number, default: 0, min: 0 }, // hoa hồng lớp nhóm
    groupPer: { type: String, enum: ["session", "attendee"], default: "session" },
    pt1Amount: { type: Number, default: 0, min: 0 }, // hoa hồng PT 1:1 (theo buổi)
    ptGroupAmount: { type: Number, default: 0, min: 0 }, // hoa hồng PT nhóm
    ptGroupPer: { type: String, enum: ["session", "attendee"], default: "session" },
    effectiveFrom: { type: Date, required: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

// Tra mức theo thời điểm buổi diễn ra
trainerRateSchema.index({ trainerId: 1, effectiveFrom: -1 });

module.exports = mongoose.model("TrainerRate", trainerRateSchema);
