const mongoose = require("mongoose");

// her-32: SỔ GHI mỗi (luật, ngày) đã sinh buổi — "chỉ tạo, không kiểm tra rồi tạo lại":
// buổi sinh xong là độc lập (admin sửa/xoá tuỳ ý), sổ còn thì không bao giờ sinh lại.
const autoScheduleLogSchema = new mongoose.Schema(
  {
    ruleId: { type: mongoose.Schema.Types.ObjectId, ref: "AutoScheduleRule", required: true },
    dateKey: { type: String, required: true }, // "YYYY-MM-DD" theo giờ máy (VN)
  },
  { timestamps: true }
);
autoScheduleLogSchema.index({ ruleId: 1, dateKey: 1 }, { unique: true });

module.exports = mongoose.model("AutoScheduleLog", autoScheduleLogSchema);
