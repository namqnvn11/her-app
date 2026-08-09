const mongoose = require("mongoose");

const trainerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    specialty: { type: String, default: "" },
    avatarUrl: { type: String, default: null },
    rating: { type: Number, default: 5 },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Trainer", trainerSchema);
