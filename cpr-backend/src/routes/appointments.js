import { Router } from 'express';
import { requireApiKey } from '../middleware/auth.js';
import { createBooking } from './bookings.js';

const router = Router();

// Replaces the placeholder "https://api.your-clinic-system.com/v1/appointments"
// that n8n's node 30 was calling.
router.post('/', requireApiKey('CLINIC_API_KEY'), async (req, res) => {
  try {
    const { patient, slot_id, deposit } = req.body;
    const booking = await createBooking({
      phone: patient?.phone,
      channel: patient?.channel,
      chatId: patient?.chat_id,
      slotId: slot_id,
      paymentRef: deposit?.reference
    });
    res.status(201).json({ success: true, id: booking._id });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

export default router;
