const mongoose = require("mongoose");

const ptSlotSchema = new mongoose.Schema(
  {
    trainerId: { type: mongoose.Schema.Types.ObjectId, ref: "Trainer", required: true },
    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true },
    isBooked: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Query khung giờ trống theo thời gian và theo HLV
ptSlotSchema.index({ isBooked: 1, startAt: 1 });
ptSlotSchema.index({ trainerId: 1, startAt: 1 });

module.exports = mongoose.model("PTSlot", ptSlotSchema);
