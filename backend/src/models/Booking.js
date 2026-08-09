const mongoose = require("mongoose");

const bookingSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    type: { type: String, enum: ["group", "pt"], required: true },
    classId: { type: mongoose.Schema.Types.ObjectId, ref: "GymClass", default: null },
    slotId: { type: mongoose.Schema.Types.ObjectId, ref: "PTSlot", default: null },
    trainerId: { type: mongoose.Schema.Types.ObjectId, ref: "Trainer", required: true },
    title: { type: String, required: true }, // tên hiển thị, snapshot lúc đặt
    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true },
    status: {
      type: String,
      enum: ["booked", "cancelled", "completed", "no_show"],
      default: "booked",
    },
    cancelledAt: { type: Date, default: null },
    cancelledBy: { type: String, enum: ["customer", "staff", null], default: null },
    // Gói tập đã bị trừ buổi lúc đặt — hủy lịch hoàn buổi về ĐÚNG gói này,
    // không đoán "gói mới nhất" (null = booking cũ trước khi có trường này, hoặc seed lịch sử)
    packageId: { type: mongoose.Schema.Types.ObjectId, ref: "Package", default: null },
  },
  { timestamps: true }
);

// Chốt chặn bấm đúp/đặt trùng ở tầng DB: mỗi khách chỉ có 1 booking "booked" cho
// 1 lớp (hoặc 1 PT slot). Câu findOne kiểm tra trước chỉ để báo lỗi thân thiện —
// 2 request song song cùng lọt qua kiểm tra thì unique index này chặn request thứ hai.
bookingSchema.index(
  { userId: 1, classId: 1 },
  { unique: true, partialFilterExpression: { status: "booked", type: "group" } }
);
bookingSchema.index(
  { userId: 1, slotId: 1 },
  { unique: true, partialFilterExpression: { status: "booked", type: "pt" } }
);

// Index thứ cấp cho các query nóng (lịch của tôi, danh sách quản lý, roster, sweep)
bookingSchema.index({ userId: 1, status: 1, startAt: 1 });
bookingSchema.index({ trainerId: 1, status: 1, startAt: 1 });
bookingSchema.index({ classId: 1, status: 1 });
bookingSchema.index({ status: 1, endAt: 1 });

module.exports = mongoose.model("Booking", bookingSchema);
