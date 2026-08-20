const express = require("express");
const mongoose = require("mongoose");
const Booking = require("../models/Booking");
const GymClass = require("../models/GymClass");
const Package = require("../models/Package");
const User = require("../models/User");
const { requireAuth } = require("../middleware/auth");
const { canCustomerCancel, MIN_CANCEL_HOURS } = require("../utils/cancelRule");
const { isTrainerLocked } = require("../utils/activeTrainers");
const { chargeSession, packageErrorMessage } = require("../utils/packages");
const wrap = require("../utils/asyncHandler");

const router = express.Router();
router.use(requireAuth);

// POST /api/bookings   { classId, userId? }
//
// her-39 (20/08): `userId` TUỲ CHỌN = ĐẶT HỘ. Chỉ lễ tân/admin gửi được userId của người
// khác; role khác gửi -> 403 NGAY, chặn trước khi đụng dữ liệu (C8). Mọi luật H2/H3/H4/H7
// giữ nguyên nhưng áp cho NGƯỜI ĐƯỢC ĐẶT (target): trừ gói của target, chống trùng lịch của
// target, hoàn bù về gói của target.
//
// her-35: mọi buổi đều là LỚP (có bộ môn + loại hình 1:1/1:2/1:4/1:8) — không còn PT slot.
// Chống race (lỗi L2): KHÔNG dùng kiểu "đọc - kiểm tra - ghi". Thứ tự:
//   0. Đọc & kiểm tra lớp (tồn tại, chưa qua giờ, HLV không bị khoá, không trùng lịch)
//   1. Trừ buổi gói tập ATOMIC — gói phải còn hạn TẠI NGÀY DIỄN RA BUỔI TẬP
//      (không chỉ "còn hạn hôm nay" — tránh hoàn buổi vào gói đã chết khi hủy sau này)
//   2. Giành chỗ ATOMIC — điều kiện kèm SNAPSHOT giờ/HLV đã đọc ở bước 0: nếu lễ tân vừa
//      sửa lớp ngay giữa chừng, lệnh giành chỗ thất bại thay vì tạo booking sai giờ
//   3. Ghi booking (unique index chặn bấm đúp)
// Bước sau thất bại thì hoàn bù (compensation) bước trước — có cờ chống hoàn 2 lần.
// Lưu ý: "trùng giờ với lịch KHÁC" là pre-check (giới hạn ghi ở testcase doc her-02).
router.post("/", wrap(async (req, res) => {
  const { classId, userId } = req.body;
  const isStaff = req.user.role === "reception" || req.user.role === "admin";

  // ---- her-39: xác định NGƯỜI ĐƯỢC ĐẶT. Kiểm quyền TRƯỚC MỌI THỨ (C8) — khách/HLV gọi
  // thẳng API kèm userId người khác phải bị chặn kể cả khi classId cũng sai.
  let targetUserId = req.user._id;
  if (userId != null && String(userId) !== String(req.user._id)) {
    if (!isStaff) {
      return res.status(403).json({ error: "Chỉ quầy lễ tân/admin mới đặt hộ được" });
    }
    if (!mongoose.isValidObjectId(userId)) {
      return res.status(404).json({ error: "Không tìm thấy học viên cần đặt hộ" });
    }
    const target = await User.findById(userId);
    if (!target) {
      return res.status(404).json({ error: "Không tìm thấy học viên cần đặt hộ" });
    }
    if (target.role !== "customer") {
      return res.status(400).json({ error: "Chỉ đặt lịch hộ được cho tài khoản học viên" });
    }
    if (target.isActive === false) {
      return res.status(400).json({
        error: `Tài khoản ${target.name} đang bị khoá — mở khoá trước rồi mới đặt lịch được`,
      });
    }
    targetUserId = target._id;
  }

  // Thiếu hẳn field ≠ id sai/không tồn tại — báo đúng lý do thay vì "không tìm thấy" (C6)
  if (!classId) {
    return res.status(400).json({ error: "Thiếu classId — chưa chọn buổi tập cần đặt" });
  }
  if (!mongoose.isValidObjectId(classId)) {
    return res.status(404).json({ error: "Không tìm thấy lớp học" });
  }

  // ---- Bước 0: đọc & kiểm tra lớp (chưa đụng gì vào dữ liệu) ----
  const gymClass = await GymClass.findById(classId).populate("coachId", "name");
  if (!gymClass) return res.status(404).json({ error: "Không tìm thấy lớp học" });
  // Dữ liệu cũ/thiếu: không đoán gói để trừ bừa
  if (!gymClass.serviceType) {
    return res.status(400).json({ error: "Lớp này chưa được gán bộ môn — liên hệ lễ tân cập nhật" });
  }
  if (!gymClass.format) {
    return res.status(400).json({ error: "Lớp này chưa được gán loại hình — liên hệ lễ tân cập nhật" });
  }
  // HLV bị xoá hồ sơ -> populate trả null: không tạo booking "không HLV" rồi hỏng ở bước sau
  if (!gymClass.coachId) {
    return res.status(400).json({ error: "Lớp này chưa có HLV — liên hệ lễ tân cập nhật" });
  }
  // her-39: khách tự đặt thì lớp phải chưa bắt đầu (giữ nguyên). QUẦY thì được đặt vào lớp
  // QUÁ KHỨ — kịch bản khách tập trước, đăng ký sau: quầy tạo buổi đã tập rồi add khách vào
  // để trừ buổi cho đúng (yêu cầu 20/08).
  if (!isStaff && gymClass.startAt <= new Date()) {
    return res.status(400).json({ error: "Lớp này đã qua giờ bắt đầu, không thể đặt" });
  }
  if (await isTrainerLocked(gymClass.coachId._id)) {
    return res.status(400).json({ error: "HLV của lớp này tạm ngưng hoạt động, không thể đặt" });
  }
  // $ne cancelled: buổi được điểm danh SỚM (trước giờ, status completed/no_show) vẫn phải
  // chặn đặt lại — không thì khách bị trừ buổi lần 2 (review her-10 #2)
  // her-39: "ai" trong message đổi theo người ĐƯỢC đặt — quầy đặt hộ đọc "Học viên này..."
  const who = String(targetUserId) === String(req.user._id) ? "Bạn" : "Học viên này";
  const already = await Booking.findOne({ userId: targetUserId, status: { $ne: "cancelled" }, classId });
  if (already) return res.status(400).json({ error: `${who} đã đặt lịch này rồi` });

  const overlapping = await Booking.findOne({
    userId: targetUserId,
    status: { $ne: "cancelled" }, // gồm cả buổi điểm danh sớm (review her-10 #2)
    startAt: { $lt: gymClass.endAt },
    endAt: { $gt: gymClass.startAt },
  });
  if (overlapping) {
    return res.status(400).json({ error: `${who} đã có lịch "${overlapping.title}" trùng giờ này` });
  }

  // ---- Bước 1: trừ 1 buổi atomic — H7 mới: gói phải CHỨA bộ môn của lớp, ĐÚNG loại hình
  // và còn hạn tới ngày tập ----
  // Gói mix: 1 gói có thể gồm nhiều bộ môn, nhưng chỉ 1 loại hình (her-35).
  // Thứ tự nhiều gói (Q4): gói có hạn gần hết trước, gói không thời hạn sau cùng.
  // Gói đang bảo lưu bị loại; gói còn nợ tiền vẫn dùng bình thường (Q10/Q11 16/08).
  const pkg = await chargeSession(targetUserId, gymClass, gymClass.startAt);
  if (!pkg) {
    return res
      .status(400)
      // her-39: đặt hộ thì message đọc cho QUẦY nghe, không xưng "bạn" với chủ gói
      .json({
        error: await packageErrorMessage(targetUserId, gymClass, gymClass.startAt, {
          forStaff: String(targetUserId) !== String(req.user._id),
        }),
      });
  }

  // Hoàn bù buổi đã trừ — chạy đúng 1 lần khi THÀNH CÔNG; DB lỗi thì thử lại 1 lần rồi
  // log lớn để lễ tân đối soát tay, không nuốt im lặng (buổi tập là tiền của khách).
  // Chấp nhận rủi ro hiếm: lần 1 ghi được nhưng báo lỗi (mất kết nối lúc trả kết quả) thì
  // lần thử lại hoàn dư 1 buổi — thà dư cho khách còn hơn nuốt mất buổi đã trả tiền.
  let refunded = false;
  const decUsedSession = () =>
    Package.updateOne({ _id: pkg._id, usedSessions: { $gt: 0 } }, { $inc: { usedSessions: -1 } });
  const refundSession = async () => {
    if (refunded) return;
    try {
      await decUsedSession();
      refunded = true;
    } catch (err) {
      try {
        await decUsedSession();
        refunded = true;
      } catch (err2) {
        console.error("[refund-failed] KHÁCH MẤT 1 BUỔI, cần đối soát tay:", {
          userId: targetUserId.toString(),
          packageId: pkg._id.toString(),
          error: err2.message,
        });
      }
    }
  };

  try {
    let booking;

    // ---- Bước 2: giành chỗ atomic, kèm snapshot giờ/HLV đã đọc ở bước 0 ----
    const claimed = await GymClass.findOneAndUpdate(
      {
        _id: classId,
        startAt: gymClass.startAt,
        endAt: gymClass.endAt,
        coachId: gymClass.coachId._id,
        $expr: { $lt: ["$bookedCount", "$capacity"] },
      },
      { $inc: { bookedCount: 1 } },
      { new: true }
    );
    if (!claimed) {
      await refundSession();
      return res.status(400).json({
        error: "Lớp vừa hết chỗ hoặc vừa được cập nhật — kéo làm mới danh sách rồi thử lại",
      });
    }

    // ---- Bước 3: ghi booking; thất bại thì trả lại chỗ + buổi ----
    try {
      booking = await Booking.create({
        userId: targetUserId,
        classId: gymClass._id,
        trainerId: gymClass.coachId._id,
        title: gymClass.name,
        // Snapshot bộ môn + loại hình lúc đặt (her-35): lịch sử/thù lao đọc thẳng từ booking
        serviceType: gymClass.serviceType,
        format: gymClass.format,
        startAt: gymClass.startAt,
        endAt: gymClass.endAt,
        packageId: pkg._id,
      });
      // Tự lành race hiếm (her-09 #1): quầy đổi HLV đúng giữa lúc claim và create —
      // updateMany của PATCH chạy khi booking chưa tồn tại. Đọc lại HLV hiện tại của lớp,
      // lệch thì sửa booking theo giá trị mới nhất.
      const freshClass = await GymClass.findById(classId).select("coachId");
      if (freshClass && !freshClass.coachId.equals(booking.trainerId)) {
        await Booking.updateOne({ _id: booking._id }, { $set: { trainerId: freshClass.coachId } });
        booking.trainerId = freshClass.coachId;
      }
    } catch (err) {
      await GymClass.updateOne({ _id: classId }, { $inc: { bookedCount: -1 } }).catch((e) =>
        console.error("[seat-release-failed] lớp có thể kẹt chỗ ảo, cần kiểm tra tay:", {
          classId: String(classId),
          error: e.message,
        })
      );
      await refundSession();
      if (err.code === 11000) {
        return res.status(400).json({ error: `${who} đã đặt lịch này rồi` });
      }
      throw err;
    }

    res.status(201).json({
      booking: {
        id: booking._id,
        format: booking.format,
        serviceType: booking.serviceType,
        title: booking.title,
        startAt: booking.startAt,
        endAt: booking.endAt,
        status: booking.status,
      },
    });
  } catch (err) {
    // Lỗi bất ngờ sau khi đã trừ buổi -> hoàn lại rồi để error middleware trả lời
    await refundSession();
    throw err;
  }
}));

// DELETE /api/bookings/:id
// Khách: chỉ hủy được lịch của chính mình, và phải còn >= MIN_CANCEL_HOURS.
// Staff/admin: hủy được lịch của bất kỳ khách nào, không giới hạn thời gian.
router.delete("/:id", wrap(async (req, res) => {
  const booking = await Booking.findById(req.params.id);
  if (!booking) return res.status(404).json({ error: "Không tìm thấy lịch đặt" });

  const isOwner = booking.userId.toString() === req.user._id.toString();
  const isStaff = req.user.role === "reception" || req.user.role === "admin";

  // Kiểm tra QUYỀN trước trạng thái: người ngoài không được biết lịch của khách khác
  // đang ở trạng thái nào (403 cho mọi trường hợp, không rò rỉ "đã hủy / đã điểm danh")
  if (!isOwner && !isStaff) {
    return res.status(403).json({ error: "Bạn không có quyền hủy lịch này" });
  }
  if (booking.status !== "booked") {
    return res.status(400).json({ error: "Lịch này không còn ở trạng thái có thể hủy" });
  }
  if (isOwner && !isStaff && !canCustomerCancel(booking.startAt)) {
    return res.status(403).json({
      error: `Chỉ có thể hủy lịch trước giờ tập tối thiểu ${MIN_CANCEL_HOURS} tiếng. Vui lòng liên hệ lễ tân.`,
    });
  }

  // Đổi trạng thái ATOMIC với điều kiện còn "booked" — 2 lần hủy song song thì chỉ
  // lần đầu có hiệu lực, tránh trả chỗ / hoàn buổi 2 lần
  const cancelled = await Booking.findOneAndUpdate(
    { _id: booking._id, status: "booked" },
    {
      $set: {
        status: "cancelled",
        cancelledAt: new Date(),
        cancelledBy: isStaff && !isOwner ? "staff" : "customer",
      },
    },
    { new: true }
  );
  if (!cancelled) {
    return res.status(400).json({ error: "Lịch này không còn ở trạng thái có thể hủy" });
  }

  // Trả lại chỗ trong lớp + hoàn buổi. Nếu bước nào lỗi (DB chập chờn) thì log lớn để
  // đối soát và báo thẳng cho khách thay vì trả "ok" giả — hủy đã ghi nhận nhưng buổi chưa hoàn.
  try {
    await GymClass.updateOne(
      { _id: booking.classId, bookedCount: { $gt: 0 } },
      { $inc: { bookedCount: -1 } }
    );

    // Hoàn buổi về ĐÚNG gói đã bị trừ lúc đặt (lỗi L3). Không có packageId thì
    // fallback: ưu tiên gói còn hạn có hạn xa nhất, cập nhật atomic (không read-modify-write).
    if (booking.packageId) {
      await Package.updateOne(
        { _id: booking.packageId, usedSessions: { $gt: 0 } },
        { $inc: { usedSessions: -1 } }
      );
    } else if (!booking.serviceType || !booking.format) {
      // Thiếu snapshot bộ môn/loại hình -> KHÔNG đoán gói (Mongoose bỏ key undefined khỏi
      // filter, còn mỗi userId => dễ hoàn nhầm gói của bộ môn khác). Thà không hoàn tự động
      // còn hơn hoàn sai — log để lễ tân đối soát tay.
      console.error("[cancel-refund-skipped] booking thiếu snapshot bộ môn/loại hình, không đoán gói để hoàn:", {
        bookingId: booking._id.toString(),
        userId: booking.userId.toString(),
      });
    } else {
      // Booking không có packageId (dữ liệu bất thường sau reseed) — hoàn vào gói khớp
      // (bộ môn + loại hình) ĐÃ trừ ít nhất 1 buổi, hạn xa nhất, atomic như cũ
      const match = {
        userId: booking.userId,
        serviceTypes: booking.serviceType,
        format: booking.format,
        usedSessions: { $gt: 0 },
      };
      const pkg =
        (await Package.findOne({ ...match, expiresAt: { $gte: new Date() } }).sort({ expiresAt: -1 })) ||
        (await Package.findOne(match).sort({ expiresAt: -1 }));
      if (pkg) {
        await Package.updateOne({ _id: pkg._id, usedSessions: { $gt: 0 } }, { $inc: { usedSessions: -1 } });
      }
    }
  } catch (err) {
    console.error("[cancel-compensation-failed] hủy đã ghi nhận nhưng hoàn chỗ/buổi lỗi, cần đối soát tay:", {
      bookingId: booking._id.toString(),
      userId: booking.userId.toString(),
      error: err.message,
    });
    return res.status(500).json({
      error: "Lịch đã được hủy nhưng hoàn buổi gặp lỗi — vui lòng liên hệ lễ tân kiểm tra lại số buổi",
    });
  }

  res.json({ ok: true });
}));

module.exports = router;
