import { Router } from 'express';
import Stripe from 'stripe';
import Payment from '../models/Payment.js';
import { createBooking } from './bookings.js';

const router = Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Point Stripe's webhook directly at this endpoint (not at n8n) so the
// signature can be verified.
router.post('/stripe', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook signature verification failed: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    if (session.payment_status !== 'paid') return res.json({ ok: true, ignored: true });

    // Idempotency: Stripe may deliver the same event more than once.
    const existing = await Payment.findOne({ stripeSessionId: session.id });
    if (existing) return res.json({ ok: true, duplicate: true });

    await Payment.create({
      stripeSessionId: session.id,
      chatId: session.metadata.chat_id,
      amountTotal: session.amount_total,
      currency: session.currency,
      status: 'paid'
    });

    try {
      await createBooking({
        phone: session.metadata.patient_phone,
        channel: session.metadata.channel,
        chatId: session.metadata.chat_id,
        slotId: session.metadata.slot_id,
        paymentRef: session.id
      });
    } catch (e) {
      console.error('Booking creation failed after payment:', e.message, session.id);
    }
  }

  res.json({ received: true });
});

export default router;
