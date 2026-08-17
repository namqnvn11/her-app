# HER — Giao diện mới (bản chốt) — hướng dẫn ghép vào dự án

Bộ file này viết cho **mobile/ (React Native + Expo)** hiện tại, giữ nguyên mọi lời gọi API
và quy tắc nghiệp vụ H1–H6. Chỉ thay lớp giao diện: màu nút terracotta, danh sách chia theo
mốc giờ, form nằm trong bottom sheet, thêm Dark mode + màn Cài đặt + Dashboard theo vai trò.

## Cách ghép

1. Chép cả thư mục `src/` trong bộ này đè lên `mobile/src/` (các file trùng tên là bản
   đã đổi giao diện, logic gọi API giữ nguyên như bản cũ).
2. Bọc app bằng ThemeProvider — sửa `mobile/App.js`:

```js
import { ThemeProvider } from "./src/context/ThemeContext";
// ...
export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AuthProvider>
          <Root />
        </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
```

3. Trong `App.js`, `tabBarOptions` đang dùng `COLORS` tĩnh — đổi sang hàm nhận theme:

```js
import { useTheme } from "./src/theme";
// trong mỗi Navigator:
const { c } = useTheme();
const tabBarOptions = {
  headerShown: false,
  tabBarActiveTintColor: c.primary,
  tabBarInactiveTintColor: c.tabInactive,
  tabBarStyle: { backgroundColor: c.card, borderTopColor: c.line, paddingBottom: 8, height: 62 },
  tabBarLabelStyle: { fontSize: 10.5, fontWeight: "700" },
};
```

4. Thêm 2 màn mới vào các Navigator:

```js
import DashboardScreen from "./src/screens/DashboardScreen";
import SettingsScreen from "./src/screens/SettingsScreen";

// Tab đầu tiên của reception/admin và trainer:
<Tab.Screen name="Tong_quan" component={DashboardScreen} options={{ title: "Tổng quan" }} />
```

Màn Cài đặt mở từ Cá nhân (đã có nút "Cài đặt" trong ProfileScreen). Nếu muốn dùng
`navigation.navigate("Cai_dat")` thì thêm một Stack bọc quanh ProfileScreen, hoặc giữ
nguyên cách hiện tại: SettingsScreen hiện dạng modal ngay trong ProfileScreen.

## API còn thiếu cho Dashboard

DashboardScreen gọi `GET /api/dashboard` (trả số liệu theo vai trò của token). Backend
chưa có endpoint này — trước khi có, màn hình hiện khung rỗng kèm dòng nhắc, không vỡ.
Gợi ý dữ liệu trả về:

```json
{
  "reception": { "classesToday": 6, "bookingsToday": 38, "freeSlots": 12, "unpaid": 2,
                 "today": [{ "time": "07:00", "title": "Pilates Reformer", "coach": "HLV Linh", "booked": 5, "capacity": 8 }],
                 "todo": [{ "title": "5 gói sắp hết hạn", "sub": "trong 7 ngày — mời gia hạn" }] },
  "admin":     { "revenue": 128400000, "packagesSold": 22, "payroll": 41200000, "sessions": 412,
                 "peakHours": [{ "time": "07:00", "rate": 0.92 }],
                 "trainers": [{ "name": "HLV Linh", "sessions": 64, "attendance": 0.92, "pay": 18400000 }] },
  "trainer":   { "weekHours": 18, "monthSessions": 64, "estimatedPay": 18400000, "attendanceRate": 0.92,
                 "next": { "time": "07:00", "title": "Pilates Reformer", "customers": ["Minh Anh", "Thảo Vy"] },
                 "rest": [{ "time": "11:00", "title": "PT — Thảo Vy", "sub": "PT 1:1" }] }
}
```

Số liệu phải lấy từ điểm danh và bảng gói/thanh toán (đúng H2, H5): lễ tân không được thấy
lương/hoa hồng, HLV chỉ thấy phần của chính mình — kiểm tra ở **server**, không phải ở app.

## File trong bộ này

| File | Nội dung |
|---|---|
| `src/theme.js` | Bảng màu sáng + tối, `useTheme()` |
| `src/context/ThemeContext.js` | Provider, lưu lựa chọn vào AsyncStorage, chế độ "theo hệ thống" |
| `src/components/AppButton.js` | Nút pill: primary / outline / ghost |
| `src/components/Pill.js` | Badge trạng thái |
| `src/components/TopBar.js` | Tiêu đề màn |
| `src/components/HeaderBlock.js` | Khối header terracotta có số liệu (Trang chủ, Dashboard) |
| `src/components/SectionLabel.js` | Nhãn mục chữ hoa |
| `src/components/TimeRow.js` | Dòng danh sách có cột giờ bên trái |
| `src/components/Toggle.js` | Công tắc bật/tắt |
| `src/components/FormSheet.js` | Bottom sheet chứa form tạo mới |
| `src/screens/SettingsScreen.js` | Màn Cài đặt (Dark mode, thông báo, đổi mật khẩu) |
| `src/screens/DashboardScreen.js` | Dashboard cho lễ tân / admin / HLV |
| `src/screens/HomeScreen.js` | Trang chủ khách — bố cục mới |
| `src/screens/BookingScreen.js` | Đặt lịch — danh sách theo mốc giờ |
| `src/screens/ScheduleScreen.js` | Lịch của tôi — bố cục mới |
| `src/screens/ProfileScreen.js` | Cá nhân + lối vào Cài đặt |

Các màn quản trị còn lại (ManagementScheduleScreen, ScheduleBuilderScreen, AccountsScreen)
giữ nguyên logic; để đổi giao diện chỉ cần thay `COLORS` bằng `useTheme()` và dùng
`TimeRow` + `FormSheet` như các màn đã làm mẫu ở đây.
