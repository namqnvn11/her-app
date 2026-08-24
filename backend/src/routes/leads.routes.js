const express = require("express");
const Lead = require("../models/Lead");
const { requireAuth, requireManagement } = require("../middleware/auth");
const wrap = require("../utils/asyncHandler");

// her-48: form "đặt lịch hẹn tư vấn" trên web công khai -> POST không cần đăng nhập
// (validate chặt + rate-limit theo IP + honeypot); đọc/đổi trạng thái: chỉ quầy + admin (H5).
const router = express.Router();

const INTERESTS = ["pilates", "yoga", "gym", "boxing", "stretching", "khac"];
const STATUSES = ["new", "contacted", "done"];

// Rate-limit trong RAM theo IP — mềm thôi (chủ dự án 24/08): tối đa LEAD_MAX_PER_WINDOW
// lượt trong LEAD_WINDOW_MINUTES phút (mặc định 5 lượt / 5 phút) — chặn xong ~5 phút sau gửi lại được.
// Spam nặng đã có thêm honeypot + không tạo đúp theo SĐT đang chờ.
const MAX_PER_WINDOW = Number(process.env.LEAD_MAX_PER_WINDOW || 5);
const WINDOW_MS = Number(process.env.LEAD_WINDOW_MINUTES || 5) * 60 * 1000;
const hits = new Map(); // ip -> [timestamps]
function overLimit(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (arr.length >= MAX_PER_WINDOW) { hits.set(ip, arr); return true; }
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > 5000) { // không cho map phình vô hạn
    for (const [k, v] of hits) if (!v.some((t) => now - t < WINDOW_MS)) hits.delete(k);
  }
  return false;
}
const clientIp = (req) => req.headers["x-real-ip"] || req.ip || "unknown";

// POST /api/leads  { name, phone, interest?, note?, website? } — công khai (form trang chủ)
router.post("/", wrap(async (req, res) => {
  const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
  const { name, phone, interest, note, website } = body;

  // Honeypot: ô "website" ẩn trên form — người thật không thấy, bot điền vào.
  // Trả 201 GIẢ để bot tưởng thành công, không lưu gì.
  if (typeof website === "string" && website.trim() !== "") {
    return res.status(201).json({ message: "Đã nhận thông tin" });
  }

  // Form nhanh trên web chỉ có SĐT — tên được phép thiếu (her-48b, mẫu Editorial)
  if (name !== undefined && name !== null && (typeof name !== "string" || name.trim().length > 100)) {
    return res.status(400).json({ error: "Họ tên tối đa 100 ký tự" });
  }
  const leadName = typeof name === "string" && name.trim() ? name.trim() : "Khách để lại SĐT";
  if (typeof phone !== "string" || !/^0\d{9}$/.test(phone.trim())) {
    return res.status(400).json({ error: "Số điện thoại phải gồm 10 số, bắt đầu bằng 0" });
  }
  if (interest !== undefined && interest !== null && !INTERESTS.includes(interest)) {
    return res.status(400).json({ error: "Bộ môn quan tâm không hợp lệ" });
  }
  if (note !== undefined && (typeof note !== "string" || note.length > 500)) {
    return res.status(400).json({ error: "Ghi chú tối đa 500 ký tự" });
  }

  const ip = clientIp(req);
  if (overLimit(ip)) {
    return res.status(429).json({ error: "Bạn gửi hơi nhanh — chờ khoảng 5 phút rồi gửi lại, hoặc gọi 070 308 9980 nhé" });
  }

  // Cùng SĐT đang chờ gọi thì không tạo bản ghi đúp — báo nhẹ nhàng là đã nhận rồi
  const pending = await Lead.findOne({ phone: phone.trim(), status: "new" });
  if (pending) {
    return res.status(200).json({ message: "HER đã nhận thông tin của bạn rồi — sẽ gọi lại sớm nhất!" });
  }

  await Lead.create({ name: leadName, phone: phone.trim(), interest: interest || null, note: (note || "").trim(), sourceIp: ip });
  res.status(201).json({ message: "Đã nhận thông tin — HER sẽ gọi lại cho bạn sớm nhất!" });
}));

// Từ đây trở xuống: chỉ quầy + admin (dành cho web quản lý sau này)
router.use(requireAuth, requireManagement);

// GET /api/leads?status=new|contacted|done
router.get("/", wrap(async (req, res) => {
  const { status } = req.query;
  if (status !== undefined && !STATUSES.includes(status)) {
    return res.status(400).json({ error: "Trạng thái lọc không hợp lệ" });
  }
  const leads = await Lead.find(status ? { status } : {}).sort({ createdAt: -1 }).limit(200).lean();
  res.json({
    leads: leads.map((l) => ({
      id: l._id, name: l.name, phone: l.phone, interest: l.interest, note: l.note,
      status: l.status, createdAt: l.createdAt, handledAt: l.handledAt, handledByName: l.handledByName,
    })),
  });
}));

// PATCH /api/leads/:id  { status }
router.patch("/:id", wrap(async (req, res) => {
  const { status } = req.body || {};
  if (!STATUSES.includes(status)) {
    return res.status(400).json({ error: "Trạng thái phải là new / contacted / done" });
  }
  const lead = await Lead.findByIdAndUpdate(
    req.params.id,
    { $set: { status, handledBy: req.user._id, handledByName: req.user.name, handledAt: new Date() } },
    { new: true }
  );
  if (!lead) return res.status(404).json({ error: "Không tìm thấy khách hẹn này" });
  res.json({ lead: { id: lead._id, status: lead.status } });
}));

module.exports = router;
