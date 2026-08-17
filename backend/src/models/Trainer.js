const mongoose = require("mongoose");

const trainerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    // her-19: chuyên môn = CHỌN từ danh mục bộ môn (mảng key, vd ["pilates","yoga"]).
    // `specialty` (chuỗi) giữ làm nhãn hiển thị — tự sinh từ specialties khi lưu qua route.
    specialty: { type: String, default: "" },
    specialties: { type: [String], default: [] },
    avatarUrl: { type: String, default: null },
    rating: { type: Number, default: 5 },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Trainer", trainerSchema);
