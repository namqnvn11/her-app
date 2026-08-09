# HER — Pilates · Gym · Yoga

App quản lý phòng tập với **4 vai trò**: Admin, Lễ tân, Nhân viên (HLV), Học viên — mỗi vai trò
đăng nhập vào cùng 1 app nhưng thấy bộ màn hình khác nhau theo đúng quyền của mình.

```
her-app/
├── backend/   Node.js + Express + MongoDB — API thật
└── mobile/    React Native (Expo) — app di động, tự đổi giao diện theo vai trò đăng nhập
```

## Chạy thử theo đúng thứ tự

1. **`backend/`** — dựng API trước. Xem `backend/README.md`:
   tạo MongoDB Atlas free → `npm install` → `npm run seed` → `npm start`.
2. **`mobile/`** — sửa `mobile/src/config.js` cho đúng địa chỉ backend, rồi:
   `npm install` → `npx expo start` → quét QR bằng Expo Go.

## Sơ đồ phân quyền 3 tầng

```
admin       -> tạo & quản trị MỌI tài khoản (Lễ tân + Nhân viên + Học viên). Chỉ khoá/mở khoá, không xoá.
reception   -> tạo & quản trị tài khoản Học viên (khoá/mở khoá, không xoá).
              Sắp xếp lịch cho Nhân viên (tạo/xoá khung Group + PT 1:1).
              Xem & hủy lịch của MỌI học viên, không giới hạn giờ.
trainer     -> chỉ xem lịch dạy của chính mình (read-only), không hủy hộ khách.
customer    -> đặt lịch Group/PT, xem lịch của mình, tự hủy (phải còn >= 3 tiếng trước giờ tập).
```

Quy tắc tạo/khoá tài khoản được enforce ở **backend** (`accounts.routes.js`), không chỉ ở giao diện.
Không còn chức năng xoá tài khoản (quyết định 07/08/2026) — API xoá trả 410; thay bằng khoá.
Khoá tài khoản HLV sẽ ẩn HLV đó khỏi mọi danh sách đặt/xếp lịch và chặn cả gọi thẳng API.

## Tài khoản demo (mật khẩu chung `123456`, sau khi `npm run seed`)

| Vai trò | SĐT | Thấy gì |
|---|---|---|
| Admin | `0999999999` | Tạo & quản lý mọi tài khoản (lễ tân, nhân viên, học viên); khoá/mở khoá |
| Lễ tân | `0900000000` | Xếp lịch HLV, tạo/khoá tài khoản Học viên, xem & hủy lịch mọi khách |
| Nhân viên (HLV Linh) | `0911111111` | Chỉ xem lịch dạy của mình |
| Học viên | `0909090909` | Gói + lịch của Minh Anh |
| Học viên | `0912345678` | Gói + lịch của Thảo Vy |

## Kịch bản demo đầy đủ (đi từ trên xuống, dùng đúng 5 tài khoản trên)

### 1. Admin — tạo tài khoản Lễ tân & Nhân viên
1. Đăng nhập `0999999999`.
2. Vào tab **Tài khoản** → tab con **Lễ tân**: tạo thêm 1 tài khoản lễ tân mới (VD tên "Lễ tân Hà",
   SĐT `0900000001`) → bấm **Tạo tài khoản**. Tài khoản mới hiện ngay trong danh sách.
3. Chuyển sang tab con **Nhân viên**: tạo tài khoản HLV mới (VD "HLV Nam", SĐT `0922222222`,
   chuyên môn "Gym & Strength") → **Tạo tài khoản**.
4. Thử bấm **Khoá tài khoản** trên tài khoản vừa tạo → trạng thái chuyển "Đã khoá" và HLV đó
   ẩn khỏi danh sách đặt lịch của khách; bấm **Mở lại tài khoản** để khôi phục. (Không còn
   chức năng xoá tài khoản — chỉ khoá/mở khoá.)
5. Đăng xuất.

### 2. Lễ tân — sắp lịch cho HLV, tạo tài khoản học viên
1. Đăng nhập `0900000000`.
2. Vào tab **Xếp lịch HLV** → chọn HLV → nhập tên lớp Group (VD "Pilates Reformer"), sức chứa,
   ngày giờ (định dạng `dd/MM HH:mm`, VD `25/07 07:00`) → **Tạo khung Group**. Khung giờ mới xuất
   hiện, hiển thị sẵn danh sách tên khách đã đặt (ban đầu trống).
3. Chuyển tab **Khung PT 1:1**, tạo thêm 1 khung 1:1 cho cùng HLV.
4. Vào tab **Tài khoản** → tạo tài khoản Học viên mới (VD "Học viên Test", SĐT `0933333333`).
5. Vào tab **Lịch khách**: thấy toàn bộ lịch đã đặt của *mọi* học viên (không riêng ai), có thể
   tìm theo tên/SĐT và hủy bất kỳ lịch nào — không bị khoá 3 tiếng như học viên.
6. Thử khoá tài khoản học viên "Học viên Test" vừa tạo ở bước 4 (quyền lễ tân chỉ quản lý được
   học viên — cố gọi API sửa tài khoản nhân viên/lễ tân khác sẽ bị backend chặn 403).

### 3. Nhân viên (HLV) — chỉ xem lịch dạy của mình
1. Đăng nhập `0911111111` (HLV Linh).
2. Tab **Lịch dạy** chỉ hiện các buổi Group/PT mà chính HLV Linh phụ trách — không thấy lịch của
   HLV khác, và không có nút hủy (read-only).

### 4. Học viên — đặt lịch, xem lịch, tự hủy
1. Đăng nhập `0909090909` (Minh Anh).
2. Tab **Trang chủ** → bấm thẻ "Lớp Group" hoặc "PT 1:1" ở mục Đặt lịch nhanh → nhảy thẳng vào
   đúng tab tương ứng trong màn Đặt lịch.
3. Đặt 1 buổi Group còn chỗ → quay lại **Xếp lịch HLV** (đăng nhập lại bằng tài khoản lễ tân) để
   thấy tên "Minh Anh" xuất hiện trong danh sách khách của đúng khung giờ đó.
4. Quay lại tài khoản học viên, vào tab **Lịch của tôi**: nếu buổi tập còn >= 3 tiếng nữa thì có nút
   **Hủy lịch**; nếu còn dưới 3 tiếng, nút bị khoá và chỉ hiện dòng nhắc liên hệ lễ tân (đúng luật
   hủy 3 tiếng, được chặn lại ở cả UI và API).

## Điểm chính đã hoàn thiện

- Không còn mock data — mọi màn hình đọc/ghi qua API + MongoDB thật.
- Luật hủy lịch 3 tiếng enforce ở **backend**, gọi API trực tiếp cũng không lách được.
- Danh sách tên học viên đã đặt hiển thị ngay trên từng khung giờ Group (màn Xếp lịch HLV).
- Phân quyền tạo/khoá tài khoản (admin quản lý mọi loại; lễ tân chỉ học viên) enforce ở backend.
- App tự nhận diện vai trò từ tài khoản đăng nhập (`admin` / `reception` / `trainer` / `customer`)
  và hiển thị đúng bộ tab — không cần cài app riêng cho từng vai trò.

## Bước tiếp theo có thể cần

- Face ID check-in tại quầy — chưa làm, để dành cho phân hệ App Nội bộ nếu cần sau này.
- Trang "Quên mật khẩu" thật (hiện chưa có, mới chỉ có login/register cơ bản; lễ tân/admin có thể
  đặt lại mật khẩu qua API `PATCH /api/accounts/:id`).
- Date-time picker thật cho màn Xếp lịch HLV (hiện đang nhập tay theo định dạng `dd/MM HH:mm`).
- Đẩy backend lên Render/Railway để không cần chạy trên máy cá nhân (hướng dẫn có trong
  `backend/README.md`).
