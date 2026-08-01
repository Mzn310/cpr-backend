import { Router } from 'express';
import Patient from '../models/Patient.js';

const router = Router();

export async function upsertPatient({ phone, channel, chatId }) {
  const existing = await Patient.findOne({ chatId });
  if (existing) return existing;
  return Patient.create({ phone, channel, chatId });
}

router.get('/', async (req, res) => {
  const patients = await Patient.find().sort({ createdAt: -1 }).limit(200);
  res.json(patients);
});

export default router;
