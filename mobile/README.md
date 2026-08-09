# HER — App Khách hàng & Nhân viên (Pilates · Gym · Yoga)

App di động viết bằng **React Native + Expo**, đã nối vào **API thật** (xem `../backend`) —
không còn dùng mock data. Một app, 4 bộ giao diện tùy vai trò đăng nhập:

- **Học viên (customer):** Trang chủ (gói tập + vòng tiến độ), Đặt lịch (Group/PT), Lịch của tôi
  (luật khoá hủy lịch theo số giờ server cấu hình, mặc định 3 tiếng), Cá nhân.
- **HLV (trainer):** Lịch dạy của chính mình (chỉ xem, không hủy hộ khách), Cá nhân.
- **Lễ tân (reception):** Lịch tập của khách (tìm theo tên/SĐT, hủy không giới hạn giờ),
  Xếp lịch HLV (tạo khung Group/PT), Quản trị tài khoản học viên, Cá nhân.
- **Admin:** như lễ tân, và quản trị được MỌI tài khoản (lễ tân + HLV + học viên). Tài khoản chỉ khoá/mở khoá, không xoá.

App tự nhận diện vai trò từ tài khoản đăng nhập (`role` trả về từ API) và hiển thị đúng bộ màn hình.

## Bước 0 — Chạy backend trước

App này **cần backend đang chạy** để lấy dữ liệu. Xem `../backend/README.md`: tạo MongoDB Atlas
free, `npm install`, `npm run seed`, `npm start`.

## Bước 1 — Trỏ app vào backend

Mở `src/config.js`, sửa `API_BASE_URL` thành địa chỉ backend của bạn:

```js
export const API_BASE_URL = "http://192.168.1.23:4000/api"; // IP LAN máy tính, cùng Wi-Fi với điện thoại
```

> Không dùng `localhost` — điện thoại chạy Expo Go không hiểu đó là máy tính của bạn. Nếu đã deploy
> backend (Render...), dùng luôn URL đó.

## Bước 2 — Cài đặt & chạy

Dự án dùng **Expo SDK 54** — Expo Go trên điện thoại cần cùng phiên bản (Expo Go tự cập nhật theo
store nên thường sẽ khớp).

```bash
cd mobile
npm install
npx expo start
```

Quét mã QR bằng app **Expo Go** (Android ưu tiên, iOS quét bằng Camera).

## Tài khoản demo (sau khi backend đã `npm run seed`)

| Vai trò | Số điện thoại | Mật khẩu | Thấy gì |
|---|---|---|---|
| Admin | `0999999999` | `123456` | Quản trị mọi tài khoản (lễ tân, HLV, học viên), lịch mọi khách, xếp lịch |
| Lễ tân | `0900000000` | `123456` | Lịch tập của mọi khách, xếp lịch HLV, tạo tài khoản học viên |
| HLV | `0911111111` | `123456` | Chỉ lịch dạy của HLV Linh |
| Học viên | `0909090909` | `123456` | Gói tập, lịch của Minh Anh |
| Học viên | `0912345678` | `123456` | Gói tập, lịch của Thảo Vy |

## Cấu trúc

```
mobile/
├── App.js                    # Auth-gate + chọn navigator theo role (khách/nhân viên)
├── src/
│   ├── config.js              # API_BASE_URL — chỗ duy nhất cần sửa khi đổi backend
│   ├── api/client.js           # fetch wrapper, tự gắn JWT vào header
│   ├── context/AuthContext.js  # login/logout/khôi phục session (lưu token bằng AsyncStorage)
│   ├── theme.js                # Bảng màu be/trắng/đen
│   ├── components/             # Nút, pill, vòng tiến độ, top bar
│   ├── utils/quickDateTime.js  # parse "dd/MM HH:mm" khi lễ tân xếp lịch (chặn ngày quá khứ)
│   └── screens/
│       ├── LoginScreen.js
│       ├── HomeScreen.js                # (học viên) gói tập + lịch sắp tới
│       ├── BookingScreen.js             # (học viên) đặt lịch Group/PT
│       ├── ScheduleScreen.js            # (học viên) lịch của tôi + luật hủy theo server
│       ├── ManagementScheduleScreen.js  # (lễ tân/admin) lịch mọi khách; (HLV) lịch dạy của mình
│       ├── ScheduleBuilderScreen.js     # (lễ tân/admin) tạo khung giờ Group/PT
│       ├── AccountsScreen.js            # (lễ tân/admin) quản trị tài khoản theo phân quyền
│       └── ProfileScreen.js             # (tất cả) sửa tên, đăng xuất
```

## Có vấn đề khi chạy?

- **"Không kết nối được tới server"** → kiểm tra `API_BASE_URL` trong `src/config.js`, backend có
  đang chạy không, điện thoại/máy tính có cùng Wi-Fi không.
- **Sai số điện thoại hoặc mật khẩu** → chắc chắn đã chạy `npm run seed` ở backend.
- Lỗi thiếu module → chạy lại `npm install`.
- Metro báo lỗi lạ → `npx expo start -c` để xoá cache.
