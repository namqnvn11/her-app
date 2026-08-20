const mongoose = require("mongoose");
const { FORMATS } = require("../utils/formats");

const gymClassSchema = new mongoose.Schema(
  {
    name: { type: String, required: true }, // "Pilates Reformer", "Vinyasa Yoga"...
    // Bộ môn của lớp (H7): quyết định gói loại nào đặt được lớp này
    // Bộ môn: validate ở route theo danh mục DB (her-19) — không enum cứng để thêm môn không phải sửa code
    serviceType: { type: String, required: true },
    // her-35: LOẠI HÌNH buổi — capacity luôn = FORMAT_CAPACITY[format], server tự gán khi tạo/sửa
    format: { type: String, enum: FORMATS, required: true },
    coachId: { type: mongoose.Schema.Types.ObjectId, ref: "Trainer", required: true },
    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true },
    capacity: { type: Number, required: true }, // không có mặc định: luôn do server gán từ format
    bookedCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

gymClassSchema.virtual("spotsLeft").get(function () {
  return Math.max(this.capacity - this.bookedCount, 0);
});

// Query danh sách lớp theo thời gian và theo HLV (kiểm tra trùng giờ khi xếp lịch)
gymClassSchema.index({ startAt: 1 });
gymClassSchema.index({ coachId: 1, startAt: 1 });

module.exports = mongoose.model("GymClass", gymClassSchema);
