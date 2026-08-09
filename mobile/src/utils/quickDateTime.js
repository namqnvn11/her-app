// Chuyển "25/07 07:00" (dd/MM HH:mm, năm hiện tại) hoặc "05/01/2027 07:00" (kèm năm)
// -> Date, để lễ tân nhập nhanh trên điện thoại.
// Trả về { date } khi hợp lệ, hoặc { error } — KHÔNG âm thầm đẩy ngày quá khứ sang năm sau
// (trước đây gõ nhầm "05/01" vào tháng 8 sẽ tạo lớp ở tháng 1 năm sau mà không ai biết).
export function parseQuickDateTime(text, now = new Date()) {
  const m = String(text || "")
    .trim()
    .match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\s+(\d{1,2}):(\d{2})$/);
  if (!m) return { error: "Nhập giờ đúng định dạng dd/MM HH:mm, VD 25/07 07:00" };
  const [, dd, mm, yyyy, hh, min] = m;
  // Giờ/phút kiểm tra riêng — nếu để Date tự "tràn" (10:99 -> 11:39) sẽ tạo lớp sai giờ mà không ai biết
  if (Number(hh) > 23) return { error: "Giờ phải từ 00 đến 23" };
  if (Number(min) > 59) return { error: "Phút phải từ 00 đến 59" };

  const year = yyyy ? Number(yyyy) : now.getFullYear();
  const d = new Date(year, Number(mm) - 1, Number(dd), Number(hh), Number(min), 0, 0);
  // Ngày không tồn tại (vd 31/02) bị Date tự "tràn" sang tháng sau -> bắt bằng cách so lại
  if (d.getDate() !== Number(dd) || d.getMonth() !== Number(mm) - 1) {
    return { error: "Ngày này không tồn tại, kiểm tra lại" };
  }
  if (d < now) {
    return {
      error: `Ngày giờ này đã qua — nếu ý bạn là năm sau, nhập đủ năm: ${dd}/${mm}/${now.getFullYear() + 1} ${hh}:${min}`,
    };
  }
  return { date: d };
}

// Thời lượng buổi tập tính bằng phút — số nguyên 15..240, mặc định 60
export function parseDurationMinutes(text) {
  const raw = String(text ?? "").trim();
  const n = raw === "" ? 60 : Number(raw);
  if (!Number.isInteger(n) || n < 15 || n > 240) {
    return { error: "Thời lượng phải là số nguyên từ 15 đến 240 phút" };
  }
  return { minutes: n };
}
