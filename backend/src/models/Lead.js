const mongoose = require("mongoose");

// her-48 (24/08/2026): KHÁCH QUAN TÂM từ form "đặt lịch hẹn tư vấn" trên trang web
// her-pilates.com. Không phải tài khoản — chỉ là lời nhắn chờ quầy gọi lại.
// Vòng đời: new (mới) -> contacted (đã gọi) -> done (xong). Web quản lý sau này đọc qua GET /api/leads.
const leadSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    phone: { type: String, required: true, trim: true },
    interest: { type: String, default: null }, // bộ môn quan tâm — key trong danh mục hoặc "khac"
    note: { type: String, default: "", maxlength: 500 },
    status: { type: String, enum: ["new", "contacted", "done"], default: "new" },
    handledBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    handledByName: { type: String, default: null }, // chụp tên lúc xử lý — web hiển thị không cần join
    handledAt: { type: Date, default: null },
    sourceIp: { type: String, default: null }, // phục vụ chống spam/truy vết
  },
  { timestamps: true }
);
leadSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model("Lead", leadSchema);
