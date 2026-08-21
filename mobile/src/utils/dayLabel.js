// Nhãn NGÀY ngắn kèm THỨ: "T2-24/08" (góp ý 21/08 — chỉ thấy giờ thì không biết buổi rơi
// vào ngày nào, mà chỉ thấy "24/08" cũng phải nhẩm ra thứ mấy).
// getDay(): 0 = Chủ nhật. Bộ chữ T2..T7/CN giống DateTimeField và màn Lịch tự động.
const WEEKDAYS = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];

const pad2 = (n) => String(n).padStart(2, "0");

export function dayLabel(d) {
  const date = new Date(d);
  return `${WEEKDAYS[date.getDay()]}-${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}`;
}

// Như trên, nhưng đúng ngày hôm nay thì ghi thẳng "hôm nay" cho dễ đọc.
export function dayLabelOrToday(d) {
  const date = new Date(d);
  if (date.toDateString() === new Date().toDateString()) return "hôm nay";
  return dayLabel(date);
}
