import mongoose from "mongoose";

const patientSchema = new mongoose.Schema({
  phone: { type: String, required: true },
  channel: { type: String, required: true },
  chatId: { type: String, required: true, unique: true },
  name: { type: String, default: null },
  age: { type: String, default: null },
  gender: { type: String, default: null },
  createdAt: { type: Date, default: Date.now },
});

export default mongoose.model("Patient", patientSchema);
