// Điểm danh mở từ bao nhiêu phút trước giờ bắt đầu (khách hay đến sớm — chốt 30', 16/08).
// Một nguồn duy nhất: server chặn ở route, mobile nhận qua config của /auth/login và /me (C5).
const ATTENDANCE_OPEN_BEFORE_MINUTES = Number(process.env.ATTENDANCE_OPEN_BEFORE_MINUTES || 30);

// HLV tự điểm danh/sửa trong bao nhiêu GIỜ kể từ giờ bắt đầu buổi (chốt 24h, 16/08 —
// luật cũ "hết ngày hôm sau" bị chê xa). Quá hạn phải nhờ quầy — quầy không giới hạn.
const TRAINER_ATTENDANCE_EDIT_HOURS = Number(process.env.TRAINER_ATTENDANCE_EDIT_HOURS || 24);

module.exports = { ATTENDANCE_OPEN_BEFORE_MINUTES, TRAINER_ATTENDANCE_EDIT_HOURS };
