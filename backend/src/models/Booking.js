const mongoose = require("mongoose");
const { FORMATS } = require("../utils/formats");

const bookingSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    classId: { type: mongoose.Schema.Types.ObjectId, ref: "GymClass", required: true },
    trainerId: { type: mongoose.Schema.Types.ObjectId, ref: "Trainer", required: true },
    title: { type: String, required: true }, // tên hiển thị, snapshot lúc đặt
    // her-35: snapshot bộ môn + loại hình lúc đặt — payroll/lịch sử đọc thẳng,
    // không join lớp, không so chuỗi title
    serviceType: { type: String, required: true },
    format: { type: String, enum: FORMATS, required: true },
    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true },
    status: {
      type: String,
      enum: ["booked", "cancelled", "completed", "no_show"],
      default: "booked",
    },
    cancelledAt: { type: Date, default: null },
    cancelledBy: { type: String, enum: ["customer", "staff", null], default: null },
    // Điểm danh (her-10, mục 5): null = CHƯA điểm danh thật. Buổi bị sweep tự hoàn tất
    // vẫn null — hoa hồng HLV (mục 7) chỉ tính buổi có attendanceAt (khách đến thật).
    attendanceAt: { type: Date, default: null },
    attendanceBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    // Gói tập đã bị trừ buổi lúc đặt — hủy lịch hoàn buổi về ĐÚNG gói này,
    // không đoán "gói mới nhất" (null = booking cũ trước khi có trường này, hoặc seed lịch sử)
    packageId: { type: mongoose.Schema.Types.ObjectId, ref: "Package", default: null },
  },
  { timestamps: true }
);

// Chốt chặn bấm đúp ở tầng DB (C3): 1 khách 1 booking "booked"/lớp.
// LƯU Ý DEPLOY: DB không reseed phải drop 2 unique index cũ bằng tay
// (bản {userId,classId} có partial type:"group" và bản {userId,slotId} type:"pt").
bookingSchema.index(
  { userId: 1, classId: 1 },
  { unique: true, partialFilterExpression: { status: "booked" } }
);

// Index thứ cấp cho các query nóng (lịch của tôi, danh sách quản lý, roster, sweep)
bookingSchema.index({ userId: 1, status: 1, startAt: 1 });
bookingSchema.index({ trainerId: 1, status: 1, startAt: 1 });
bookingSchema.index({ classId: 1, status: 1 });
bookingSchema.index({ status: 1, endAt: 1 });

module.exports = mongoose.model("Booking", bookingSchema);
