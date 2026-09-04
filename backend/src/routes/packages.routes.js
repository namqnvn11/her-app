const express = require("express");
const mongoose = require("mongoose");
const User = require("../models/User");
const Package = require("../models/Package");
const { requireAuth, requireManagement, requireRole } = require("../middleware/auth");
const { PAYMENT_METHODS } = require("../utils/serviceTypes");
const { isValidPackageType } = require("../utils/disciplines");
const { isValidFormat, packageShapeError } = require("../utils/formats");
const Booking = require("../models/Booking");
const { serializePackage, hasDebtPayment } = require("../utils/packages");
const wrap = require("../utils/asyncHandler");
const { monthRange } = require("../utils/payroll");
const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

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
  // her-53: tài khoản đã xoá mềm — không bán/tra cứu gói nữa (dữ liệu gói vẫn nằm trong DB)
  if (customer.deletedAt) {
    res.status(404).json({ error: "Học viên này đã bị xoá" });
    return null;
  }
  return customer;
}

// ---- Validate từng field của gói — DÙNG CHUNG cho bán gói (POST) và sửa gói (PATCH, her-53) ----
// Mỗi hàm trả message lỗi tiếng Việt hoặc null; 1 nguồn luật duy nhất (C5).
const MAX_PRICE = 1_000_000_000; // cap 1 tỷ đồng/gói để chặn số rác kiểu 1e308
const TEN_YEARS_MS = 3650 * 24 * 3600 * 1000;

function nameError(name) {
  if (!name || typeof name !== "string" || !name.trim()) return "Thiếu tên gói";
  if (name.trim().length > 200) return "Tên gói tối đa 200 ký tự";
  return null;
}
// Bộ môn của gói: mảng ≥1, không trùng, mọi phần tử phải nằm trong danh mục bộ môn (her-35)
async function serviceTypesError(serviceTypes) {
  if (!Array.isArray(serviceTypes) || serviceTypes.length < 1) return "Chọn ít nhất 1 bộ môn cho gói";
  if (new Set(serviceTypes).size !== serviceTypes.length) return "Bộ môn trong gói bị trùng lặp";
  for (const st of serviceTypes) {
    if (typeof st !== "string" || !(await isValidPackageType(st))) return "Bộ môn không hợp lệ — chọn từ danh mục bộ môn";
  }
  return null;
}
const formatError = (format) => (isValidFormat(format) ? null : "Loại hình phải là 1:1, 1:2, 1:4 hoặc 1:8");
// Giá VND: số nguyên không âm
const priceError = (price) =>
  !Number.isInteger(price) || price < 0 || price > MAX_PRICE ? "Giá gói phải là số nguyên (đồng), tối đa 1 tỷ" : null;
const MAX_SESSIONS = 10_000; // chặn gõ nhầm kiểu "1 tỷ buổi" (review her-53 #9)
const totalSessionsError = (n) =>
  !Number.isInteger(n) || n < 1 || n > MAX_SESSIONS ? "Số buổi phải là số nguyên dương, tối đa 10.000" : null;
const paymentMethodError = (m) =>
  PAYMENT_METHODS.includes(m) ? null : "Hình thức thanh toán phải là tiền mặt (cash), chuyển khoản (transfer) hoặc cà thẻ (card)";
// her-55: "số buổi đã tập" nhập tay (khách cũ có gói trước khi dùng app / tập thử trước khi mua)
const usedSessionsError = (n, total) => {
  if (!Number.isInteger(n) || n < 0 || n > MAX_SESSIONS) return "Số buổi đã tập phải là số nguyên không âm, tối đa 10.000";
  if (total != null && n > total) return `Số buổi đã tập (${n}) không được lớn hơn số buổi của gói (${total})`;
  return null;
};
const paidAmountError = (paid) => (!Number.isInteger(paid) || paid < 0 ? "Số tiền đã thu phải là số nguyên (đồng)" : null);
// Ngày hết hạn chọn từ lịch: hợp lệ, ở tương lai, tối đa 10 năm; hết hạn = HẾT ngày được chọn
// (khách chọn 30/09 thì tập được trọn ngày 30/09). Trả { error } hoặc { value: Date }.
// her-56: gói nhập lùi ngày bán (soldAt) thì hạn chỉ cần SAU ngày bán (gói đã hết hạn vẫn nhập được
// để ghi doanh thu đúng tháng); không có soldAt thì như cũ: phải ở tương lai.
function parseExpiresAt(raw, soldAt = null) {
  const d = new Date(raw);
  if (isNaN(d.getTime())) return { error: "Ngày hết hạn không hợp lệ" };
  d.setHours(23, 59, 59, 999);
  if (soldAt) {
    if (d <= soldAt) return { error: "Ngày hết hạn phải sau ngày bán" };
  } else if (d <= new Date()) return { error: "Ngày hết hạn phải ở tương lai" };
  if (d > new Date(Date.now() + TEN_YEARS_MS)) return { error: "Ngày hết hạn tối đa 10 năm" };
  return { value: d };
}
// her-56: NGÀY BÁN — hệ thống mới đưa vào dùng, quầy nhập lại các gói đã bán trước đó để doanh thu vào
// đúng tháng. Không ở tương lai (hết ngày hôm nay), không quá 10 năm trước. Trả { error } | { value }.
function parseSoldAt(raw) {
  const d = new Date(raw);
  if (isNaN(d.getTime())) return { error: "Ngày bán không hợp lệ" };
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  if (d > endOfToday) return { error: "Ngày bán không được ở tương lai" };
  if (d < new Date(Date.now() - TEN_YEARS_MS)) return { error: "Ngày bán quá xa (tối đa 10 năm trước)" };
  return { value: d };
}

// POST /api/packages  { userId, name, serviceTypes: [bộ môn...], format, price, totalSessions?,
//                       expiresAt? | durationDays?, paymentMethod?, paidAmount? }
// her-35 (19/08): gói MIX — nhiều BỘ MÔN dùng chung quỹ buổi + đúng 1 LOẠI HÌNH.
// 2 loại gói: gói BUỔI (loại hình 1:1/1:2/1:4, bộ môn nào cũng được) và gói THỜI HẠN
// (không giới hạn buổi — chỉ Yoga, loại hình 1:8).
// 3 kiểu buổi/hạn (Q3): chỉ buổi / chỉ thời hạn / cả hai — ít nhất 1 trong 2 (H7).
// paidAmount bỏ trống = thu đủ; paidAmount < price = còn nợ, KHÔNG chặn đặt lịch (Q10).
router.post("/", wrap(async (req, res) => {
  const { userId, name, serviceTypes, format, price, totalSessions, durationDays, expiresAt: expiresAtRaw, paymentMethod, paidAmount, usedSessions, soldAt: soldAtRaw } = req.body;

  const customer = await findCustomerOr404(userId, res);
  if (!customer) return;

  let err = nameError(name) || (await serviceTypesError(serviceTypes)) || formatError(format) || priceError(price);
  if (err) return res.status(400).json({ error: err });
  const hasSessions = totalSessions !== undefined && totalSessions !== null;
  // her-19: app gửi NGÀY HẾT HẠN chọn từ lịch (expiresAt); durationDays giữ để tương thích cũ
  const hasExpiresAt = expiresAtRaw !== undefined && expiresAtRaw !== null && expiresAtRaw !== "";
  const hasDuration = !hasExpiresAt && durationDays !== undefined && durationDays !== null;
  if (!hasSessions && !hasDuration && !hasExpiresAt) {
    return res.status(400).json({ error: "Gói phải có số buổi hoặc ngày hết hạn (hoặc cả hai)" });
  }
  if (hasSessions && (err = totalSessionsError(totalSessions))) return res.status(400).json({ error: err });
  // her-55: số buổi đã tập lúc bán (bỏ trống = 0)
  const used = usedSessions === undefined || usedSessions === null ? 0 : usedSessions;
  if ((err = usedSessionsError(used, hasSessions ? totalSessions : null))) return res.status(400).json({ error: err });
  if (hasDuration && (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 3650)) {
    return res.status(400).json({ error: "Thời hạn (số ngày) phải là số nguyên dương, tối đa 10 năm" });
  }
  // her-35: 2 loại gói (chốt 19/08) — gói THỜI HẠN chỉ Yoga 1:8; gói BUỔI chỉ 1:1/1:2/1:4.
  // Dùng CHUNG helper với pre-validate của model (C5) — chặn ở đây để báo lý do rõ tiếng Việt
  // thay vì để mongoose ném lỗi validate (C6).
  const shapeError = packageShapeError({ format, serviceTypes, hasSessions });
  if (shapeError) return res.status(400).json({ error: shapeError });

  // her-56: ngày bán — bỏ trống = bây giờ; nhập lùi để ghi gói cũ đúng tháng doanh thu
  let activatedAt = new Date();
  if (soldAtRaw !== undefined && soldAtRaw !== null && soldAtRaw !== "") {
    const parsedSold = parseSoldAt(soldAtRaw);
    if (parsedSold.error) return res.status(400).json({ error: parsedSold.error });
    activatedAt = parsedSold.value;
  }
  const backdated = activatedAt < new Date(Date.now() - 60 * 1000);
  let pickedExpiry = null;
  if (hasExpiresAt) {
    const parsed = parseExpiresAt(expiresAtRaw, backdated ? activatedAt : null);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    pickedExpiry = parsed.value;
  }
  const method = paymentMethod === undefined ? "cash" : paymentMethod;
  if ((err = paymentMethodError(method))) return res.status(400).json({ error: err });
  // paidAmount bỏ trống = đã thu đủ
  const paid = paidAmount === undefined || paidAmount === null ? price : paidAmount;
  if ((err = paidAmountError(paid))) return res.status(400).json({ error: err });
  if (paid > price) {
    return res.status(400).json({ error: "Số tiền đã thu không được lớn hơn giá gói" });
  }

  const expiresAt = hasExpiresAt ? pickedExpiry : hasDuration ? new Date(activatedAt.getTime() + durationDays * 24 * 3600 * 1000) : null;
  const pkg = await Package.create({
    userId: customer._id,
    name: name.trim(),
    serviceTypes,
    format,
    price,
    totalSessions: hasSessions ? totalSessions : null,
    usedSessions: used,
    activatedAt,
    expiresAt,
    paymentMethod: method,
    paidAmount: paid,
    // Nhật ký thu tiền (her-13): dòng đầu = số thu ngay lúc bán (nếu có)
    payments: paid > 0 ? [{ amount: paid, at: activatedAt, by: req.user._id }] : [],
  });
  res.status(201).json({ package: serializePackage(pkg) });
}));

// GET /api/packages?month=YYYY-MM&q=&page=&limit= — her-60 (04/09/2026): LỊCH SỬ GÓI BÁN toàn hệ thống
// (admin + lễ tân — chốt phương án B). Tháng theo NGÀY BÁN activatedAt (khớp báo cáo her-56 F4),
// bỏ trống = tháng này. q khớp tên (bỏ dấu, không phân biệt hoa thường) hoặc SĐT khách — lọc
// khách bằng JS vì Mongo không bỏ dấu được (danh sách khách nhỏ, vài trăm). Gói xoá mềm không hiện;
// khách xoá mềm thì gói VẪN hiện (doanh thu đã thu là thật) kèm customer.deleted = true.
// summary = tổng của CẢ tháng (không phải trang đang xem) để quầy đối soát nhanh.
const normVi = (str) => String(str || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d");
router.get("/", wrap(async (req, res) => {
  const { month: monthRaw, q } = req.query;
  const month = monthRaw === undefined || monthRaw === "" ? monthKey(new Date()) : monthRaw;
  const range = monthRange(month);
  if (!range) return res.status(400).json({ error: "Tháng không hợp lệ — dùng dạng YYYY-MM (vd 2026-08)" });
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 30));

  const filter = { deletedAt: null, activatedAt: { $gte: range.from, $lt: range.to } };
  const needle = typeof q === "string" ? normVi(q.trim()) : "";
  if (needle) {
    const digits = needle.replace(/\D/g, "");
    const customers = await User.find({ role: "customer" }).select("name phone");
    const ids = customers
      .filter((u) => normVi(u.name).includes(needle) || (digits && String(u.phone || "").includes(digits)))
      .map((u) => u._id);
    filter.userId = { $in: ids };
  }

  const [total, sums, minDoc, docs] = await Promise.all([
    Package.countDocuments(filter),
    Package.aggregate([
      { $match: filter },
      { $project: { price: 1, paid: { $ifNull: ["$paidAmount", "$price"] } } },
      { $group: { _id: null, revenue: { $sum: "$paid" }, debt: { $sum: { $max: [{ $subtract: ["$price", "$paid"] }, 0] } } } },
    ]),
    Package.findOne({ deletedAt: null }).sort({ activatedAt: 1 }).select("activatedAt"),
    Package.find(filter)
      .sort({ activatedAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit + 1) // dư 1 để biết còn trang sau (mẫu her-28)
      .populate("userId", "name phone deletedAt avatarUrl"),
  ]);
  const hasMore = docs.length > limit;
  if (hasMore) docs.pop();
  res.json({
    month,
    page,
    limit,
    total,
    hasMore,
    minMonth: minDoc ? monthKey(minDoc.activatedAt) : month,
    summary: { count: total, revenue: sums[0]?.revenue || 0, debt: sums[0]?.debt || 0 },
    packages: docs.map((p) => ({
      ...serializePackage(p),
      customer: {
        id: p.userId?._id || null,
        name: p.userId?.name || "(đã xoá)",
        phone: p.userId?.phone || "",
        avatarUrl: p.userId?.avatarUrl || null,
        deleted: !p.userId || !!p.userId.deletedAt,
      },
    })),
  });
}));

// GET /api/packages/customer/:userId — toàn bộ gói (đang dùng + hết hạn) để tra cứu tại quầy
router.get("/customer/:userId", wrap(async (req, res) => {
  const customer = await findCustomerOr404(req.params.userId, res);
  if (!customer) return;
  const packages = await Package.find({ userId: customer._id, deletedAt: null }).sort({ createdAt: -1 }); // her-55
  res.json({ packages: packages.map(serializePackage) });
}));

// Tìm gói theo :id — id rác 400, không có 404 (dùng chung cho pay/pause/resume)
async function findPackageOr404(id, res) {
  if (!mongoose.isValidObjectId(id)) {
    res.status(400).json({ error: "Mã (ID) không hợp lệ" });
    return null;
  }
  const pkg = await Package.findOne({ _id: id, deletedAt: null }); // her-55: gói đã xoá mềm = không còn
  if (!pkg) {
    res.status(404).json({ error: "Không tìm thấy gói" });
    return null;
  }
  return pkg;
}

// her-55: buổi SẮP TỚI đã trừ từ gói này (mọi trạng thái trừ huỷ, chưa kết thúc) — dùng để chặn
// đổi bộ môn/loại hình không khớp và chặn xoá gói
const upcomingOf = (pkgId) => Booking.find({ packageId: pkgId, status: { $ne: "cancelled" }, endAt: { $gt: new Date() } })
  .select("serviceType format startAt");
// Số buổi sắp tới KHÔNG hợp với hình dạng gói (bộ môn/loại hình) hoặc rơi SAU ngày hết hạn mới.
// Booking cũ thiếu snapshot bộ môn/loại hình (dữ liệu trước her-35) không bị tính là lệch (review #13).
function mismatchCount(upcoming, { serviceTypes, format, expiresAt }) {
  return upcoming.filter((b) => {
    const shapeBad = b.serviceType && b.format && (!serviceTypes.includes(b.serviceType) || b.format !== format);
    const dateBad = expiresAt != null && b.startAt > expiresAt;
    return shapeBad || dateBad;
  }).length;
}

// PATCH /api/packages/:id — SỬA GÓI (her-53, 03/09/2026): chủ dự án cần sửa gói bán/tạo nhầm.
// Body = tập con của EDITABLE; totalSessions/expiresAt nhận null = bỏ giới hạn đó.
// Ràng buộc (D2/D9/D10 trong spec her-53):
//  - gói ĐÃ trừ buổi (usedSessions > 0): không đổi bộ môn/loại hình (booking đã đặt theo gói này);
//  - số buổi mới không nhỏ hơn số đã dùng; luật hình dạng gói (H7) áp trên bản gộp;
//  - số đã thu ≤ giá; gói đã có lần THU NỢ (sổ thu >1 dòng) thì không sửa tay số đã thu;
//  - ghi atomic có điều kiện usedSessions = giá trị đã đọc — giữa lúc đọc và ghi có booking
//    trừ/hoàn buổi thì 409, không để totalSessions < usedSessions lọt qua khe race (C3).
const EDITABLE = ["name", "serviceTypes", "format", "price", "totalSessions", "expiresAt", "paymentMethod", "paidAmount", "usedSessions", "soldAt"];
const sameSet = (a, b) => a.length === b.length && [...a].sort().join("|") === [...b].sort().join("|");
const vnd = (n) => n.toLocaleString("vi-VN") + "đ";

// her-56: CHỈ ADMIN sửa gói (lễ tân 403) — chủ dự án chốt 03/09
router.patch("/:id", requireRole("admin"), wrap(async (req, res) => {
  const pkg = await findPackageOr404(req.params.id, res);
  if (!pkg) return;
  const owner = await User.findById(pkg.userId).select("deletedAt");
  if (owner && owner.deletedAt) {
    return res.status(400).json({ error: "Học viên của gói này đã bị xoá — không sửa gói được nữa" });
  }
  const body = req.body && typeof req.body === "object" ? req.body : {};
  if (!EDITABLE.some((k) => body[k] !== undefined)) {
    return res.status(400).json({ error: "Không có thông tin nào để sửa" });
  }

  const set = {};
  let err = null;
  if (body.name !== undefined) {
    if ((err = nameError(body.name))) return res.status(400).json({ error: err });
    set.name = body.name.trim();
  }
  if (body.serviceTypes !== undefined) {
    if ((err = await serviceTypesError(body.serviceTypes))) return res.status(400).json({ error: err });
    set.serviceTypes = body.serviceTypes;
  }
  if (body.format !== undefined) {
    if ((err = formatError(body.format))) return res.status(400).json({ error: err });
    set.format = body.format;
  }
  if (body.price !== undefined) {
    if ((err = priceError(body.price))) return res.status(400).json({ error: err });
    set.price = body.price;
  }
  if (body.totalSessions !== undefined) {
    if (body.totalSessions !== null && (err = totalSessionsError(body.totalSessions))) return res.status(400).json({ error: err });
    set.totalSessions = body.totalSessions;
  }
  // her-56: đổi NGÀY BÁN (activatedAt) — chỉ khi chưa có lần thu nợ (dòng thu lúc bán dời theo)
  if (body.soldAt !== undefined) {
    const parsedSold = parseSoldAt(body.soldAt);
    if (parsedSold.error) return res.status(400).json({ error: parsedSold.error });
    if (hasDebtPayment(pkg)) {
      return res.status(400).json({ error: "Gói đã có lần thu nợ sau khi bán — không đổi được ngày bán" });
    }
    set.activatedAt = parsedSold.value;
  }
  if (body.expiresAt !== undefined) {
    // Gói đang bảo lưu: mở bảo lưu sẽ cộng bù khoảng đã ngưng lên hạn -> ngày vừa đặt tay bị
    // dịch tiếp, lễ tân khó hiểu (review #6). Bắt mở bảo lưu trước rồi mới sửa hạn.
    if (pkg.pausedAt != null) {
      return res.status(400).json({ error: "Gói đang bảo lưu — mở bảo lưu trước rồi mới sửa ngày hết hạn" });
    }
    if (body.expiresAt === null || body.expiresAt === "") set.expiresAt = null;
    else {
      const soldRef = set.activatedAt || pkg.activatedAt;
      const parsed = parseExpiresAt(body.expiresAt, soldRef < new Date(Date.now() - 60 * 1000) ? soldRef : null);
      if (parsed.error) return res.status(400).json({ error: parsed.error });
      set.expiresAt = parsed.value;
    }
  }
  if (set.activatedAt && !("expiresAt" in set) && pkg.expiresAt && pkg.expiresAt <= set.activatedAt) {
    return res.status(400).json({ error: "Ngày bán mới phải trước ngày hết hạn của gói" });
  }
  if (body.paymentMethod !== undefined) {
    if ((err = paymentMethodError(body.paymentMethod))) return res.status(400).json({ error: err });
    set.paymentMethod = body.paymentMethod;
  }
  if (body.paidAmount !== undefined) {
    if ((err = paidAmountError(body.paidAmount))) return res.status(400).json({ error: err });
    set.paidAmount = body.paidAmount;
  }
  if (body.usedSessions !== undefined) {
    if ((err = usedSessionsError(body.usedSessions, null))) return res.status(400).json({ error: err });
    set.usedSessions = body.usedSessions;
  }

  // Bản gộp (giá trị mới đè lên giá trị hiện tại) — mọi luật tổng thể kiểm trên bản này
  const next = {
    serviceTypes: set.serviceTypes || pkg.serviceTypes,
    format: set.format || pkg.format,
    price: set.price !== undefined ? set.price : pkg.price,
    totalSessions: "totalSessions" in set ? set.totalSessions : pkg.totalSessions,
    expiresAt: "expiresAt" in set ? set.expiresAt : pkg.expiresAt,
  };
  if (next.totalSessions == null && next.expiresAt == null) {
    return res.status(400).json({ error: "Gói phải có số buổi hoặc ngày hết hạn (hoặc cả hai)" });
  }
  const shapeError = packageShapeError({ format: next.format, serviceTypes: next.serviceTypes, hasSessions: next.totalSessions != null });
  if (shapeError) return res.status(400).json({ error: shapeError });

  const used = pkg.usedSessions || 0;
  // her-55 (E1): đổi bộ môn/loại hình được kể cả khi đã trừ buổi — chỉ chặn khi còn buổi SẮP TỚI
  // đã trừ từ gói này mà không khớp gói mới (buổi đã tập giữ nguyên lịch sử)
  const typeChanged = (set.serviceTypes && !sameSet(set.serviceTypes, pkg.serviceTypes)) || (set.format && set.format !== pkg.format);
  // Rút ngắn hạn xuống trước ngày của buổi sắp tới cũng là bất nhất cùng loại (review #6)
  const expiryChanged = "expiresAt" in set && String(set.expiresAt) !== String(pkg.expiresAt);
  const shapeTouched = typeChanged || expiryChanged;
  const mismatchError = (n) =>
    `Gói còn ${n} buổi sắp tới không hợp với gói mới (bộ môn/loại hình/ngày hết hạn) — hủy hoặc đổi buổi trước rồi mới sửa gói`;
  if (shapeTouched) {
    const mismatched = mismatchCount(await upcomingOf(pkg._id), next);
    if (mismatched > 0) return res.status(400).json({ error: mismatchError(mismatched) });
  }
  // Số buổi đã tập (nhập tay hoặc hiện tại) không được vượt số buổi của gói
  const nextUsed = set.usedSessions !== undefined ? set.usedSessions : used;
  if (next.totalSessions != null && next.totalSessions < nextUsed) {
    return res.status(400).json({
      error: set.usedSessions !== undefined
        ? `Số buổi đã tập (${nextUsed}) không được lớn hơn số buổi của gói (${next.totalSessions})`
        : `Gói đã dùng ${nextUsed} buổi — số buổi mới không được nhỏ hơn ${nextUsed}`,
    });
  }

  // Thanh toán: paidAmount null (gói cũ trước đợt thanh toán) = coi như thu đủ theo giá hiện hành
  const currentPaid = pkg.paidAmount == null ? pkg.price : pkg.paidAmount;
  const nextPaid = set.paidAmount !== undefined ? set.paidAmount : pkg.paidAmount == null ? next.price : pkg.paidAmount;
  if (nextPaid > next.price) {
    return res.status(400).json({
      error: set.paidAmount !== undefined
        ? "Số tiền đã thu không được lớn hơn giá gói"
        : `Giá mới thấp hơn số đã thu (${vnd(nextPaid)}) — sửa cả số đã thu`,
    });
  }
  const payments = pkg.payments || [];
  if (set.activatedAt && payments.length === 1 && set.paidAmount === undefined) {
    // Dời dòng thu lúc bán theo ngày bán mới để doanh thu vào đúng tháng (chỉ có 1 dòng = dòng bán)
    set.payments = [{ amount: payments[0].amount, at: set.activatedAt, by: payments[0].by }];
  }
  if (set.paidAmount !== undefined && set.paidAmount !== currentPaid) {
    // Đã có lần THU NỢ sau khi bán -> không sửa tay (D9). Nhận biết bằng thời điểm, không bằng
    // số dòng: gói bán chưa thu đồng nào rồi thu nợ 1 lần cũng chỉ có 1 dòng (review #2).
    if (hasDebtPayment(pkg)) {
      return res.status(400).json({
        error: "Gói đã có lần thu nợ sau khi bán — không sửa tay số đã thu; dùng nút Thu tiền (các mục khác vẫn sửa được)",
      });
    }
    // Ghi đè dòng thu lúc bán, GIỮ thời điểm bán để doanh thu tháng của báo cáo không nhảy (D9)
    set.payments = set.paidAmount > 0
      ? [{ amount: set.paidAmount, at: set.activatedAt || payments[0]?.at || pkg.activatedAt, by: req.user._id }]
      : [];
  }

  // Điều kiện ghi = đúng bản đã đọc ở cả 2 trục có thể đổi song song: số buổi (đặt/hủy lịch)
  // và tiền (Thu tiền — review #1: PATCH giá ∥ /pay từng làm paidAmount > price). Lệch -> 409.
  const updated = await Package.findOneAndUpdate(
    {
      _id: pkg._id,
      deletedAt: null, // vừa bị xoá trong khe đọc-ghi thì không sửa đè (review #5)
      usedSessions: used,
      paidAmount: pkg.paidAmount, // null khớp cả doc cũ chưa có field
      // Gói cũ (trước her-13) không có mảng payments -> coi như rỗng, không kẹt 409 mãi
      $expr: { $eq: [{ $size: { $ifNull: ["$payments", []] } }, payments.length] },
    },
    { $set: set },
    { new: true }
  );
  if (!updated) {
    return res.status(409).json({ error: "Gói vừa được dùng để đặt/hủy lịch, thu tiền hoặc đã bị xoá — tải lại rồi sửa tiếp" });
  }
  // Kiểm LẠI sau khi ghi (review her-55 #2): khách có thể vừa đặt buổi bằng gói này trong khe đọc-ghi
  // (usedSessions +1 xảy ra TRƯỚC khi booking được ghi nên điều kiện usedSessions không bắt được).
  // Phía đặt lịch cũng kiểm lại gói sau khi ghi booking — hai bên cùng "ghi rồi kiểm" (mẫu her-53).
  if (shapeTouched) {
    const mismatched = mismatchCount(await upcomingOf(pkg._id), updated);
    if (mismatched > 0) {
      await Package.updateOne(
        { _id: pkg._id },
        { $set: { serviceTypes: pkg.serviceTypes, format: pkg.format, expiresAt: pkg.expiresAt } }
      );
      return res.status(400).json({ error: mismatchError(mismatched) });
    }
  }
  res.json({ package: serializePackage(updated) });
}));

// DELETE /api/packages/:id — XOÁ MỀM gói bán nhầm (her-55, E3). Dữ liệu giữ nguyên; gói ẩn khỏi mọi
// danh sách, không dùng đặt lịch, không tính doanh thu/nợ. Còn buổi SẮP TỚI đã trừ từ gói -> chặn
// (huỷ lịch trước) — không để khách giữ chỗ bằng gói đã biến mất. Buổi đã tập không cản.
// her-56: CHỈ ADMIN xoá gói (lễ tân 403)
router.delete("/:id", requireRole("admin"), wrap(async (req, res) => {
  const pkg = await findPackageOr404(req.params.id, res);
  if (!pkg) return;
  const upcoming = await upcomingOf(pkg._id);
  if (upcoming.length > 0) {
    return res.status(400).json({ error: `Gói còn ${upcoming.length} buổi sắp tới đã đặt — hủy lịch trước khi xoá gói` });
  }
  const deleted = await Package.findOneAndUpdate(
    { _id: pkg._id, deletedAt: null },
    { $set: { deletedAt: new Date(), deletedBy: req.user._id } },
    { new: true }
  );
  if (!deleted) return res.status(404).json({ error: "Không tìm thấy gói" });
  // Kiểm LẠI sau khi ghi (review her-55 #1): khách vừa đặt bằng gói này đúng khe đọc-ghi -> hoàn tác
  // xoá. Phía đặt lịch cũng kiểm lại deletedAt của gói sau khi ghi booking (mẫu her-53).
  const again = await upcomingOf(pkg._id);
  if (again.length > 0) {
    await Package.updateOne({ _id: pkg._id }, { $set: { deletedAt: null, deletedBy: null } });
    return res.status(400).json({ error: `Gói còn ${again.length} buổi sắp tới đã đặt — hủy lịch trước khi xoá gói` });
  }
  res.json({ ok: true, id: deleted._id });
}));

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
      deletedAt: null, // her-55: không ghi tiền vào gói vừa bị xoá (review #5)
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
    { _id: pkg._id, deletedAt: null, pausedAt: null, expiresAt: { $gte: new Date() } },
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
    { _id: pkg._id, deletedAt: null, pausedAt: { $ne: null } },
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
