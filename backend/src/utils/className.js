// her-36 (chốt 20/08/2026): mỗi buổi tập có thể mang TÊN RIÊNG ("Pilates phục hồi"),
// không bắt buộc dùng chung nhãn bộ môn. Tên là TUỲ CHỌN ở mọi đường tạo lịch
// (quầy · HLV tự mở buổi · luật lịch tự động) — bỏ trống thì server lấy nhãn bộ môn.
// Luật độ dài nằm DUY NHẤT ở đây để 3 route không lệch nhau (C5).

const MAX_CLASS_NAME = 100;

// Trả về:
//   { skip: true }        -- client không gửi field name (giữ nguyên / dùng fallback)
//   { error: "..." }      -- sai kiểu hoặc quá dài -> route trả 400 kèm message này
//   { value: "<đã gọn>" } -- hợp lệ; value === "" nghĩa là "bỏ trống" -> dùng nhãn bộ môn
function normalizeClassName(raw) {
  if (raw === undefined || raw === null) return { skip: true };
  if (typeof raw !== "string") return { error: "Tên lớp phải là chữ" };
  // Gộp mọi cụm khoảng trắng (kể cả xuống dòng) thành 1 dấu cách — tên nhiều dòng
  // sẽ làm vỡ dòng trong danh sách buổi trên app
  const value = raw.trim().replace(/\s+/g, " ");
  if (value.length > MAX_CLASS_NAME) return { error: `Tên lớp tối đa ${MAX_CLASS_NAME} ký tự` };
  return { value };
}

module.exports = { normalizeClassName, MAX_CLASS_NAME };
