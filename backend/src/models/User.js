const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    // Unique CHỈ trong tài khoản chưa xoá — xem index partial cuối file (her-53)
    phone: { type: String, required: true, trim: true },
    email: { type: String, trim: true, lowercase: true },
    passwordHash: { type: String, required: true },
    avatarUrl: { type: String, default: null },
    // 3 tầng quyền: admin (chủ/quản trị cao nhất) > reception (lễ tân — xếp lịch HLV,
    // tạo & quản trị tài khoản) > trainer (HLV, chỉ xem lịch của chính mình).
    // "customer" là khách hàng, không nằm trong 3 tầng quản trị.
    role: { type: String, enum: ["customer", "trainer", "reception", "admin"], default: "customer" },
    // Nếu tài khoản này là HLV, liên kết tới hồ sơ Trainer tương ứng
    trainerId: { type: mongoose.Schema.Types.ObjectId, ref: "Trainer", default: null },
    // Ai đã tạo tài khoản này (vd: lễ tân tạo tài khoản HLV/khách/lễ tân khác).
    // null nghĩa là tài khoản gốc (seed) hoặc khách tự đăng ký.
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    isActive: { type: Boolean, default: true },
    // Đổi/cấp lại mật khẩu -> mọi token cấp TRƯỚC thời điểm này bị vô hiệu (review her-14 A2:
    // kịch bản mất máy — phiên của kẻ cầm máy phải chết khi chủ tài khoản đổi mật khẩu)
    passwordChangedAt: { type: Date, default: null },
    // her-53 (03/09/2026): XOÁ MỀM — deletedAt != null là tài khoản đã xoá: ẩn khỏi mọi danh sách,
    // không đăng nhập được, không thao tác được; booking/gói/lịch sử giữ nguyên (L5). Xoá cũng đặt
    // isActive=false để mọi bộ lọc theo isActive sẵn có tự loại tài khoản đã xoá.
    deletedAt: { type: Date, default: null },
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    // her-57: token Expo Push của các máy đang đăng nhập tài khoản này (nhiều máy = nhiều token).
    // App gửi lên khi đăng nhập/mở app; gỡ khi đăng xuất; server tự rút token chết theo ticket của Expo.
    pushTokens: {
      type: [{ token: { type: String, required: true }, platform: { type: String, default: "" }, updatedAt: { type: Date, default: Date.now } }],
      default: [],
    },
  },
  { timestamps: true }
);

// SĐT duy nhất CHỈ giữa các tài khoản chưa xoá — tài khoản tạo nhầm rồi xoá thì SĐT đó dùng lại
// được. Doc cũ không có field deletedAt vẫn khớp `null` (đã thử MongoDB 7) nên không cần migrate;
// server.js gọi User.syncIndexes() lúc khởi động để thay index unique thường cũ bằng bản này.
userSchema.index({ phone: 1 }, { unique: true, partialFilterExpression: { deletedAt: null } });
// her-57: tìm người nhận thông báo theo vai trò (mỗi lần đặt/hủy) và tìm máy theo token (mỗi lần đăng nhập)
userSchema.index({ role: 1, isActive: 1, deletedAt: 1 });
userSchema.index({ "pushTokens.token": 1 }, { sparse: true });

userSchema.methods.toPublicJSON = function () {
  return {
    id: this._id,
    name: this.name,
    phone: this.phone,
    email: this.email,
    avatarUrl: this.avatarUrl,
    role: this.role,
    trainerId: this.trainerId,
    isActive: this.isActive,
    deletedAt: this.deletedAt || null,
  };
};

module.exports = mongoose.model("User", userSchema);
