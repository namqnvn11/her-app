// her-57: mở rộng app.json bằng code để lấy file google-services.json từ BIẾN MÔI TRƯỜNG dạng file của
// EAS (GOOGLE_SERVICES_JSON — loại "file", visibility secret). File thật nằm trong .gitignore (khoá bí mật)
// nên máy build của EAS không có nó; EAS tự tải biến file về và đưa đường dẫn vào process.env.
// Máy dev có file tại chỗ thì dùng luôn ./google-services.json. Mọi thứ khác giữ nguyên từ app.json.
// APP_VERSION_OVERRIDE (chỉ khi đẩy OTA): runtimeVersion = appVersion, nên muốn OTA cho người còn dùng bản
// store CŨ (vd 1.0.2 khi app.json đã lên 1.0.3) thì đặt biến này lúc chạy `eas update`. Code JS mới chạy được
// trên native cũ (push chỉ không đăng ký được, còn lại bình thường). Không dùng khi build.
module.exports = ({ config }) => ({
  ...config,
  version: process.env.APP_VERSION_OVERRIDE || config.version,
  android: {
    ...config.android,
    googleServicesFile: process.env.GOOGLE_SERVICES_JSON || "./google-services.json",
  },
});
