const mongoose = require("mongoose");

// her-19: DANH MỤC BỘ MÔN nằm trong DB (góp ý 16/08) — thêm môn mới chỉ cần thêm 1 document
// là mọi chỗ chọn bộ môn (tạo buổi, chuyên môn HLV, bán gói) tự hiển thị.
// her-35 (19/08): không còn loại buổi/loại gói "pt" — mọi buổi đều là bộ môn trong danh mục
// này + loại hình 1:1/1:2/1:4/1:8 (xem utils/formats.js). "PT" từ nay chỉ nghĩa là huấn luyện
// viên nói chung, không phải một bộ môn hay một loại gói.
const disciplineSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, trim: true, lowercase: true },
    label: { type: String, required: true, trim: true },
    order: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Discipline", disciplineSchema);
