// Sửa dòng dưới thành địa chỉ backend của bạn.
//
// - Chạy backend trên máy, test bằng Expo Go trên điện thoại: dùng IP LAN của máy tính,
//   ví dụ "http://192.168.1.23:4000/api" (điện thoại & máy tính phải cùng Wi-Fi).
//   Không dùng "localhost" — điện thoại không hiểu localhost là máy tính của bạn.
// - Đã deploy backend (Render/Railway...): dùng thẳng URL đó, ví dụ
//   "https://her-app-backend.onrender.com/api".

import { Platform } from "react-native";

// Backend đã deploy trên Render — bản web build production (Vercel) dùng URL này.
const PROD_API_URL = "https://her-app-backend-znla.onrender.com/api";

// - Web dev trên máy (npx expo start --web): localhost.
// - Web build thật (Vercel): backend Render.
// - Điện thoại (Expo Go): IP LAN của máy dev — đổi theo Wi-Fi.
export const API_BASE_URL =
  Platform.OS === "web"
    ? (__DEV__ ? "http://localhost:4000/api" : PROD_API_URL)
    : "http://192.168.100.82:4000/api";