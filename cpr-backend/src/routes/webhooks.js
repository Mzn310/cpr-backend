import { Router } from "express";
import crypto from "crypto";
import axios from "axios";
import Payment from "../models/Payment.js";
import Slot from "../models/Slot.js";
import { createBooking } from "./bookings.js";

const router = Router();

const TAP_SECRET_KEY = process.env.TAP_SECRET_KEY;
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL;
const CLINIC_WHATSAPP_NUMBER = process.env.CLINIC_WHATSAPP_NUMBER;

// Currencies with 3 decimal places
const THREE_DECIMAL_CURRENCIES = new Set(["BHD", "KWD", "OMR", "JOD"]);

function formatAmount(amount, currency) {
  const decimals = THREE_DECIMAL_CURRENCIES.has(currency) ? 3 : 2;
  return Number(amount).toFixed(decimals);
}

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

// ===============================
// WHATSAPP MESSAGES
// ===============================

function buildPaymentSuccessMessage({ date, time, doctor }) {
  let message = `تم الدفع بنجاح ✅\n\nتم تأكيد موعدك`;

  if (doctor) {
    message += ` مع الدكتور ${doctor}`;
  }

  if (date) {
    message += `\nالتاريخ: ${date}`;
  }

  if (time) {
    message += `\nالوقت: ${time}`;
  }

  message += `\n\nنشكرك على ثقتك، في انتظارك!`;

  return message;
}

function buildPaymentFailedMessage({ status }) {
  let reason = "لم يتم إتمام عملية الدفع.";

  if (status === "DECLINED") {
    reason = "تم رفض عملية الدفع من البنك.";
  } else if (status === "FAILED") {
    reason = "فشلت عملية الدفع.";
  } else if (status === "CANCELLED") {
    reason = "تم إلغاء عملية الدفع.";
  } else if (status === "ABORTED") {
    reason = "تم إيقاف عملية الدفع.";
  }

  return (
    `تعذر إتمام عملية الدفع ❌\n\n` +
    `${reason}\n\n` +
    `يمكنك المحاولة مرة أخرى لإتمام حجز موعدك.`
  );
}

// ===============================
// SEND MESSAGE TO N8N
// ===============================

async function notifyN8n({
  to,
  chatId,
  message,
  paymentStatus,
  paymentId,
  amount,
  currency,
  bookingId = null,
}) {
  if (!N8N_WEBHOOK_URL) {
    throw new Error("N8N_WEBHOOK_URL is not configured");
  }

  await axios.post(N8N_WEBHOOK_URL, {
    from: CLINIC_WHATSAPP_NUMBER,
    to,
    chatId,
    message,

    payment: {
      id: paymentId,
      status: paymentStatus,
      amount,
      currency,
    },

    booking_id: bookingId,
  });
}

// ===============================
// TAP WEBHOOK
// ===============================

router.post("/tap", async (req, res) => {
  const body = req.body;

  try {
    console.log("=================================");
    console.log("TAP WEBHOOK RECEIVED");
    console.log("Payment ID:", body?.id);
    console.log("Status:", body?.status);
    console.log("Amount:", body?.amount);
    console.log("Currency:", body?.currency);
    console.log("=================================");

    // ---------------------------------
    // 1. VERIFY TAP WEBHOOK
    // ---------------------------------

    if (!TAP_SECRET_KEY) {
      console.error("TAP_SECRET_KEY is missing");

      return res.status(500).json({
        error: "tap_secret_key_not_configured",
      });
    }

    const postedHash = req.header("hashstring") || body?.hashstring;

    const expectedHash = verifyTapHashstring(body, TAP_SECRET_KEY);

    if (!postedHash || postedHash !== expectedHash) {
      console.error("Tap webhook hashstring mismatch", {
        id: body?.id,
        status: body?.status,
      });

      return res.status(401).json({
        error: "invalid_hashstring",
      });
    }

    // ---------------------------------
    // 2. GET PAYMENT INFORMATION
    // ---------------------------------

    const paymentId = body.id;
    const paymentStatus = body.status;

    const patientPhone = body.metadata?.patient_phone;

    const chatId = body.metadata?.chat_id;

    const slotId = body.metadata?.slot_id;

    const channel = body.metadata?.channel || "whatsapp";

    // ---------------------------------
    // 3. SUCCESSFUL PAYMENT
    // ---------------------------------

    if (paymentStatus === "CAPTURED") {
      console.log(`Payment ${paymentId} CAPTURED`);

      // Check duplicate webhook
      const existingPayment = await Payment.findOne({
        stripeSessionId: paymentId,
      });

      if (existingPayment) {
        console.log("Payment already processed:", paymentId);

        return res.json({
          ok: true,
          duplicate: true,
        });
      }

      // ---------------------------------
      // 4. SAVE PAYMENT
      // ---------------------------------

      const payment = await Payment.create({
        stripeSessionId: paymentId,
        chatId,
        amountTotal: body.amount,
        currency: body.currency,
        status: "paid",
      });

      console.log("Payment saved:", payment._id);

      // ---------------------------------
      // 5. CREATE BOOKING
      // ---------------------------------

      try {
        const booking = await createBooking({
          phone: patientPhone,
          channel,
          chatId,
          slotId,
          paymentRef: paymentId,
        });

        console.log("Booking created:", booking._id);

        // ---------------------------------
        // 6. GET SLOT
        // ---------------------------------

        const slot = await Slot.findById(booking.slotId);

        // ---------------------------------
        // 7. BUILD SUCCESS MESSAGE
        // ---------------------------------

        const message = buildPaymentSuccessMessage({
          date: slot?.date,
          time: slot?.time,
          doctor: slot?.doctor,
        });

        // ---------------------------------
        // 8. SEND TO N8N
        // ---------------------------------

        try {
          await notifyN8n({
            to: patientPhone,
            chatId,
            message,
            paymentStatus: "CAPTURED",
            paymentId,
            amount: body.amount,
            currency: body.currency,
            bookingId: booking._id,
          });

          console.log("SUCCESS WhatsApp notification sent to n8n");
        } catch (notifyError) {
          console.error(
            "n8n success notification failed:",
            notifyError.message,
          );
        }
      } catch (bookingError) {
        console.error("Booking creation failed:", bookingError.message);

        // Important:
        // Payment was successful even if booking creation failed.
        // Do NOT tell the patient that payment failed.

        try {
          await notifyN8n({
            to: patientPhone,
            chatId,
            message:
              "تم استلام الدفع بنجاح ✅\n\n" +
              "حدث خطأ أثناء تأكيد الموعد. " +
              "سيقوم فريقنا بالتواصل معك قريبًا.",
            paymentStatus: "CAPTURED_BOOKING_ERROR",
            paymentId,
            amount: body.amount,
            currency: body.currency,
          });
        } catch (notifyError) {
          console.error(
            "Booking error notification failed:",
            notifyError.message,
          );
        }
      }

      return res.json({
        received: true,
        status: "CAPTURED",
      });
    }

    // ---------------------------------
    // 9. FAILED PAYMENT
    // ---------------------------------

    const failedStatuses = [
      "FAILED",
      "DECLINED",
      "CANCELLED",
      "ABORTED",
      "VOID",
    ];

    if (failedStatuses.includes(paymentStatus)) {
      console.log(`Payment ${paymentId} failed: ${paymentStatus}`);

      const message = buildPaymentFailedMessage({
        status: paymentStatus,
      });

      try {
        await notifyN8n({
          to: patientPhone,
          chatId,
          message,
          paymentStatus,
          paymentId,
          amount: body.amount,
          currency: body.currency,
        });

        console.log("FAILED WhatsApp notification sent to n8n");
      } catch (notifyError) {
        console.error(
          "n8n failed-payment notification failed:",
          notifyError.message,
        );
      }

      return res.json({
        received: true,
        status: paymentStatus,
      });
    }

    // ---------------------------------
    // 10. OTHER TAP STATUSES
    // ---------------------------------

    console.log("Unhandled Tap payment status:", paymentStatus);

    return res.json({
      received: true,
      ignored: true,
      status: paymentStatus,
    });
  } catch (error) {
    console.error("Tap webhook processing error:", error);

    return res.status(500).json({
      error: "webhook_processing_failed",
    });
  }
});

export default router;
