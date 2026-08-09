const Booking = require("../models/Booking");

// Lỗi L6: buổi tập đã qua giờ vẫn mang nhãn "Đã đặt" mãi mãi.
// Job này chuyển các booking "booked" có endAt đã qua thành "completed".
// Chạy 1 lần lúc server khởi động + định kỳ mỗi COMPLETE_SWEEP_MINUTES phút (mặc định 5).
//
// Hạn chế đã chấp nhận (ghi trong testcase doc her-03): chưa phân biệt được khách có đến
// tập thật hay không ("no_show" cần tính năng điểm danh — giai đoạn sau); hosting free-tier
// "ngủ" thì job chỉ chạy khi server được đánh thức (đã có sweep lúc boot bù lại).
async function sweepCompletedBookings() {
  const result = await Booking.updateMany(
    { status: "booked", endAt: { $lt: new Date() } },
    { $set: { status: "completed" } }
  );
  if (result.modifiedCount > 0) {
    console.log(`[complete-sweep] Đã chuyển ${result.modifiedCount} buổi qua giờ thành "Đã tập"`);
  }
  return result.modifiedCount;
}

function startCompleteSweep() {
  // Kẹp về [1, 1440] phút — env sai kiểu/0/âm không được phép biến thành vòng lặp dội DB
  const raw = Number(process.env.COMPLETE_SWEEP_MINUTES);
  const minutes = Number.isFinite(raw) && raw >= 1 ? Math.min(raw, 1440) : 5;
  // Chạy ngay 1 lần lúc boot, sau đó lặp định kỳ. Lỗi DB thoáng qua chỉ log, lượt sau tự bù.
  sweepCompletedBookings().catch((err) => console.error("[complete-sweep] lỗi:", err.message));
  const timer = setInterval(() => {
    sweepCompletedBookings().catch((err) => console.error("[complete-sweep] lỗi:", err.message));
  }, minutes * 60 * 1000);
  timer.unref(); // không giữ tiến trình sống chỉ vì timer
  return timer;
}

module.exports = { sweepCompletedBookings, startCompleteSweep };
