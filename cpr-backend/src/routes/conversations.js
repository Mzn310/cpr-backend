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

// POST /api/conversations/:chatId/check-message  { message_id }
// Called by n8n right after WhatsApp Trigger, before any other processing.
// Returns { isDuplicate: true } if this message_id was already processed
// for this chatId, so the workflow can stop and avoid double-execution.
router.post("/:chatId/check-message", async (req, res) => {
  const { message_id } = req.body;
  if (!message_id) {
    return res.status(400).json({ error: "message_id_required" });
  }

  try {
    // upsert: true -> if this is a brand-new conversation (no document yet),
    // create it and record the message id. Without upsert, findOneAndUpdate
    // returns null for a conversation that doesn't exist yet, which was
    // wrongly being read as "isDuplicate: true" and silently dropping every
    // first message of every new conversation.
    const conv = await Conversation.findOneAndUpdate(
      { chatId: req.params.chatId, processedMessageIds: { $ne: message_id } },
      { $push: { processedMessageIds: { $each: [message_id], $slice: -50 } } },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );
    res.json({ isDuplicate: !conv });
  } catch (e) {
    // Race condition: two near-simultaneous first messages for the same
    // chatId both try to upsert-create the document. The unique index on
    // chatId throws E11000 for the loser — that message genuinely is a
    // duplicate delivery, so treat it as one instead of erroring out.
    if (e.code === 11000) {
      return res.json({ isDuplicate: true });
    }
    res.status(500).json({ error: e.message });
  }
});

export default router;
