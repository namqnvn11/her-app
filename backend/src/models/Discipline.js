const mongoose = require("mongoose");

// her-19: DANH MỤC BỘ MÔN nằm trong DB (góp ý 16/08) — thêm môn mới chỉ cần thêm 1 document
// là mọi chỗ chọn bộ môn (tạo lớp, chuyên môn HLV, bán gói) tự hiển thị. "pt" KHÔNG nằm ở
// đây: PT là hình thức kèm riêng, mọi HLV đều dạy được, gói PT là loại gói cố định.
const disciplineSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, trim: true, lowercase: true },
    label: { type: String, required: true, trim: true },
    order: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Discipline", disciplineSchema);
