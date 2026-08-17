const express = require("express");
const mongoose = require("mongoose");
const Trainer = require("../models/Trainer");
const TrainerRate = require("../models/TrainerRate");
const { requireAuth, requireRole } = require("../middleware/auth");
const { computeMonth, monthRange } = require("../utils/payroll");
const wrap = require("../utils/asyncHandler");

const router = express.Router();
router.use(requireAuth);

// Quyền (H5 — mục 7): CHỈ admin thiết lập/xem tất cả/chốt; HLV (kể cả admin kiêm HLV)
// xem CỦA MÌNH qua /my; LỄ TÂN KHÔNG truy cập được bất kỳ endpoint nào (403).
const adminOnly = requireRole("admin");

const MAX_VND = 1_000_000_000; // trần 1 tỷ như giá gói (her-05) — chặn gõ nhầm số

function parseAmount(value, label) {
  if (value === undefined) return { value: 0 };
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > MAX_VND) {
    return { error: `${label} phải là số nguyên VND từ 0 đến 1 tỷ` };
  }
  return { value: n };
}

// GET /api/payroll/settings — danh sách HLV + mức hiện hành
router.get("/settings", adminOnly, wrap(async (req, res) => {
  const trainers = await Trainer.find({}).sort({ name: 1 });
  const rates = await TrainerRate.find({ effectiveFrom: { $lte: new Date() } }).sort({ effectiveFrom: 1 });
  const currentByTrainer = {};
  for (const r of rates) currentByTrainer[r.trainerId.toString()] = r; // sort tăng -> bản cuối thắng
  res.json({
    trainers: trainers.map((t) => {
      const r = currentByTrainer[t._id.toString()] || null;
      return {
        id: t._id,
        name: t.name,
        rate: r
          ? {
              baseSalary: r.baseSalary,
              groupAmount: r.groupAmount,
              groupPer: r.groupPer,
              pt1Amount: r.pt1Amount,
              ptGroupAmount: r.ptGroupAmount,
              ptGroupPer: r.ptGroupPer,
              effectiveFrom: r.effectiveFrom,
            }
          : null,
      };
    }),
  });
}));

// POST /api/payroll/settings/:trainerId — tạo bản ghi mức MỚI (effective từ bây giờ).
// Không sửa đè bản cũ: buổi đã dạy giữ mức cũ (bản gửi khách mục 7).
router.post("/settings/:trainerId", adminOnly, wrap(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.trainerId)) {
    return res.status(404).json({ error: "Không tìm thấy HLV" });
  }
  const trainer = await Trainer.findById(req.params.trainerId);
  if (!trainer) return res.status(404).json({ error: "Không tìm thấy HLV" });

  const fields = [
    ["baseSalary", "Lương cứng"],
    ["groupAmount", "Hoa hồng lớp nhóm"],
    ["pt1Amount", "Hoa hồng PT 1:1"],
    ["ptGroupAmount", "Hoa hồng PT nhóm"],
  ];
  // Body không gửi mức nào -> chặn (review her-12 V5): tránh client tưởng partial-update
  // mà vô tình tạo bản ghi mức TOÀN 0 đè mức hiện hành
  const hasAny = [...fields.map(([k]) => k), "groupPer", "ptGroupPer"].some((k) => req.body?.[k] !== undefined);
  if (!hasAny) {
    return res.status(400).json({ error: "Chưa nhập mức nào — gửi đủ các mức muốn áp dụng (0 nếu không trả)" });
  }
  const doc = { trainerId: trainer._id, effectiveFrom: new Date(), createdBy: req.user._id };
  for (const [key, label] of fields) {
    const parsed = parseAmount(req.body[key], label);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    doc[key] = parsed.value;
  }
  for (const key of ["groupPer", "ptGroupPer"]) {
    const v = req.body[key];
    if (v !== undefined && v !== "session" && v !== "attendee") {
      return res.status(400).json({ error: "Cách tính phải là theo buổi (session) hoặc theo khách (attendee)" });
    }
    doc[key] = v || "session";
  }
  const rate = await TrainerRate.create(doc);
  res.status(201).json({ rate });
}));

// GET /api/payroll/summary?month=YYYY-MM — bảng lương tháng, LUÔN tính động theo điểm danh
// hiện tại (quyết định 16/08 — BỎ cơ chế chốt: sửa điểm danh là số tự cập nhật theo).
router.get("/summary", adminOnly, wrap(async (req, res) => {
  const month = req.query.month;
  const range = monthRange(month);
  if (!range) {
    return res.status(400).json({ error: "Tháng không hợp lệ — dùng dạng YYYY-MM (vd 2026-08)" });
  }
  // Tháng chưa tới chưa có gì để xem — chặn để bảng không hiện lương cứng "tương lai" gây nhầm
  if (range.from > new Date()) {
    return res.status(400).json({ error: "Tháng này chưa tới — chưa có số liệu" });
  }
  const result = await computeMonth(month);
  res.json({ month, entries: result.entries });
}));

// GET /api/payroll/my?month= — HLV (kể cả admin kiêm HLV) xem thù lao CỦA MÌNH (tính động).
router.get("/my", wrap(async (req, res) => {
  const allowedRole = req.user.role === "trainer" || req.user.role === "admin";
  if (!allowedRole || !req.user.trainerId) {
    return res.status(403).json({ error: "Chỉ HLV (hoặc admin có hồ sơ HLV) mới xem được thù lao của mình" });
  }
  const month = req.query.month;
  const myRange = monthRange(month);
  if (!myRange) {
    return res.status(400).json({ error: "Tháng không hợp lệ — dùng dạng YYYY-MM (vd 2026-08)" });
  }
  if (myRange.from > new Date()) {
    return res.status(400).json({ error: "Tháng này chưa tới — chưa có số liệu" });
  }
  const myId = req.user.trainerId.toString();
  const result = await computeMonth(month);
  const entry = result.entries.find((e) => e.trainerId.toString() === myId) || null;
  res.json({ month, entry });
}));

module.exports = router;
