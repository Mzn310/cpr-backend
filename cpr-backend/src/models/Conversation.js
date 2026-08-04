import mongoose from "mongoose";

const conversationSchema = new mongoose.Schema({
  chatId: { type: String, required: true, unique: true },
  state: { type: String, default: "idle" },
  pendingData: { type: String, default: "" },
  processedMessageIds: { type: [String], default: [] }, // <-- add this
  lastUpdated: { type: Date, default: Date.now },
});

export default mongoose.model("Conversation", conversationSchema);
