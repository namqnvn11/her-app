import { API_BASE_URL } from "../config";

// her-61: server lưu avatarUrl dạng TƯƠNG ĐỐI ("/uploads/avatars/<id>.jpg?v=...") — ghép với gốc
// của API (bỏ đuôi "/api") để ra địa chỉ ảnh đầy đủ. URL tuyệt đối (dữ liệu cũ/ngoài) giữ nguyên.
const ORIGIN = API_BASE_URL.replace(/\/api\/?$/, "");
export function avatarUri(url) {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  return `${ORIGIN}${url.startsWith("/") ? "" : "/"}${url}`;
}
