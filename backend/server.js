require("dotenv").config();
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const connectDB = require("./src/config/db");
const Booking = require("./src/models/Booking");
const User = require("./src/models/User");
const { startCompleteSweep } = require("./src/utils/completeSweep");

const authRoutes = require("./src/routes/auth.routes");
const meRoutes = require("./src/routes/me.routes");
const classesRoutes = require("./src/routes/classes.routes");
const trainersRoutes = require("./src/routes/trainers.routes");
const bookingsRoutes = require("./src/routes/bookings.routes");
const managementRoutes = require("./src/routes/management.routes");
const scheduleRoutes = require("./src/routes/schedule.routes");
const accountsRoutes = require("./src/routes/accounts.routes");
const packagesRoutes = require("./src/routes/packages.routes");
const payrollRoutes = require("./src/routes/payroll.routes");
const dashboardRoutes = require("./src/routes/dashboard.routes");
const disciplinesRoutes = require("./src/routes/disciplines.routes");
const autoScheduleRoutes = require("./src/routes/autoSchedule.routes");
const settingsRoutes = require("./src/routes/settings.routes");
const leadsRoutes = require("./src/routes/leads.routes");

const app = express();
app.use(cors());
app.use(express.json());
app.use(morgan("dev"));

app.get("/api/health", (req, res) => res.json({ ok: true, service: "her-app-backend" }));

app.use("/api/auth", authRoutes);
app.use("/api/me", meRoutes);
app.use("/api/classes", classesRoutes);
app.use("/api/trainers", trainersRoutes);
app.use("/api/bookings", bookingsRoutes);
app.use("/api/management", managementRoutes);
app.use("/api/schedule", scheduleRoutes);
app.use("/api/accounts", accountsRoutes);
app.use("/api/packages", packagesRoutes);
app.use("/api/payroll", payrollRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/disciplines", disciplinesRoutes);
app.use("/api/auto-schedule", autoScheduleRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/leads", leadsRoutes);

app.use((req, res) => res.status(404).json({ error: "Không tìm thấy đường dẫn API" }));

// Error middleware — nhận lỗi từ mọi route async (đã bọc wrap trong src/utils/asyncHandler.js).
// Phân loại lỗi dữ liệu (trả 4xx nói rõ lý do) và lỗi hệ thống (500 + log) — không nuốt lỗi im lặng.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  // Lỗi của express.json(): body không phải JSON hợp lệ / quá lớn — là lỗi phía client (4xx)
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Dữ liệu gửi lên không đúng định dạng JSON" });
  }
  if (err.type === "entity.too.large") {
    return res.status(413).json({ error: "Dữ liệu gửi lên quá lớn" });
  }
  if (err.name === "CastError") {
    // Cast fail có thể ở :id (thường gặp) hoặc field dữ liệu khác — message tách riêng cho đúng
    return res.status(400).json({
      error: err.path === "_id" ? "Mã (ID) không hợp lệ" : "Dữ liệu không đúng định dạng",
    });
  }
  if (err.name === "ValidationError") {
    return res.status(400).json({ error: "Dữ liệu không hợp lệ, kiểm tra lại thông tin nhập" });
  }
  if (err.code === 11000) {
    return res.status(409).json({ error: "Thao tác bị trùng, có thể đã được thực hiện rồi" });
  }
  console.error(err);
  res.status(500).json({ error: "Lỗi hệ thống, vui lòng thử lại sau" });
});

// Lưới an toàn cuối: nếu vẫn còn promise nào bị bỏ sót, log lại thay vì để tiến trình chết
process.on("unhandledRejection", (err) => {
  console.error("[unhandledRejection]", err);
});

const PORT = process.env.PORT || 4000;

// Fail-fast lúc khởi động thay vì crash ở request đăng nhập đầu tiên
if (!process.env.JWT_SECRET) {
  console.error("Thiếu JWT_SECRET trong file .env — xem .env.example");
  process.exit(1);
}
// JWT_EXPIRES_IN cấu hình rác sẽ làm jwt.sign throw ở lần login đầu — bắt ngay lúc boot
try {
  require("jsonwebtoken").sign({ boot: 1 }, process.env.JWT_SECRET, {
    expiresIn: require("./src/utils/token").EXPIRES_IN,
  });
} catch (err) {
  console.error(`JWT_EXPIRES_IN không hợp lệ ("${process.env.JWT_EXPIRES_IN}") — dùng dạng "30d", "12h"...`);
  process.exit(1);
}

connectDB()
  .then(async () => {
    // Unique index chống đặt trùng (models/Booking.js) phải TỒN TẠI thật trước khi nhận
    // request — nếu build fail (vd DB cũ còn cặp booking trùng do lỗi race trước đây) thì
    // dừng hẳn và báo rõ, không chạy tiếp với chốt chặn không tồn tại.
    try {
      await Booking.syncIndexes();
      await User.syncIndexes(); // unique phone — quan trọng ngang index chống đặt trùng
    } catch (err) {
      console.error(
        "Không build được unique index (chống đặt trùng / SĐT trùng) — DB có thể còn dữ liệu trùng từ bản cũ, cần dọn trước khi chạy:",
        err.message
      );
      process.exit(1);
    }
    // Unique (ruleId, dateKey) là KHOÁ chống lịch-tự-động sinh đúp — phải tồn tại thật (C3)
    await require("./src/models/AutoScheduleLog").syncIndexes();
    // Nạp sẵn danh mục bộ môn vào cache (her-19) — serializePackage cần bản sync
    await require("./src/utils/disciplines").allDisciplines();
    // Job nền: tự chuyển buổi đã qua giờ thành "Đã tập" (lỗi L6)
    startCompleteSweep();
    // Job nền: sinh lịch tự động — phủ trước 7 ngày cho các luật đang bật (her-32)
    require("./src/utils/autoSchedule").startAutoSchedule();
    app.listen(PORT, () => console.log(`[server] Đang chạy tại http://localhost:${PORT}`));
  })
  .catch((err) => {
    console.error("Không thể kết nối MongoDB:", err.message);
    process.exit(1);
  });
