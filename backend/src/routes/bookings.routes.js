const express = require("express");
const mongoose = require("mongoose");
const Booking = require("../models/Booking");
const GymClass = require("../models/GymClass");
const PTSlot = require("../models/PTSlot");
const Package = require("../models/Package");
const { requireAuth } = require("../middleware/auth");
const { canCustomerCancel, MIN_CANCEL_HOURS } = require("../utils/cancelRule");
const { isTrainerLocked } = require("../utils/activeTrainers");
const { chargeSession, packageErrorMessage } = require("../utils/packages");
const { ptTitle } = require("../utils/serviceTypes");
const wrap = require("../utils/asyncHandler");

const router = express.Router();
router.use(requireAuth);

// POST /api/bookings   { type: "group", classId }  hoặc  { type: "pt", slotId }
//
// Chống race (lỗi L2): KHÔNG dùng kiểu "đọc - kiểm tra - ghi". Thứ tự:
//   0. Đọc & kiểm tra đích (tồn tại, chưa qua giờ, HLV không bị khoá, không trùng lịch)
//   1. Trừ buổi gói tập ATOMIC — gói phải còn hạn TẠI NGÀY DIỄN RA BUỔI TẬP
//      (không chỉ "còn hạn hôm nay" — tránh hoàn buổi vào gói đã chết khi hủy sau này)
//   2. Giành chỗ ATOMIC — điều kiện kèm SNAPSHOT giờ/HLV đã đọc ở bước 0: nếu lễ tân vừa
//      sửa lớp ngay giữa chừng, lệnh giành chỗ thất bại thay vì tạo booking sai giờ
//   3. Ghi booking (unique index chặn bấm đúp)
// Bước sau thất bại thì hoàn bù (compensation) bước trước — có cờ chống hoàn 2 lần.
// Lưu ý: "trùng giờ với lịch KHÁC" là pre-check (giới hạn ghi ở testcase doc her-02).
router.post("/", wrap(async (req, res) => {
  const { type, classId, slotId } = req.body;
  if (type !== "group" && type !== "pt") {
    return res.status(400).json({ error: "type phải là 'group' hoặc 'pt'" });
  }
  const targetId = type === "group" ? classId : slotId;
  if (!mongoose.isValidObjectId(targetId)) {
    return res
      .status(404)
      .json({ error: type === "group" ? "Không tìm thấy lớp học" : "Không tìm thấy khung giờ" });
  }

  // ---- Bước 0: đọc & kiểm tra đích (chưa đụng gì vào dữ liệu) ----
  let gymClass = null;
  let slot = null;
  if (type === "group") {
    gymClass = await GymClass.findById(classId).populate("coachId", "name");
    if (!gymClass) return res.status(404).json({ error: "Không tìm thấy lớp học" });
    // Dữ liệu cũ chưa chạy backfill: không đoán loại gói để trừ bừa
    if (!gymClass.serviceType) {
      return res.status(400).json({ error: "Lớp này chưa được gán bộ môn — liên hệ lễ tân cập nhật" });
    }
    if (gymClass.startAt <= new Date()) {
      return res.status(400).json({ error: "Lớp này đã qua giờ bắt đầu, không thể đặt" });
    }
    if (await isTrainerLocked(gymClass.coachId?._id)) {
      return res.status(400).json({ error: "HLV của lớp này tạm ngưng hoạt động, không thể đặt" });
    }
    // $ne cancelled: buổi được điểm danh SỚM (trước giờ, status completed/no_show) vẫn phải
    // chặn đặt lại — không thì khách bị trừ buổi lần 2 (review her-10 #2)
    const already = await Booking.findOne({ userId: req.user._id, status: { $ne: "cancelled" }, classId });
    if (already) return res.status(400).json({ error: "Bạn đã đặt lịch này rồi" });
  } else {
    slot = await PTSlot.findById(slotId).populate("trainerId", "name");
    if (!slot) return res.status(404).json({ error: "Không tìm thấy khung giờ" });
    if (slot.startAt <= new Date()) {
      return res.status(400).json({ error: "Khung giờ này đã qua, không thể đặt" });
    }
    // PT nhóm (mục 6): kín khi bookedCount đạt capacity (capacity 1 = PT 1:1 như cũ)
    if (slot.bookedCount >= slot.capacity) {
      return res.status(400).json({ error: "Khung giờ này đã kín chỗ" });
    }
    if (await isTrainerLocked(slot.trainerId?._id)) {
      return res.status(400).json({ error: "HLV này tạm ngưng hoạt động, không thể đặt" });
    }
    // $ne cancelled: kể cả buổi bị điểm danh SỚM — không cho đặt lại cùng khung (her-10 #2)
    const alreadyPt = await Booking.findOne({ userId: req.user._id, status: { $ne: "cancelled" }, slotId });
    if (alreadyPt) return res.status(400).json({ error: "Bạn đã đặt lịch này rồi" });
  }
  const target = gymClass || slot;
  const overlapping = await Booking.findOne({
    userId: req.user._id,
    status: { $ne: "cancelled" }, // gồm cả buổi điểm danh sớm (review her-10 #2)
    startAt: { $lt: target.endAt },
    endAt: { $gt: target.startAt },
  });
  if (overlapping) {
    return res.status(400).json({ error: `Bạn đã có lịch "${overlapping.title}" trùng giờ này` });
  }

  // ---- Bước 1: trừ 1 buổi atomic — H7: gói phải ĐÚNG LOẠI hình + còn hạn tới ngày tập ----
  // Lớp group trừ gói theo bộ môn của lớp; buổi PT trừ gói loại "pt" (quyết định 12/08/2026).
  // Thứ tự nhiều gói (Q4): gói có hạn gần hết trước, gói không thời hạn sau cùng.
  // Gói đang bảo lưu bị loại; gói còn nợ tiền vẫn dùng bình thường (Q10/Q11 16/08).
  const requiredType = type === "group" ? gymClass.serviceType : "pt";
  const pkg = await chargeSession(req.user._id, requiredType, target.startAt);
  if (!pkg) {
    return res
      .status(400)
      .json({ error: await packageErrorMessage(req.user._id, requiredType, target.startAt) });
  }

  // Hoàn bù buổi đã trừ — chạy đúng 1 lần khi THÀNH CÔNG; DB lỗi thì thử lại 1 lần rồi
  // log lớn để lễ tân đối soát tay, không nuốt im lặng (buổi tập là tiền của khách)
  let refunded = false;
  const refundOnce = () =>
    Package.updateOne({ _id: pkg._id, usedSessions: { $gt: 0 } }, { $inc: { usedSessions: -1 } });
  const refundSession = async () => {
    if (refunded) return;
    try {
      await refundOnce();
      refunded = true;
    } catch (err) {
      try {
        await refundOnce();
        refunded = true;
      } catch (err2) {
        console.error("[refund-failed] KHÁCH MẤT 1 BUỔI, cần đối soát tay:", {
          userId: req.user._id.toString(),
          packageId: pkg._id.toString(),
          error: err2.message,
        });
      }
    }
  };

  try {
    let booking;

    if (type === "group") {
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
          userId: req.user._id,
          type: "group",
          classId: gymClass._id,
          trainerId: gymClass.coachId._id,
          title: gymClass.name,
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
          return res.status(400).json({ error: "Bạn đã đặt lịch này rồi" });
        }
        throw err;
      }
    } else {
      // Giành 1 chỗ atomic (L2/C3): điều kiện còn chỗ ngay TRONG lệnh ghi — 2 người bấm
      // cùng lúc chỗ cuối thì chỉ 1 lệnh khớp điều kiện; kèm snapshot giờ/HLV như lớp nhóm
      const claimed = await PTSlot.findOneAndUpdate(
        {
          _id: slotId,
          startAt: slot.startAt,
          endAt: slot.endAt, // đối xứng với nhánh group (review her-11 N1)
          trainerId: slot.trainerId._id,
          $expr: { $lt: ["$bookedCount", "$capacity"] },
        },
        { $inc: { bookedCount: 1 } },
        { new: true }
      );
      if (!claimed) {
        await refundSession();
        return res.status(400).json({ error: "Khung giờ này vừa kín chỗ" });
      }

      try {
        booking = await Booking.create({
          userId: req.user._id,
          type: "pt",
          slotId: slot._id,
          trainerId: slot.trainerId._id,
          title: ptTitle(claimed.capacity, slot.trainerId.name),
          startAt: slot.startAt,
          endAt: slot.endAt,
          packageId: pkg._id,
        });
        // Tự lành race hiếm (her-09 #1): quầy đổi HLV đúng giữa lúc claim và create
        const freshSlot = await PTSlot.findById(slotId).populate("trainerId", "name");
        if (freshSlot && !freshSlot.trainerId._id.equals(booking.trainerId)) {
          await Booking.updateOne(
            { _id: booking._id },
            { $set: { trainerId: freshSlot.trainerId._id, title: ptTitle(freshSlot.capacity, freshSlot.trainerId.name) } }
          );
          booking.trainerId = freshSlot.trainerId._id;
        }
      } catch (err) {
        await PTSlot.updateOne({ _id: slotId, bookedCount: { $gt: 0 } }, { $inc: { bookedCount: -1 } }).catch((e) =>
          console.error("[slot-release-failed] PT slot có thể kẹt 'đã đặt', cần kiểm tra tay:", {
            slotId: String(slotId),
            error: e.message,
          })
        );
        await refundSession();
        if (err.code === 11000) {
          return res.status(400).json({ error: "Bạn đã đặt lịch này rồi" });
        }
        throw err;
      }
    }

    res.status(201).json({
      booking: {
        id: booking._id,
        type: booking.type,
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
  if (booking.status !== "booked") {
    return res.status(400).json({ error: "Lịch này không còn ở trạng thái có thể hủy" });
  }

  const isOwner = booking.userId.toString() === req.user._id.toString();
  const isStaff = req.user.role === "reception" || req.user.role === "admin";

  if (!isOwner && !isStaff) {
    return res.status(403).json({ error: "Bạn không có quyền hủy lịch này" });
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

  // Trả lại chỗ / khung giờ + hoàn buổi. Nếu bước nào lỗi (DB chập chờn) thì log lớn để
  // đối soát và báo thẳng cho khách thay vì trả "ok" giả — hủy đã ghi nhận nhưng buổi chưa hoàn.
  try {
    if (booking.type === "group" && booking.classId) {
      await GymClass.updateOne(
        { _id: booking.classId, bookedCount: { $gt: 0 } },
        { $inc: { bookedCount: -1 } }
      );
    } else if (booking.type === "pt" && booking.slotId) {
      await PTSlot.updateOne(
        { _id: booking.slotId, bookedCount: { $gt: 0 } },
        { $inc: { bookedCount: -1 } }
      );
    }

    // Hoàn buổi về ĐÚNG gói đã bị trừ lúc đặt (lỗi L3). Booking cũ chưa có packageId thì
    // fallback: ưu tiên gói còn hạn có hạn xa nhất, cập nhật atomic (không read-modify-write).
    if (booking.packageId) {
      await Package.updateOne(
        { _id: booking.packageId, usedSessions: { $gt: 0 } },
        { $inc: { usedSessions: -1 } }
      );
    } else {
      // Booking cũ (trước her-05) không có packageId — fallback như cũ nhưng ưu tiên gói
      // đúng loại với booking (group không suy được bộ môn từ booking cũ -> giữ hành vi cũ)
      const typeFilter = booking.type === "pt" ? { serviceType: "pt" } : {};
      const pkg =
        (await Package.findOne({ userId: booking.userId, ...typeFilter, expiresAt: { $gte: new Date() } }).sort({ expiresAt: -1 })) ||
        (await Package.findOne({ userId: booking.userId, ...typeFilter }).sort({ expiresAt: -1 }));
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
