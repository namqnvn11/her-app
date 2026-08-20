// her-35: LOẠI HÌNH buổi tập (1 HLV kèm 1/2/4/8 khách) — nguồn duy nhất phía app (C5).
// Sức chứa do SERVER gán theo loại hình, form không còn ô sức chứa.
export const FORMATS = ["1:1", "1:2", "1:4", "1:8"];
// Loại hình 1:8 chỉ dành cho Yoga (server chặn — form khoá sẵn cho khỏi bấm hụt)
export const FORMAT_18_SERVICE = "yoga";
// Gói BUỔI chỉ có 3 loại hình đầu; 1:8 là loại hình của gói THỜI HẠN (yoga) — khớp server
export const SESSION_PACKAGE_FORMATS = ["1:1", "1:2", "1:4"];
// HLV tự mở/sửa/xoá buổi của chính mình: chỉ 2 loại hình này (server chặn — chốt 19/08)
export const TRAINER_SELF_FORMATS = ["1:1", "1:2"];
// Tên field hoa hồng theo loại hình — mirror backend (src/utils/formats.js), đổi 1 nơi thì đổi cả 2
export const FORMAT_RATE_FIELD = { "1:1": "f11", "1:2": "f12", "1:4": "f14", "1:8": "f18" };

// Nhãn gói tập: "Gym · Pilates · 1:1" — khách có 2 gói mix thì phân biệt được bằng dòng này.
// Gói cũ thiếu serviceLabels/format thì bỏ qua phần đó (trả "" -> chỗ gọi tự ẩn).
export function packageLabel(p) {
  return [((p?.serviceLabels || []).join(" · ")), p?.format].filter(Boolean).join(" · ");
}

// Bộ môn chọn được theo loại hình. `disciplines` là mảng cặp [key, label] lấy từ /disciplines.
export function disciplinesFor(disciplines, format) {
  const list = disciplines || [];
  return format === "1:8" ? list.filter(([k]) => k === FORMAT_18_SERVICE) : list;
}

// HLV chọn được theo bộ môn: HLV chưa khai chuyên môn thì dạy được mọi môn (her-19).
export function coachesFor(trainers, disciplineKey) {
  return (trainers || []).filter(
    (t) => !(t.specialties || []).length || t.specialties.includes(disciplineKey)
  );
}
