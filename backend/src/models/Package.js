const mongoose = require("mongoose");

const packageSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    name: { type: String, required: true }, // "Pilates Unlimited 3T"
    price: { type: Number, required: true },
    totalSessions: { type: Number, required: true },
    usedSessions: { type: Number, default: 0 },
    activatedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

// Query chọn gói khi đặt lịch: theo user + hạn dùng
packageSchema.index({ userId: 1, expiresAt: -1 });

module.exports = mongoose.model("Package", packageSchema);
