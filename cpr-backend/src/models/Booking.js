import mongoose from 'mongoose';

const bookingSchema = new mongoose.Schema({
  patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true },
  slotId: { type: mongoose.Schema.Types.ObjectId, ref: 'Slot', required: true },
  status: { type: String, enum: ['Confirmed', 'Cancelled'], default: 'Confirmed' },
  paymentRef: { type: String, default: null },
  confirmedAt: { type: Date, default: Date.now }
});

export default mongoose.model('Booking', bookingSchema);
