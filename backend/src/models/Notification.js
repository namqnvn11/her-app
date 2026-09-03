const mongoose = require("mongoose");

// her-57 (03/09/2026): THÔNG BÁO cho admin / lễ tân / HLV khi khách đặt hoặc hủy lịch.
// Mỗi người nhận 1 document (đọc/chưa đọc riêng). Nguồn sự thật cho "chuông" trong app;
// push lên máy (Expo Push) chỉ là kênh báo thêm — mất push thì mở app vẫn thấy đủ.
const notificationSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }, // người NHẬN
    type: { type: String, enum: ["booking_created", "booking_cancelled"], required: true },
    title: { type: String, required: true },
    body: { type: String, required: true },
    // Dữ liệu kèm để app mở đúng chỗ sau này (chưa dùng để điều hướng — đợt sau)
    data: {
      bookingId: { type: mongoose.Schema.Types.ObjectId, ref: "Booking", default: null },
      classId: { type: mongoose.Schema.Types.ObjectId, ref: "GymClass", default: null },
      customerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    },
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null }, // ai gây ra sự kiện
    readAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Danh sách của tôi (mới nhất trước) + đếm chưa đọc
notificationSchema.index({ userId: 1, createdAt: -1, _id: -1 }); // phủ đúng sort của danh sách (review #6)
notificationSchema.index({ userId: 1, readAt: 1 });

module.exports = mongoose.model("Notification", notificationSchema);
