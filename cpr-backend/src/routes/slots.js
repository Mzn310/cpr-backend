import { Router } from 'express';
import Slot from '../models/Slot.js';

const router = Router();
const STALE_MINUTES = 65; // matches the Stripe checkout session expiry used by n8n

// Automatically frees up slots whose payment link was created but never paid.
export async function releaseStalePending() {
  const cutoff = new Date(Date.now() - STALE_MINUTES * 60 * 1000);
  await Slot.updateMany(
    { status: 'Pending', heldAt: { $lt: cutoff } },
    { $set: { status: 'Available', heldAt: null } }
  );
}

// GET /api/slots?status=Available
router.get('/', async (req, res) => {
  await releaseStalePending();
  const status = req.query.status || 'Available';
  const today = new Date().toISOString().slice(0, 10);
  const slots = await Slot.find({ status, date: { $gte: today } })
    .sort({ date: 1, time: 1 })
    .limit(20);
  res.json(slots);
});

// POST /api/slots/:id/hold
// Atomic: findOneAndUpdate only matches a document that is still Available,
// so two simultaneous requests can never both succeed for the same slot.
router.post('/:id/hold', async (req, res) => {
  await releaseStalePending();
  const slot = await Slot.findOneAndUpdate(
    { _id: req.params.id, status: 'Available' },
    { $set: { status: 'Pending', heldAt: new Date() } },
    { new: true }
  );
  if (!slot) return res.status(409).json({ error: 'slot_not_available' });
  res.json(slot);
});

router.post('/:id/release', async (req, res) => {
  await Slot.findByIdAndUpdate(req.params.id, { $set: { status: 'Available', heldAt: null } });
  res.json({ ok: true });
});

// POST /api/slots  (admin: add new availability)
router.post('/', async (req, res) => {
  const { date, time, doctor } = req.body;
  if (!date || !time || !doctor) return res.status(400).json({ error: 'missing_fields' });
  try {
    const slot = await Slot.create({ date, time, doctor });
    res.status(201).json(slot);
  } catch (e) {
    res.status(409).json({ error: 'slot_exists_or_invalid' });
  }
});

router.delete('/:id', async (req, res) => {
  await Slot.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

export default router;
