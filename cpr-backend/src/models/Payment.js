import mongoose from 'mongoose';

const paymentSchema = new mongoose.Schema({
  stripeSessionId: { type: String, required: true, unique: true },
  chatId: { type: String, required: true },
  amountTotal: Number,
  currency: String,
  status: { type: String, default: 'pending' },
  createdAt: { type: Date, default: Date.now }
});

export default mongoose.model('Payment', paymentSchema);
