// her-57: mở rộng app.json bằng code để lấy file google-services.json từ BIẾN MÔI TRƯỜNG dạng file của
// EAS (GOOGLE_SERVICES_JSON — loại "file", visibility secret). File thật nằm trong .gitignore (khoá bí mật)
// nên máy build của EAS không có nó; EAS tự tải biến file về và đưa đường dẫn vào process.env.
// Máy dev có file tại chỗ thì dùng luôn ./google-services.json. Mọi thứ khác giữ nguyên từ app.json.
module.exports = ({ config }) => ({
  ...config,
  android: {
    ...config.android,
    googleServicesFile: process.env.GOOGLE_SERVICES_JSON || "./google-services.json",
  },
});
