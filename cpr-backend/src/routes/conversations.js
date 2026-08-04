import { Router } from "express";
import Conversation from "../models/Conversation.js";

const router = Router();

// GET /api/conversations?state=paused_human -> admin panel "human handoff" tab
router.get("/", async (req, res) => {
  const { state } = req.query;
  const filter = state ? { state } : {};
  const convs = await Conversation.find(filter)
    .sort({ lastUpdated: -1 })
    .limit(200);
  res.json(convs);
});

router.get("/:chatId", async (req, res) => {
  const conv = await Conversation.findOne({ chatId: req.params.chatId });
  res.json(
    conv || { chatId: req.params.chatId, state: "idle", pendingData: "" },
  );
});

router.put("/:chatId", async (req, res) => {
  const { state, pendingData } = req.body;
  await Conversation.findOneAndUpdate(
    { chatId: req.params.chatId },
    {
      $set: {
        state: state || "idle",
        pendingData: pendingData || "",
        lastUpdated: new Date(),
      },
    },
    { upsert: true },
  );
  res.json({ ok: true });
});

// Used by the admin panel's "Resume bot" button
router.post("/:chatId/resume", async (req, res) => {
  await Conversation.findOneAndUpdate(
    { chatId: req.params.chatId },
    { $set: { state: "idle", pendingData: "", lastUpdated: new Date() } },
    { upsert: true },
  );
  res.json({ ok: true });
});

router.post("/:chatId/check-message", async (req, res) => {
  const { message_id } = req.body;
  const conv = await Conversation.findOneAndUpdate(
    { chatId: req.params.chatId, processedMessageIds: { $ne: message_id } },
    { $push: { processedMessageIds: { $each: [message_id], $slice: -50 } } },
    { new: true },
  );
  res.json({ isDuplicate: !conv });
});

export default router;
