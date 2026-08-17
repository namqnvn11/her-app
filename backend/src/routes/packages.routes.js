const express = require("express");
const mongoose = require("mongoose");
const User = require("../models/User");
const Package = require("../models/Package");
const { requireAuth, requireManagement } = require("../middleware/auth");
const { PAYMENT_METHODS } = require("../utils/serviceTypes");
const { isValidPackageType } = require("../utils/disciplines");
const { serializePackage } = require("../utils/packages");
const wrap = require("../utils/asyncHandler");

const router = express.Router();
// Quyết định 12/08/2026 (Q2): admin VÀ lễ tân đều được tạo/tra cứu gói của học viên.
// Gia hạn = tạo thêm gói mới cho cùng khách (không sửa gói cũ).
// Thanh toán/bảo lưu (Q10/Q11 16/08): cũng chỉ quầy thao tác.
router.use(requireAuth, requireManagement);

// Học viên đích phải tồn tại và đúng role customer (không tạo gói cho HLV/lễ tân)
async function findCustomerOr404(userId, res) {
  if (!mongoose.isValidObjectId(userId)) {
    res.status(400).json({ error: "Mã (ID) không hợp lệ" });
    return null;
  }
  const customer = await User.findById(userId);
  if (!customer || customer.role !== "customer") {
    res.status(404).json({ error: "Không tìm thấy học viên" });
    return null;
  }
  return customer;
}

// POST /api/packages  { userId, name, serviceType, price, totalSessions?, expiresAt? | durationDays?,
//                       paymentMethod?, paidAmount? }
// 3 kiểu gói (Q3): chỉ buổi / chỉ thời hạn / cả hai — ít nhất 1 trong 2 (H7).
// paidAmount bỏ trống = thu đủ; paidAmount < price = còn nợ, KHÔNG chặn đặt lịch (Q10).
router.post("/", wrap(async (req, res) => {
  const { userId, name, serviceType, price, totalSessions, durationDays, expiresAt: expiresAtRaw, paymentMethod, paidAmount } = req.body;

  const customer = await findCustomerOr404(userId, res);
  if (!customer) return;

  if (!name || typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "Thiếu tên gói" });
  }
  if (name.trim().length > 200) {
    return res.status(400).json({ error: "Tên gói tối đa 200 ký tự" });
  }
  if (!(await isValidPackageType(serviceType))) {
    return res.status(400).json({ error: "Loại hình phải là gym, pilates, yoga hoặc pt" });
  }
  // Giá VND: số nguyên không âm, cap 1 tỷ đồng/gói để chặn số rác kiểu 1e308
  if (!Number.isInteger(price) || price < 0 || price > 1_000_000_000) {
    return res.status(400).json({ error: "Giá gói phải là số nguyên (đồng), tối đa 1 tỷ" });
  }
  const hasSessions = totalSessions !== undefined && totalSessions !== null;
  // her-19: app gửi NGÀY HẾT HẠN chọn từ lịch (expiresAt); durationDays giữ để tương thích cũ
  const hasExpiresAt = expiresAtRaw !== undefined && expiresAtRaw !== null && expiresAtRaw !== "";
  const hasDuration = !hasExpiresAt && durationDays !== undefined && durationDays !== null;
  if (!hasSessions && !hasDuration && !hasExpiresAt) {
    return res.status(400).json({ error: "Gói phải có số buổi hoặc ngày hết hạn (hoặc cả hai)" });
  }
  if (hasSessions && (!Number.isInteger(totalSessions) || totalSessions < 1)) {
    return res.status(400).json({ error: "Số buổi phải là số nguyên dương" });
  }
  if (hasDuration && (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 3650)) {
    return res.status(400).json({ error: "Thời hạn (số ngày) phải là số nguyên dương, tối đa 10 năm" });
  }
  let pickedExpiry = null;
  if (hasExpiresAt) {
    pickedExpiry = new Date(expiresAtRaw);
    if (isNaN(pickedExpiry.getTime())) {
      return res.status(400).json({ error: "Ngày hết hạn không hợp lệ" });
    }
    // Hết hạn = HẾT ngày được chọn (khách chọn 30/09 thì tập được trọn ngày 30/09)
    pickedExpiry.setHours(23, 59, 59, 999);
    if (pickedExpiry <= new Date()) {
      return res.status(400).json({ error: "Ngày hết hạn phải ở tương lai" });
    }
    if (pickedExpiry > new Date(Date.now() + 3650 * 24 * 3600 * 1000)) {
      return res.status(400).json({ error: "Ngày hết hạn tối đa 10 năm" });
    }
  }
  const method = paymentMethod === undefined ? "cash" : paymentMethod;
  if (!PAYMENT_METHODS.includes(method)) {
    return res.status(400).json({ error: "Hình thức thanh toán phải là tiền mặt (cash) hoặc chuyển khoản (transfer)" });
  }
  // paidAmount bỏ trống = đã thu đủ
  const paid = paidAmount === undefined || paidAmount === null ? price : paidAmount;
  if (!Number.isInteger(paid) || paid < 0) {
    return res.status(400).json({ error: "Số tiền đã thu phải là số nguyên (đồng)" });
  }
  if (paid > price) {
    return res.status(400).json({ error: "Số tiền đã thu không được lớn hơn giá gói" });
  }

  const activatedAt = new Date();
  const expiresAt = hasExpiresAt ? pickedExpiry : hasDuration ? new Date(activatedAt.getTime() + durationDays * 24 * 3600 * 1000) : null;
  const pkg = await Package.create({
    userId: customer._id,
    name: name.trim(),
    serviceType,
    price,
    totalSessions: hasSessions ? totalSessions : null,
    activatedAt,
    expiresAt,
    paymentMethod: method,
    paidAmount: paid,
    // Nhật ký thu tiền (her-13): dòng đầu = số thu ngay lúc bán (nếu có)
    payments: paid > 0 ? [{ amount: paid, at: activatedAt, by: req.user._id }] : [],
  });
  res.status(201).json({ package: serializePackage(pkg) });
}));

// GET /api/packages/customer/:userId — toàn bộ gói (đang dùng + hết hạn) để tra cứu tại quầy
router.get("/customer/:userId", wrap(async (req, res) => {
  const customer = await findCustomerOr404(req.params.userId, res);
  if (!customer) return;
  const packages = await Package.find({ userId: customer._id }).sort({ createdAt: -1 });
  res.json({ packages: packages.map(serializePackage) });
}));

// Tìm gói theo :id — id rác 400, không có 404 (dùng chung cho pay/pause/resume)
async function findPackageOr404(id, res) {
  if (!mongoose.isValidObjectId(id)) {
    res.status(400).json({ error: "Mã (ID) không hợp lệ" });
    return null;
  }
  const pkg = await Package.findById(id);
  if (!pkg) {
    res.status(404).json({ error: "Không tìm thấy gói" });
    return null;
  }
  return pkg;
}

// PATCH /api/packages/:id/pay { amount } — thu thêm tiền nợ, cộng dồn atomic.
// Chặn thu quá số nợ còn lại ngay trong điều kiện update (không read-modify-write — C3).
router.patch("/:id/pay", wrap(async (req, res) => {
  const pkg = await findPackageOr404(req.params.id, res);
  if (!pkg) return;
  const { amount } = req.body;
  if (!Number.isInteger(amount) || amount <= 0) {
    return res.status(400).json({ error: "Số tiền thu thêm phải là số nguyên dương (đồng)" });
  }
  // Gói cũ (trước đợt thanh toán) không lưu paidAmount — coi là đã thu đủ, nói đúng lý do (C6)
  if (pkg.paidAmount == null) {
    return res.status(400).json({ error: "Gói này (bán trước đợt thanh toán) được coi là đã thu đủ — không còn nợ để thu" });
  }
  const updated = await Package.findOneAndUpdate(
    {
      _id: pkg._id,
      // paidAmount null = gói cũ coi như đã thu đủ -> không còn nợ để thu
      paidAmount: { $ne: null },
      $expr: { $lte: [{ $add: ["$paidAmount", amount] }, "$price"] },
    },
    { $inc: { paidAmount: amount }, $push: { payments: { amount, at: new Date(), by: req.user._id } } },
    { new: true }
  );
  if (!updated) {
    return res.status(400).json({ error: "Số tiền thu vượt quá số nợ còn lại của gói" });
  }
  res.json({ package: serializePackage(updated) });
}));

// PATCH /api/packages/:id/pause — bảo lưu (Q11): chỉ gói CÓ thời hạn, còn hạn, chưa bảo lưu
router.patch("/:id/pause", wrap(async (req, res) => {
  const pkg = await findPackageOr404(req.params.id, res);
  if (!pkg) return;
  if (pkg.expiresAt == null) {
    return res.status(400).json({ error: "Gói không thời hạn thì không cần bảo lưu" });
  }
  if (pkg.pausedAt != null) {
    return res.status(400).json({ error: "Gói này đang bảo lưu rồi" });
  }
  if (pkg.expiresAt < new Date()) {
    return res.status(400).json({ error: "Gói đã hết hạn, không bảo lưu được" });
  }
  const updated = await Package.findOneAndUpdate(
    { _id: pkg._id, pausedAt: null, expiresAt: { $gte: new Date() } },
    { $set: { pausedAt: new Date() } },
    { new: true }
  );
  if (!updated) return res.status(400).json({ error: "Gói này đang bảo lưu rồi" });
  res.json({ package: serializePackage(updated) });
}));

// PATCH /api/packages/:id/resume — mở bảo lưu: cộng bù thời hạn đúng khoảng đã ngưng (Q11).
// Update dạng pipeline để tính expiresAt mới từ chính document — atomic, không đọc-rồi-ghi.
router.patch("/:id/resume", wrap(async (req, res) => {
  const pkg = await findPackageOr404(req.params.id, res);
  if (!pkg) return;
  if (pkg.pausedAt == null) {
    return res.status(400).json({ error: "Gói này không ở trạng thái bảo lưu" });
  }
  const now = new Date();
  const updated = await Package.findOneAndUpdate(
    { _id: pkg._id, pausedAt: { $ne: null } },
    [
      {
        $set: {
          expiresAt: { $add: ["$expiresAt", { $subtract: [now, "$pausedAt"] }] },
          pausedAt: null,
        },
      },
    ],
    { new: true }
  );
  if (!updated) return res.status(400).json({ error: "Gói này không ở trạng thái bảo lưu" });
  res.json({ package: serializePackage(updated) });
}));

module.exports = router;
