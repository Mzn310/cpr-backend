import mongoose from "mongoose";

const slotSchema = new mongoose.Schema({
  date: { type: String, required: true }, // 'YYYY-MM-DD'
  time: { type: String, required: true },
  doctor: { type: String, required: true },
  status: {
    type: String,
    enum: ["Available", "Pending", "Booked"],
    default: "Available",
  },
  heldAt: { type: Date, default: null },
});

slotSchema.index({ date: 1, time: 1, doctor: 1 }, { unique: true });

export default mongoose.model("Slot", slotSchema);
