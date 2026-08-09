const MIN_CANCEL_HOURS = Number(process.env.MIN_CANCEL_HOURS || 3);

// Khách chỉ được tự hủy nếu còn >= MIN_CANCEL_HOURS trước giờ tập.
// Nhân viên/lễ tân (role staff|admin) không bị giới hạn này.
function canCustomerCancel(startAt) {
  const hoursLeft = (new Date(startAt).getTime() - Date.now()) / 3_600_000;
  return hoursLeft >= MIN_CANCEL_HOURS;
}

module.exports = { canCustomerCancel, MIN_CANCEL_HOURS };
