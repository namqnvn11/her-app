# HER App — Backend (Node.js + MongoDB)

API thật thay cho mock data, dùng **Express** + **MongoDB** (chạy tốt trên tier free của MongoDB Atlas).

## 1. Tạo MongoDB free (MongoDB Atlas)

1. Vào https://www.mongodb.com/cloud/atlas/register, tạo tài khoản free.
2. Tạo **Cluster** loại **M0 (Free)**.
3. Database Access → tạo 1 user (username/password) — nhớ lưu lại.
4. Network Access → Add IP Address → chọn **Allow access from anywhere** (0.0.0.0/0) để đơn giản khi test (siết lại sau khi deploy thật).
5. Bấm **Connect** → **Drivers** → copy chuỗi kết nối dạng:
   `mongodb+srv://<user>:<password>@<cluster>.mongodb.net/her_gym?retryWrites=true&w=majority`

## 2. Cài đặt & chạy local

```bash
cd backend
npm install
cp .env.example .env
```

Mở `.env`, dán chuỗi kết nối vào `MONGODB_URI`, đặt `JWT_SECRET` bất kỳ (một chuỗi dài ngẫu nhiên).

```bash
# Tạo dữ liệu mẫu: HLV, lớp group, khung giờ PT, tài khoản demo...
npm run seed

# Chạy server (mặc định cổng 4000)
npm start
```

Server chạy tại `http://localhost:4000`. Kiểm tra nhanh: mở `http://localhost:4000/api/health` phải thấy `{"ok":true,...}`.

## 3. Tài khoản demo sau khi seed (mật khẩu chung: `123456`)

| Vai trò | Số điện thoại | Ghi chú |
|---|---|---|
| Admin | `0999999999` | Chủ phòng tập — quản trị mọi tài khoản (lễ tân + HLV + học viên), xếp lịch, hủy lịch mọi khách |
| Lễ tân (reception) | `0900000000` | Xếp lịch HLV, tạo tài khoản học viên, xem/hủy lịch mọi khách |
| HLV (trainer) | `0911111111` | HLV Linh — chỉ xem lịch dạy của chính mình |
| Học viên (customer) | `0909090909` | Minh Anh — có gói tập + lịch mẫu (1 buổi sát giờ để demo khoá nút hủy) |
| Học viên (customer) | `0912345678` | Thảo Vy — gói tập khác, để lễ tân thấy có nhiều khách |

## 4. Các endpoint chính

```
POST   /api/auth/login          { phone, password } -> { token, user, config }
POST   /api/auth/register       mặc định ĐÓNG (403) — chỉ mở khi ALLOW_SELF_REGISTER=true

GET    /api/me                   (cần Bearer token)
PATCH  /api/me                   { name?, avatarUrl? }
GET    /api/me/package
GET    /api/me/bookings           lịch sắp tới của chính khách
GET    /api/me/history            lịch sử tập/hủy

GET    /api/classes               lớp group 7 ngày tới (kèm spotsLeft, ẩn lớp của HLV bị khoá)
GET    /api/trainers              HLV + khung giờ PT còn trống

POST   /api/bookings              { type:"group", classId } | { type:"pt", slotId }
DELETE /api/bookings/:id          hủy — khách bị chặn nếu còn < 3h, staff thì không

# Quản lý (reception/admin xem tất cả; trainer chỉ thấy lịch của mình):
GET    /api/management/bookings?range=today|upcoming|all&search=<tên/SĐT>&page=&limit=
GET    /api/management/customers/:id/bookings   (chỉ reception/admin)
GET    /api/management/classes/:id/roster        danh sách khách của 1 lớp

# Xếp lịch HLV (chỉ reception/admin):
GET/POST/PATCH/DELETE  /api/schedule/classes[...]
GET/POST/DELETE        /api/schedule/pt-slots[...]

# Quản trị tài khoản (admin quản lý mọi loại TK; reception chỉ quản lý customer).
# Không có xoá tài khoản — chỉ khoá/mở khoá (PATCH isActive):
GET/POST/PATCH  /api/accounts[...]
```

Mọi route (trừ `/auth/*` và `/health`) cần header:
```
Authorization: Bearer <token nhận được lúc login>
```

## 5. Deploy

**Máy chủ thật (AWS Lightsail, từ 23/08/2026):** bộ script trong `deploy/` ở gốc repo —
`setup-server.sh` (cài máy 1 lần), `deploy.sh` (cập nhật bản mới), `backup-mongo.sh` (sao lưu đêm),
`nginx-her.conf`, `ecosystem.config.js` (pm2). Hướng dẫn từng bước: `docs-her/huong-dan-deploy-aws.md`.
Máy chủ phục vụ API cho app; web xem tạm vẫn ở Vercel (đặt `EXPO_PUBLIC_API_URL` trỏ API HTTPS — xem `mobile/src/config.js`).

### 5b. (Cũ) Deploy free Render + Atlas

Chạy local thì app di động chạy trên **điện thoại thật** sẽ không gọi được `localhost` của máy tính —
cần 1 trong 2 cách:

**Cách nhanh khi test:** dùng IP LAN của máy tính (`http://192.168.x.x:4000/api`), điện thoại và máy
tính phải cùng Wi-Fi — cập nhật vào `mobile/src/config.js`.

**Cách để dùng thật/lâu dài:** deploy backend lên **Render** (free tier):
1. Đẩy thư mục `backend/` lên một repo GitHub riêng.
2. Trên Render: New → Web Service → chọn repo đó.
3. Build command: `npm install`. Start command: `npm start`.
4. Thêm Environment Variables giống trong `.env` (xem đủ danh sách trong `.env.example`: MONGODB_URI, JWT_SECRET, MIN_CANCEL_HOURS, JWT_EXPIRES_IN, ALLOW_SELF_REGISTER, LOGIN_MAX_ATTEMPTS, LOGIN_BLOCK_MINUTES, COMPLETE_SWEEP_MINUTES).
5. Sau khi deploy xong, Render cho một URL dạng `https://her-app-backend.onrender.com` — dán URL này
   (kèm `/api`) vào `mobile/src/config.js`.

> Lưu ý free tier của Render sẽ "ngủ" sau một thời gian không có request — lần gọi đầu sau khi ngủ
> sẽ chậm hơn vài giây, bình thường với app free.

## 6. Cấu trúc

```
backend/
├── server.js                 # Khởi động Express + kết nối MongoDB
├── src/
│   ├── config/db.js
│   ├── models/                User, Trainer, GymClass, PTSlot, Package, Booking
│   ├── middleware/auth.js      requireAuth, requireRole, requireManagement
│   ├── utils/                  cancelRule, validators, loginRateLimit, asyncHandler, completeSweep, activeTrainers
│   ├── routes/                 auth, me, classes, trainers, bookings, management, schedule, accounts
│   └── scripts/seed.js         tạo dữ liệu mẫu
```
