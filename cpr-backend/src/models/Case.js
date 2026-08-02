import mongoose from "mongoose";

const caseSchema = new mongoose.Schema({
  chatId: { type: String, required: true },
  phone: { type: String, required: true },
  imageId: { type: String, required: true },
  description: { type: String, required: true },
  status: { type: String, default: "sent_to_doctor" },
  createdAt: { type: Date, default: Date.now },
});

export default mongoose.model("Case", caseSchema);
