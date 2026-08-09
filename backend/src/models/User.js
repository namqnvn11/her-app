const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, unique: true, trim: true },
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
  },
  { timestamps: true }
);

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
  };
};

module.exports = mongoose.model("User", userSchema);
