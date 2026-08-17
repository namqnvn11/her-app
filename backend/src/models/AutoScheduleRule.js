const mongoose = require("mongoose");

// her-32: LUẬT lịch tự động — mỗi luật sinh lớp group lặp theo các THỨ trong tuần,
// luôn phủ trước 7 ngày (tầm thấy của học viên ở màn Đặt lịch)
const autoScheduleRuleSchema = new mongoose.Schema(
  {
    serviceType: { type: String, required: true, lowercase: true, trim: true },
    name: { type: String, required: true }, // nhãn bộ môn tại thời điểm tạo luật (tên lớp sinh ra)
    coachId: { type: mongoose.Schema.Types.ObjectId, ref: "Trainer", required: true },
    hour: { type: Number, required: true, min: 0, max: 23 },
    minute: { type: Number, required: true, min: 0, max: 59 },
    daysOfWeek: { type: [Number], required: true }, // 0 = CN ... 6 = T7
    capacity: { type: Number, required: true, min: 1, max: 100 },
    active: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("AutoScheduleRule", autoScheduleRuleSchema);
