import { Router } from 'express';
import mongoose from 'mongoose';
import Slot from '../models/Slot.js';
import Booking from '../models/Booking.js';
import { upsertPatient } from './patients.js';

const router = Router();

// Creates a confirmed booking and marks the slot Booked inside a
// MongoDB transaction (requires a replica set - Atlas provides this
// by default, even on the free tier).
export async function createBooking({ phone, channel, chatId, slotId, paymentRef }) {
  const patient = await upsertPatient({ phone, channel, chatId });
  const session = await mongoose.startSession();
  try {
    let booking;
    await session.withTransaction(async () => {
      const slot = await Slot.findById(slotId).session(session);
      if (!slot) throw new Error('slot_not_found');
      slot.status = 'Booked';
      slot.heldAt = null;
      await slot.save({ session });
      const created = await Booking.create(
        [{ patientId: patient._id, slotId, paymentRef: paymentRef || null }],
        { session }
      );
      booking = created[0];
    });
    return booking;
  } finally {
    session.endSession();
  }
}

router.get('/', async (req, res) => {
  const bookings = await Booking.find()
    .populate('patientId')
    .populate('slotId')
    .sort({ confirmedAt: -1 })
    .limit(200);
  const shaped = bookings.map((b) => ({
    id: b._id,
    status: b.status,
    paymentRef: b.paymentRef,
    confirmedAt: b.confirmedAt,
    phone: b.patientId?.phone,
    channel: b.patientId?.channel,
    chatId: b.patientId?.chatId,
    date: b.slotId?.date,
    time: b.slotId?.time,
    doctor: b.slotId?.doctor
  }));
  res.json(shaped);
});

router.post('/', async (req, res) => {
  try {
    const booking = await createBooking(req.body);
    res.status(201).json(booking);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

export default router;
