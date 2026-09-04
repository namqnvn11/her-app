// her-61 (04/09/2026): ảnh đại diện lưu FILE trên đĩa máy chủ (chốt 04/09 — không S3, không Mongo).
// UPLOAD_DIR (env) trỏ ra NGOÀI thư mục code để deploy/dựng lại code không mất ảnh; dev/test mặc định
// backend/uploads (đã .gitignore). Ảnh phát qua /uploads/... (dev: express.static; prod: nginx alias).
const fs = require("node:fs");
const path = require("node:path");

const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, "..", "..", "uploads"));
const AVATAR_DIR = path.join(UPLOAD_DIR, "avatars");
const AVATAR_MAX_BYTES = 10 * 1024 * 1024; // ảnh gốc điện thoại 3–8 MB; app thu nhỏ trước nhưng server vẫn nhận tới 10 MB

function ensureUploadDirs() {
  fs.mkdirSync(AVATAR_DIR, { recursive: true });
}

// Nhận diện theo MAGIC BYTES — không tin mimetype/tên file client gửi (D8)
function sniffImage(buf) {
  if (!buf || buf.length < 8) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 && buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) return "png";
  return null;
}

// Ghi ảnh đại diện của user (ghi đè — tên file = ObjectId của chính user), trả đường dẫn TƯƠNG ĐỐI.
// Ghi vào file tạm rồi rename để không bao giờ phát ra ảnh ghi dở.
async function saveAvatar(userId, buf) {
  ensureUploadDirs();
  const ext = sniffImage(buf);
  if (!ext) throw new Error("Ảnh phải là JPG hoặc PNG");
  const base = String(userId);
  // Xoá đuôi cũ khác loại (đổi PNG -> JPG) để không tồn 2 file
  for (const old of ["jpg", "png"]) {
    if (old !== ext) await fs.promises.rm(path.join(AVATAR_DIR, `${base}.${old}`), { force: true });
  }
  const final = path.join(AVATAR_DIR, `${base}.${ext}`);
  const tmp = `${final}.${process.pid}.${Date.now()}.tmp`;
  await fs.promises.writeFile(tmp, buf);
  await fs.promises.rename(tmp, final);
  return `/uploads/avatars/${base}.${ext}?v=${Date.now()}`;
}

async function removeAvatar(userId) {
  const base = String(userId);
  for (const ext of ["jpg", "png"]) await fs.promises.rm(path.join(AVATAR_DIR, `${base}.${ext}`), { force: true });
}

module.exports = { UPLOAD_DIR, AVATAR_DIR, AVATAR_MAX_BYTES, ensureUploadDirs, sniffImage, saveAvatar, removeAvatar };
