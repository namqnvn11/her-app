// Loại hình dịch vụ — 1 nguồn duy nhất (C5). Quyết định 12/08/2026 (Q1):
// gói PT là loại riêng; lớp group chỉ có 3 bộ môn.
const SERVICE_LABELS = { gym: "Gym", pilates: "Pilates", yoga: "Yoga", pt: "PT" };
const PACKAGE_SERVICE_TYPES = ["gym", "pilates", "yoga", "pt"];
const CLASS_SERVICE_TYPES = ["gym", "pilates", "yoga"];

// Hình thức thanh toán khi bán gói (bản gửi khách 14/08)
const PAYMENT_METHODS = ["cash", "transfer"];
const PAYMENT_LABELS = { cash: "Tiền mặt", transfer: "Chuyển khoản" };

// Title booking PT theo sức chứa khung (her-11) — 1 nguồn cho cả đặt lịch lẫn đổi HLV
const ptTitle = (capacity, trainerName) =>
  capacity > 1 ? `PT nhóm — ${trainerName}` : `1:1 PT — ${trainerName}`;

module.exports = { SERVICE_LABELS, PACKAGE_SERVICE_TYPES, CLASS_SERVICE_TYPES, PAYMENT_METHODS, PAYMENT_LABELS, ptTitle };
