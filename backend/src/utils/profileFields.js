// her-59 (04/09/2026): các trường hồ sơ mở rộng — dùng CHUNG cho POST/PATCH /accounts và PATCH /me (C5).
// Tất cả KHÔNG bắt buộc; rỗng/null = xoá. Trả { error } hoặc { set } (chỉ gồm trường có gửi).
const { isValidPhone } = require("./validators");

const GENDERS = ["female", "male", "other"];
const NOTE_MAX = 500;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function profileFieldsError(body) {
  const set = {};
  if (body.email !== undefined) {
    if (body.email === null || body.email === "") set.email = null;
    else if (typeof body.email !== "string" || !EMAIL_RE.test(body.email.trim()) || body.email.trim().length > 254) {
      return { error: "Email không hợp lệ (vd: ten@gmail.com)" };
    } else set.email = body.email.trim().toLowerCase();
  }
  if (body.gender !== undefined) {
    if (body.gender === null || body.gender === "") set.gender = null;
    else if (!GENDERS.includes(body.gender)) return { error: "Giới tính phải là female / male / other" };
    else set.gender = body.gender;
  }
  if (body.emergencyContact !== undefined) {
    const ec = body.emergencyContact;
    if (ec === null) set.emergencyContact = { name: "", phone: "" };
    else if (typeof ec !== "object" || Array.isArray(ec)) return { error: "Liên hệ khẩn cấp phải gồm họ tên và số điện thoại" };
    else {
      const name = ec.name == null ? "" : ec.name;
      const phone = ec.phone == null ? "" : ec.phone;
      if (typeof name !== "string" || typeof phone !== "string") return { error: "Liên hệ khẩn cấp phải gồm họ tên và số điện thoại" };
      if (name.trim().length > 100) return { error: "Tên liên hệ khẩn cấp tối đa 100 ký tự" };
      if (phone.trim() !== "" && !isValidPhone(phone)) return { error: "Số điện thoại liên hệ khẩn cấp không hợp lệ (10 chữ số, bắt đầu bằng 0)" };
      set.emergencyContact = { name: name.trim(), phone: phone.trim() };
    }
  }
  for (const [key, label] of [["healthNotes", "Tình trạng sức khỏe"], ["goals", "Mục tiêu tập luyện"]]) {
    if (body[key] === undefined) continue;
    const v = body[key] === null ? "" : body[key];
    if (typeof v !== "string") return { error: `${label} phải là chữ` };
    if (v.trim().length > NOTE_MAX) return { error: `${label} tối đa ${NOTE_MAX} ký tự` };
    set[key] = v.trim();
  }
  return { set };
}

// Trường HLV được xem về khách (roster): sức khỏe + mục tiêu — KHÔNG gồm SĐT/email/khẩn cấp (16/08, B4)
const TRAINER_VISIBLE = ["healthNotes", "goals"];

module.exports = { GENDERS, NOTE_MAX, profileFieldsError, TRAINER_VISIBLE };
