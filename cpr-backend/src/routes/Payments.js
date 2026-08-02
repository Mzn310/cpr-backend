import { Router } from "express";
import Slot from "../models/Slot.js";

const router = Router();

const TAP_SECRET_KEY = process.env.TAP_SECRET_KEY; // sk_live_xxx / sk_test_xxx from Tap dashboard
const TAP_API_BASE = "https://api.tap.company/v2";

// Tap operates across Saudi, Qatar, Kuwait, Bahrain, UAE, Oman with one
// integration - set the merchant's default currency here (SAR for Saudi,
// QAR for Qatar, etc). Tap will still surface locally relevant methods
// (mada, KNET, Benefit...) based on the customer's card/device even if the
// charge currency itself is fixed.
const DEPOSIT_CURRENCY = process.env.DEPOSIT_CURRENCY || "SAR";
// Tap's API always expects amount as a plain decimal number (e.g. 50 or
// 50.5), not smallest-unit integers like Stripe used.
const DEPOSIT_AMOUNT = Number(process.env.DEPOSIT_AMOUNT || 50);

// POST /api/payments/checkout-session
// Body: { slot_id, patient_phone, chat_id, channel }
// Called by the n8n "Create Payment Link" tool. Holds the slot for 65
// minutes (matches the auto-release window in slots.js) so it can't be
// double-booked while the patient is paying.
router.post("/checkout-session", async (req, res) => {
  const { slot_id, patient_phone, chat_id, channel } = req.body;
  if (!slot_id || !chat_id)
    return res.status(400).json({ error: "slot_id_and_chat_id_required" });

  const slot = await Slot.findOneAndUpdate(
    { _id: slot_id, status: "Available" },
    { $set: { status: "Pending", heldAt: new Date() } },
    { new: true },
  );
  if (!slot) return res.status(409).json({ error: "slot_not_available" });

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
        customer: { phone: { number: patient_phone || "" } },
        // src_all lets Tap show every locally relevant method (mada, cards,
        // Apple Pay, KNET, Benefit, etc.) based on the customer's country.
        source: { id: "src_all" },
        redirect: {
          url:
            process.env.PAYMENT_REDIRECT_URL ||
            "https://example.com/payment-complete",
        },
        // Tap calls this URL server-to-server once the payment settles -
        // point it at the /api/webhooks/tap route.
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
    // Release the hold if we failed to create the charge, otherwise the
    // slot stays stuck as Pending until the 65-minute cleanup runs.
    await Slot.findByIdAndUpdate(slot._id, {
      $set: { status: "Available", heldAt: null },
    });
    res.status(400).json({ error: e.message });
  }
});

export default router;
