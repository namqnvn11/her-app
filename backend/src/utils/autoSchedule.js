const AutoScheduleRule = require("../models/AutoScheduleRule");
const AutoScheduleLog = require("../models/AutoScheduleLog");
const GymClass = require("../models/GymClass");
const { isTrainerLocked } = require("./activeTrainers");
const { FORMAT_CAPACITY } = require("./formats");

// her-32: máy sinh lịch tự động — quét cửa sổ [hôm nay .. +7 ngày] (đúng tầm thấy 7 ngày
// của học viên ở màn Đặt lịch), mỗi (luật active, ngày khớp thứ, giờ còn ở tương lai) mà
// CHƯA có sổ ghi thì sinh 1 lớp 60' rồi ghi sổ. Sinh lỗi (HLV khoá/trùng giờ) thì
// BỎ QUA buổi đó — không ghi sổ, lần chạy sau thử lại; không bao giờ throw ra ngoài.

const AUTO_WINDOW_DAYS = 7;
const DURATION_MS = 60 * 60 * 1000; // mọi khung giờ của app mặc định 60'

const dateKeyOf = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// HLV không thể dạy 2 nơi cùng lúc — cùng bất biến với schedule.routes
// (her-35: mọi buổi đều là GymClass, không còn PTSlot)
async function coachBusy(coachId, start, end) {
  const cls = await GymClass.findOne({ coachId, startAt: { $lt: end }, endAt: { $gt: start } });
  return !!cls;
}

async function runAutoSchedule(now = new Date()) {
  let created = 0;
  const rules = await AutoScheduleRule.find({ active: true });
  for (const rule of rules) {
    for (let off = 0; off <= AUTO_WINDOW_DAYS; off++) {
      try {
        const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + off);
        if (!rule.daysOfWeek.includes(day.getDay())) continue;
        const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), rule.hour, rule.minute, 0, 0);
        if (start <= now) continue; // giờ hôm nay đã qua — không sinh buổi quá khứ
        const dateKey = dateKeyOf(day);
        if (await AutoScheduleLog.findOne({ ruleId: rule._id, dateKey })) continue;
        if (await isTrainerLocked(rule.coachId)) continue;
        const end = new Date(start.getTime() + DURATION_MS);
        if (await coachBusy(rule.coachId, start, end)) continue;

        // Ghi sổ TRƯỚC (unique index = khoá chống 2 lần chạy song song sinh đúp);
        // tạo lớp fail thì gỡ sổ để lần sau thử lại
        let log;
        try {
          log = await AutoScheduleLog.create({ ruleId: rule._id, dateKey });
        } catch (err) {
          if (err.code === 11000) continue; // lần chạy song song đã nhận buổi này
          throw err;
        }
        try {
          await GymClass.create({
            name: rule.name,
            serviceType: rule.serviceType,
            format: rule.format,
            coachId: rule.coachId,
            startAt: start,
            endAt: end,
            capacity: FORMAT_CAPACITY[rule.format],
          });
          created += 1;
        } catch (err) {
          await AutoScheduleLog.deleteOne({ _id: log._id });
          throw err;
        }
      } catch (err) {
        // 1 buổi lỗi không được chặn các buổi/luật còn lại
        console.error("[auto-schedule] bỏ qua 1 buổi:", err.message);
      }
    }
  }
  return created;
}

// Chạy ngay khi server khởi động + lặp mỗi giờ — luôn phủ đủ 7 ngày tới
function startAutoSchedule(intervalMs = 60 * 60 * 1000) {
  runAutoSchedule().catch((err) => console.error("[auto-schedule]", err.message));
  const timer = setInterval(
    () => runAutoSchedule().catch((err) => console.error("[auto-schedule]", err.message)),
    intervalMs
  );
  timer.unref?.(); // không giữ tiến trình sống chỉ vì timer
  return timer;
}

module.exports = { runAutoSchedule, startAutoSchedule, AUTO_WINDOW_DAYS };
