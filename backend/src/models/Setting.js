const mongoose = require("mongoose");

// her-47 (23/08/2026): CÀI ĐẶT PHÒNG TẬP do admin chỉnh trong app — 1 document duy nhất
// (key "studio"). Field nào chưa có trong document thì dùng mặc định từ env/code
// (xem utils/cancelRule.js) — env giờ chỉ là giá trị ban đầu, không còn là nguồn duy nhất.

// Ngưỡng trên số giờ hủy — 1 hằng duy nhất, route và schema cùng đọc (review her-47 #5)
const MAX_CANCEL_HOURS = 72;

const settingSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, default: "studio" },
    // Số giờ tối thiểu trước giờ tập để KHÁCH tự hủy (H1). Quầy hủy hộ không bị giới hạn.
    minCancelHours: { type: Number, min: 0, max: MAX_CANCEL_HOURS },
  },
  { timestamps: true }
);

const Setting = mongoose.model("Setting", settingSchema);
Setting.MAX_CANCEL_HOURS = MAX_CANCEL_HOURS;
module.exports = Setting;
