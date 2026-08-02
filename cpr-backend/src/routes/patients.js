import { Router } from "express";
import Patient from "../models/Patient.js";

const router = Router();

export async function upsertPatient({ phone, channel, chatId }) {
  const existing = await Patient.findOne({ chatId });
  if (existing) return existing;
  return Patient.create({ phone, channel, chatId });
}

// GET /api/patients/lookup?chat_id=... -> called by the n8n "Lookup Patient" tool
router.get("/lookup", async (req, res) => {
  const { chat_id } = req.query;
  if (!chat_id) return res.status(400).json({ error: "chat_id_required" });
  const patient = await Patient.findOne({ chatId: chat_id });
  if (!patient) return res.status(200).json({ found: false });
  res.json({ found: true, patient });
});

router.get("/", async (req, res) => {
  const patients = await Patient.find().sort({ createdAt: -1 }).limit(200);
  res.json(patients);
});

export default router;
