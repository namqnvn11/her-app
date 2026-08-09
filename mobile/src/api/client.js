import { API_BASE_URL } from "../config";

let currentToken = null;

// AuthContext gọi hàm này mỗi khi token thay đổi (đăng nhập/đăng xuất/khôi phục session)
export function setAuthToken(token) {
  currentToken = token;
}

// AuthContext đăng ký hàm này để tự ĐĂNG XUẤT khi phiên không còn dùng được giữa chừng
// (token hết hạn -> 401, hoặc tài khoản bị khoá -> 403) — không để app "kẹt" với lỗi đỏ
let onSessionInvalid = null;
export function setSessionInvalidHandler(fn) {
  onSessionInvalid = fn;
}

async function request(path, { method = "GET", body, query } = {}) {
  let url = `${API_BASE_URL}${path}`;
  if (query) {
    const qs = Object.entries(query)
      .filter(([, v]) => v !== undefined && v !== null && v !== "")
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join("&");
    if (qs) url += `?${qs}`;
  }

  const headers = { "Content-Type": "application/json" };
  if (currentToken) headers.Authorization = `Bearer ${currentToken}`;

  let res;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new Error(
      "Không kết nối được tới server. Kiểm tra lại API_BASE_URL trong src/config.js và mạng Wi-Fi."
    );
  }

  const isJson = res.headers.get("content-type")?.includes("application/json");
  const data = isJson ? await res.json() : null;

  if (!res.ok) {
    const error = new Error(data?.error || `Lỗi ${res.status}`);
    error.status = res.status; // để nơi gọi phân biệt "server từ chối" với "lỗi mạng" (không có status)
    // Phiên chết giữa chừng: token hết hạn (401) hoặc tài khoản bị khoá (403 từ middleware).
    // Chỉ kích hoạt khi ĐANG có token — 401 của màn login không tính.
    if (
      currentToken &&
      onSessionInvalid &&
      (res.status === 401 || (res.status === 403 && (data?.error || "").includes("bị khoá")))
    ) {
      onSessionInvalid(error);
    }
    throw error;
  }
  if (data === null) {
    // 200 nhưng không phải JSON (vd Wi-Fi captive portal trả HTML) — báo như lỗi kết nối
    throw new Error("Máy chủ trả về dữ liệu không hợp lệ. Kiểm tra API_BASE_URL trong src/config.js và mạng Wi-Fi.");
  }
  return data;
}

export const api = {
  get: (path, query) => request(path, { method: "GET", query }),
  post: (path, body) => request(path, { method: "POST", body }),
  patch: (path, body) => request(path, { method: "PATCH", body }),
  delete: (path) => request(path, { method: "DELETE" }),
};
