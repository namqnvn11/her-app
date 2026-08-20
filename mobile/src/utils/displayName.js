// Dòng ĐẬM thống nhất cho mọi màn lịch của cả 4 vai trò (her-38, chốt 20/08):
// "Tên lớp · loại hình · HLV X". Mảnh nào thiếu thì bỏ hẳn, không để " · " thừa.
// Tên lớp đã chứa sẵn loại hình, hoặc đã chứa sẵn tên HLV (title PT cũ "1:1 PT — Tiến"),
// thì KHÔNG ghép lặp — riêng tên HLV chỉ chèn thêm chữ "HLV" vào đúng chỗ tên.
export function classTitle({ name, title, format, coach } = {}) {
  const base = String(name ?? title ?? "").trim();
  const fmt = String(format || "").trim();
  const rawCoach = String(coach || "").trim();
  const parts = [];
  if (base) parts.push(base);
  if (fmt && !base.toLowerCase().includes(fmt.toLowerCase())) parts.push(fmt);
  if (rawCoach) {
    const full = /^hlv\b/i.test(rawCoach) ? rawCoach : `HLV ${rawCoach}`;
    const at = base.toLowerCase().indexOf(rawCoach.toLowerCase());
    if (at >= 0) parts[0] = base.slice(0, at) + full + base.slice(at + rawCoach.length);
    else parts.push(full);
  }
  return parts.join(" · ");
}
