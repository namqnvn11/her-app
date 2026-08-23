// Địa chỉ backend — app tự chọn theo môi trường, KHÔNG cần sửa file này khi deploy:
//
// - Web build thật ở Vercel (bản xem tạm cho khách): đặt biến môi trường EXPO_PUBLIC_API_URL trên
//   Vercel = địa chỉ API có HTTPS, ví dụ https://her-studio.duckdns.org/api (trang HTTPS KHÔNG gọi
//   được API HTTP qua IP trần — trình duyệt chặn).
// - Web build đặt cùng máy với API (deploy.sh --with-web): không cần biến, tự gọi "/api" trên
//   chính địa chỉ đang mở.
// - Web dev trên máy (npx expo start --web): backend localhost:4000.
// - Điện thoại (Expo Go): cần địa chỉ tuyệt đối — đặt biến EXPO_PUBLIC_API_URL khi chạy,
//   ví dụ: EXPO_PUBLIC_API_URL=http://1.2.3.4/api npx expo start
//   (máy chủ thật) hoặc IP LAN của máy dev khi test local. Không đặt thì dùng IP LAN bên dưới.

import { Platform } from "react-native";

const ENV_URL = process.env.EXPO_PUBLIC_API_URL; // Expo inline biến EXPO_PUBLIC_* lúc build
const LAN_DEV_URL = "http://192.168.100.82:4000/api"; // IP LAN máy dev — đổi theo Wi-Fi

function pickUrl() {
  if (ENV_URL) return ENV_URL;
  if (Platform.OS === "web") {
    if (__DEV__) return "http://localhost:4000/api";
    return `${window.location.origin}/api`;
  }
  return LAN_DEV_URL;
}

export const API_BASE_URL = pickUrl();
