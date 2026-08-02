import { Router } from "express";
import Case from "../models/Case.js";

const router = Router();

router.post("/", async (req, res) => {
  try {
    const { chat_id, phone, image_id, description } = req.body;
    const c = await Case.create({
      chatId: chat_id,
      phone,
      imageId: image_id,
      description,
    });
    res.status(201).json({ success: true, id: c._id });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get("/", async (req, res) => {
  const cases = await Case.find().sort({ createdAt: -1 }).limit(200);
  res.json(cases);
});

export default router;
