import { Router } from "express";
import crypto from "crypto";
import Payment from "../models/Payment.js";
import { createBooking } from "./bookings.js";

const router = Router();

// Currencies that use 3 decimal places instead of 2 (per Tap docs / ISO 4217).
const THREE_DECIMAL_CURRENCIES = new Set(["BHD", "KWD", "OMR", "JOD"]);

function formatAmount(amount, currency) {
  const decimals = THREE_DECIMAL_CURRENCIES.has(currency) ? 3 : 2;
  return Number(amount).toFixed(decimals);
}

// POST /api/webhooks/tap
function verifyTapHashstring(body, secretKey) {
  const amount = formatAmount(body.amount, body.currency);
  const gatewayRef = body.reference?.gateway ?? "";
  const paymentRef = body.reference?.payment ?? "";
  const created = body.transaction?.created ?? "";

  const toBeHashed =
    "x_id" +
    body.id +
    "x_amount" +
    amount +
    "x_currency" +
    body.currency +
    "x_gateway_reference" +
    gatewayRef +
    "x_payment_reference" +
    paymentRef +
    "x_status" +
    body.status +
    "x_created" +
    created;

  return crypto
    .createHmac("sha256", secretKey)
    .update(toBeHashed)
    .digest("hex");
}

router.post("/tap", async (req, res) => {
  const body = req.body;
  const postedHash = req.header("hashstring") || body.hashstring;
  const expectedHash = verifyTapHashstring(body, process.env.TAP_SECRET_KEY);

  if (!postedHash || postedHash !== expectedHash) {
    console.error("Tap webhook hashstring mismatch", {
      id: body?.id,
      status: body?.status,
    });
    return res.status(401).json({ error: "invalid_hashstring" });
  }

  if (body.status !== "CAPTURED") {
    return res.json({ ok: true, ignored: true, status: body.status });
  }

  const existing = await Payment.findOne({ stripeSessionId: body.id });
  if (existing) return res.json({ ok: true, duplicate: true });

  await Payment.create({
    stripeSessionId: body.id,
    chatId: body.metadata?.chat_id,
    amountTotal: body.amount,
    currency: body.currency,
    status: "paid",
  });

  try {
    await createBooking({
      phone: body.metadata?.patient_phone,
      channel: body.metadata?.channel,
      chatId: body.metadata?.chat_id,
      slotId: body.metadata?.slot_id,
      paymentRef: body.id,
    });
  } catch (e) {
    console.error(
      "Booking creation failed after Tap payment:",
      e.message,
      body.id,
    );
  }

  res.json({ received: true });
});

export default router;
