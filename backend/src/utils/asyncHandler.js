// Express 4 KHÔNG tự bắt lỗi ném ra từ handler async — lỗi trở thành unhandled
// rejection và có thể làm chết cả tiến trình (lỗi L1). Bọc mọi route handler async
// bằng wrap() để lỗi được chuyển cho error middleware ở server.js.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = wrap;
