const mongoose = require("mongoose");
const { FORMATS } = require("../utils/formats");

// her-32: LUẬT lịch tự động — mỗi luật sinh lớp theo loại hình, lặp theo các THỨ trong tuần,
// luôn phủ trước 7 ngày (tầm thấy của học viên ở màn Đặt lịch)
const autoScheduleRuleSchema = new mongoose.Schema(
  {
    serviceType: { type: String, required: true, lowercase: true, trim: true },
    // her-36: tên buổi sinh ra (tên riêng do quầy đặt, hoặc nhãn bộ môn lúc tạo luật)
    name: { type: String, required: true },
    coachId: { type: mongoose.Schema.Types.ObjectId, ref: "Trainer", required: true },
    hour: { type: Number, required: true, min: 0, max: 23 },
    minute: { type: Number, required: true, min: 0, max: 59 },
    daysOfWeek: { type: [Number], required: true }, // 0 = CN ... 6 = T7
    // her-35: capacity không lưu riêng nữa — suy ra từ FORMAT_CAPACITY[format] lúc sinh lớp
    format: { type: String, enum: FORMATS, required: true },
    active: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("AutoScheduleRule", autoScheduleRuleSchema);
