const mongoose = require("mongoose");
const { PAYMENT_METHODS } = require("../utils/serviceTypes");
const { FORMATS, packageShapeError } = require("../utils/formats");

const packageSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    name: { type: String, required: true }, // "Pilates 24 buổi — 3 tháng"
    // her-35: gói MIX — mảng bộ môn (≥1, thuộc danh mục, validate ở route) + 1 loại hình.
    // Gói buổi: format 1:1/1:2/1:4, môn nào cũng được. Gói thời hạn (totalSessions null):
    // chỉ ["yoga"] + "1:8" (chốt 19/08 theo chat khách).
    serviceTypes: { type: [String], required: true },
    format: { type: String, enum: FORMATS, required: true },
    price: { type: Number, required: true, min: 0 },
    // 3 kiểu gói (Q3): chỉ buổi (expiresAt null) / chỉ thời hạn (totalSessions null =
    // không giới hạn buổi) / buổi + thời hạn. Không được null cả hai (validate dưới).
    totalSessions: { type: Number, default: null, min: 1 },
    usedSessions: { type: Number, default: 0 },
    activatedAt: { type: Date, required: true },
    expiresAt: { type: Date, default: null },
    // Thanh toán khi bán gói (14/08): paidAmount null = gói cũ trước đợt này, coi là đã thu đủ.
    // paidAmount < price = còn nợ — KHÔNG chặn đặt lịch (Q10), chỉ để quầy đối soát/nhắc thu.
    paymentMethod: { type: String, enum: PAYMENT_METHODS, default: "cash" },
    paidAmount: { type: Number, default: null, min: 0 },
    // Bảo lưu (Q11): pausedAt != null = đang tạm ngưng — không dùng để đặt lịch;
    // mở lại thì expiresAt được cộng bù đúng khoảng thời gian đã ngưng.
    pausedAt: { type: Date, default: null },
    // Nhật ký thu tiền (her-13, review N1): mỗi lần thu (lúc bán + mỗi lần thu nợ) 1 dòng —
    // doanh thu tháng của báo cáo = tổng tiền THU TRONG THÁNG, nợ thu muộn không "bốc hơi".
    // Gói cũ không có mảng này -> báo cáo fallback theo paidAmount + createdAt như trước.
    payments: {
      type: [
        {
          amount: { type: Number, required: true, min: 1 },
          at: { type: Date, required: true },
          by: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
        },
      ],
      default: [],
    },
  },
  { timestamps: true }
);

packageSchema.pre("validate", function (next) {
  if (this.totalSessions == null && this.expiresAt == null) {
    return next(new Error("Gói phải có số buổi hoặc thời hạn (hoặc cả hai)"));
  }
  // Luật hình dạng gói dùng CHUNG với route bán gói — 1 nguồn duy nhất (C5)
  const err = packageShapeError({
    format: this.format,
    serviceTypes: this.serviceTypes,
    hasSessions: this.totalSessions != null,
  });
  if (err) return next(new Error(err));
  next();
});

// Query chọn gói khi đặt lịch: user + loại hình + hạn dùng; bộ môn match phần tử mảng serviceTypes
packageSchema.index({ userId: 1, format: 1, expiresAt: 1 });

module.exports = mongoose.model("Package", packageSchema);
