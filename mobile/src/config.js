// Sửa dòng dưới thành địa chỉ backend của bạn.
//
// - Chạy backend trên máy, test bằng Expo Go trên điện thoại: dùng IP LAN của máy tính,
//   ví dụ "http://192.168.1.23:4000/api" (điện thoại & máy tính phải cùng Wi-Fi).
//   Không dùng "localhost" — điện thoại không hiểu localhost là máy tính của bạn.
// - Đã deploy backend (Render/Railway...): dùng thẳng URL đó, ví dụ
//   "https://her-app-backend.onrender.com/api".

import { Platform } from "react-native";

// Chạy trên web (trình duyệt cùng máy với backend) → localhost là đúng.
// Chạy trên điện thoại (Expo Go) → phải dùng IP LAN ở dưới.
export const API_BASE_URL =
  Platform.OS === "web"
    ? "http://localhost:4000/api"
    : "http://192.168.100.82:4000/api";