import { Router } from "express";
import { requireApiKey } from "../middleware/auth.js";
import { createBooking } from "./bookings.js";

const router = Router();

router.post("/", requireApiKey("CLINIC_API_KEY"), async (req, res) => {
  try {
    const { phone, channel, chat_id, slot_id, payment_ref } = req.body;
    const booking = await createBooking({
      phone,
      channel,
      chatId: chat_id,
      slotId: slot_id,
      paymentRef: payment_ref || null,
    });
    res.status(201).json({ success: true, id: booking._id });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

export default router;
