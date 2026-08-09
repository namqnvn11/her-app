const mongoose = require("mongoose");

async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("Thiếu MONGODB_URI trong file .env — xem .env.example");
  }
  mongoose.set("strictQuery", true);
  await mongoose.connect(uri);
  console.log("[db] Đã kết nối MongoDB");
}

module.exports = connectDB;
