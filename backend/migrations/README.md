# Migrations — tự chạy khi deploy (CI/CD gọi qua deploy.sh)

Tạo file `NNN-mo-ta-ngan.js` (001, 002... chạy theo thứ tự tên):

```js
// 001-vi-du-them-field.js — ví dụ: đặt giá trị mặc định cho field mới
module.exports = {
  up: async (db) => {
    await db.collection("users").updateMany(
      { someNewField: { $exists: false } },
      { $set: { someNewField: 0 } }
    );
  },
};
```

- Mỗi file chỉ chạy MỘT LẦN mỗi DB (ghi sổ collection `migrations`) — nhưng hãy viết `up()`
  chạy-lại-vô-hại (dùng `$exists`, upsert...) cho an toàn.
- KHÔNG cần migration cho index — `npm run migrate` tự `syncIndexes()` mọi model mỗi lần deploy.
- Chạy tay: `cd backend && npm run migrate` (dùng MONGODB_URI trong .env).
- Migration lỗi -> deploy DỪNG, API cũ vẫn chạy — sửa xong push lại.
