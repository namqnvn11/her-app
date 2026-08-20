// her-35: LOẠI HÌNH buổi tập — nguồn duy nhất (C5). 1 HLV kèm 1/2/4/8 khách;
// sức chứa CỐ ĐỊNH theo loại hình (chốt 19/08), không còn ô sức chứa trên form.
const FORMATS = ["1:1", "1:2", "1:4", "1:8"];
const FORMAT_CAPACITY = { "1:1": 1, "1:2": 2, "1:4": 4, "1:8": 8 };
// Gói BUỔI chỉ có 3 loại hình đầu; 1:8 là loại hình của gói THỜI HẠN (yoga)
const SESSION_PACKAGE_FORMATS = ["1:1", "1:2", "1:4"];
// HLV tự tạo lịch cho mình: chỉ 1:1 và 1:2 (chốt 19/08)
const TRAINER_SELF_FORMATS = ["1:1", "1:2"];
// Loại hình 1:8 chỉ dành cho yoga (chốt 19/08)
const FORMAT_18_SERVICE = "yoga";
// Tên field mức hoa hồng trong TrainerRate theo loại hình
const FORMAT_RATE_FIELD = { "1:1": "f11", "1:2": "f12", "1:4": "f14", "1:8": "f18" };

const isValidFormat = (f) => FORMATS.includes(f);

// Luật HÌNH DẠNG gói (her-35, chốt 19/08): trả message lỗi tiếng Việt, null nếu hợp lệ.
// Dùng chung cho route bán gói (báo 400 rõ lý do — C6) và pre-validate của model.
function packageShapeError({ format, serviceTypes, hasSessions }) {
  if (!Array.isArray(serviceTypes) || serviceTypes.length < 1) return "Gói phải có ít nhất 1 bộ môn";
  if (!hasSessions) {
    if (format !== "1:8" || serviceTypes.length !== 1 || serviceTypes[0] !== FORMAT_18_SERVICE) {
      return "Gói thời hạn chỉ dành cho Yoga, loại hình 1:8";
    }
  } else if (!SESSION_PACKAGE_FORMATS.includes(format)) {
    return "Gói buổi chỉ có loại hình 1:1, 1:2 hoặc 1:4";
  }
  return null;
}

module.exports = {
  FORMATS, FORMAT_CAPACITY, SESSION_PACKAGE_FORMATS, TRAINER_SELF_FORMATS,
  FORMAT_18_SERVICE, FORMAT_RATE_FIELD, isValidFormat, packageShapeError,
};
