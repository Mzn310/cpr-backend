import { Router } from "express";
import Slot from "../models/Slot.js";

const router = Router();

const TAP_SECRET_KEY = process.env.TAP_SECRET_KEY;
const TAP_API_BASE = "https://api.tap.company/v2";

const DEPOSIT_CURRENCY = process.env.DEPOSIT_CURRENCY || "SAR";
const DEPOSIT_AMOUNT = Number(process.env.DEPOSIT_AMOUNT || 50);

// POST /api/payments/checkout-session
router.post("/checkout-session", async (req, res) => {
  const { slot_id, patient_phone, patient_name, chat_id, channel } = req.body;
  if (!slot_id || !chat_id)
    return res.status(400).json({ error: "slot_id_and_chat_id_required" });

  const slot = await Slot.findOneAndUpdate(
    { _id: slot_id, status: "Available" },
    { $set: { status: "Pending", heldAt: new Date() } },
    { new: true },
  );
  if (!slot) return res.status(409).json({ error: "slot_not_available" });

  const nameParts = (patient_name || "Patient").trim().split(/\s+/);
  const first_name = nameParts[0];
  const last_name = nameParts.slice(1).join(" ") || first_name;

  try {
    const tapRes = await fetch(`${TAP_API_BASE}/charges`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TAP_SECRET_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        amount: DEPOSIT_AMOUNT,
        currency: DEPOSIT_CURRENCY,
        threeDSecure: true,
        save_card: false,
        description: `Appointment deposit - ${slot.date} ${slot.time}`,
        customer: {
          first_name,
          last_name,
          phone: { number: patient_phone || "" },
        },
        source: { id: "src_all" },
        redirect: {
          url:
            process.env.PAYMENT_REDIRECT_URL ||
            "https://example.com/payment-complete",
        },
        post: { url: process.env.TAP_WEBHOOK_URL },
        reference: {
          transaction: `${chat_id}-${Date.now()}`,
          order: String(slot._id),
        },
        metadata: {
          slot_id: String(slot_id),
          chat_id,
          patient_phone: patient_phone || "",
          channel: channel || "whatsapp",
        },
      }),
    });

    const charge = await tapRes.json();
    if (!tapRes.ok || !charge.transaction?.url) {
      throw new Error(
        charge.errors?.[0]?.description || "tap_charge_creation_failed",
      );
    }

    res.json({
      url: charge.transaction.url,
      expires_in_minutes: 60,
      charge_id: charge.id,
    });
  } catch (e) {
    await Slot.findByIdAndUpdate(slot._id, {
      $set: { status: "Available", heldAt: null },
    });
    res.status(400).json({ error: e.message });
  }
});

export default router;
