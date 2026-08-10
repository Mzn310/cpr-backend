import { Router } from "express";
import Slot from "../models/Slot.js";

const router = Router();
const STALE_MINUTES = 65;

const WORKING_HOURS_START = "09:00";
const WORKING_HOURS_END = "20:00";

function isWithinWorkingHours(time) {
  return time >= WORKING_HOURS_START && time <= WORKING_HOURS_END;
}

function generateDailyTimes() {
  const times = [];
  let [h, m] = WORKING_HOURS_START.split(":").map(Number);
  const [endH, endM] = WORKING_HOURS_END.split(":").map(Number);
  while (h < endH || (h === endH && m <= endM)) {
    times.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    m += 30;
    if (m >= 60) {
      m = 0;
      h += 1;
    }
  }
  return times;
}

export async function releaseStalePending() {
  const cutoff = new Date(Date.now() - STALE_MINUTES * 60 * 1000);
  await Slot.updateMany(
    { status: "Pending", heldAt: { $lt: cutoff } },
    { $set: { status: "Available", heldAt: null } },
  );
}

// GET /api/slots?status=Available&date=YYYY-MM-DD
router.get("/", async (req, res) => {
  await releaseStalePending();
  const status = req.query.status || "Available";
  const today = new Date().toISOString().slice(0, 10);
  const filter = { status, date: { $gte: today } };
  if (req.query.date) filter.date = req.query.date;
  const slots = await Slot.find(filter).sort({ date: 1, time: 1 }).limit(50);
  res.json(slots);
});

router.post("/:id/hold", async (req, res) => {
  await releaseStalePending();
  const slot = await Slot.findOneAndUpdate(
    { _id: req.params.id, status: "Available" },
    { $set: { status: "Pending", heldAt: new Date() } },
    { new: true },
  );
  if (!slot) return res.status(409).json({ error: "slot_not_available" });
  res.json(slot);
});

router.post("/:id/release", async (req, res) => {
  await Slot.findByIdAndUpdate(req.params.id, {
    $set: { status: "Available", heldAt: null },
  });
  res.json({ ok: true });
});

// POST /api/slots (admin: add a single slot) — rejects anything outside 9:00-20:00
router.post("/", async (req, res) => {
  const { date, time, doctor } = req.body;
  if (!date || !time || !doctor)
    return res.status(400).json({ error: "missing_fields" });
  if (!isWithinWorkingHours(time)) {
    return res.status(400).json({
      error: "outside_working_hours",
      allowed: `${WORKING_HOURS_START}-${WORKING_HOURS_END}`,
    });
  }
  try {
    const slot = await Slot.create({ date, time, doctor });
    res.status(201).json(slot);
  } catch (e) {
    res.status(409).json({ error: "slot_exists_or_invalid" });
  }
});

// POST /api/slots/generate  { doctor, days }
router.post("/generate", async (req, res) => {
  const { doctor, days } = req.body;
  if (!doctor) return res.status(400).json({ error: "doctor_required" });
  const numDays = Number(days) || 7;
  const times = generateDailyTimes();
  let createdCount = 0;
  let skippedCount = 0;
  for (let d = 0; d < numDays; d++) {
    const date = new Date();
    date.setDate(date.getDate() + d);
    const dateStr = date.toISOString().slice(0, 10);
    for (const time of times) {
      try {
        await Slot.create({ date: dateStr, time, doctor });
        createdCount++;
      } catch (e) {
        skippedCount++;
      }
    }
  }
  res.json({ created: createdCount, skipped: skippedCount });
});

// One-off cleanup of any existing out-of-hours slots.
router.post("/cleanup-out-of-hours", async (req, res) => {
  const result = await Slot.deleteMany({
    status: "Available",
    $or: [
      { time: { $lt: WORKING_HOURS_START } },
      { time: { $gt: WORKING_HOURS_END } },
    ],
  });
  res.json({ deleted: result.deletedCount });
});

router.delete("/:id", async (req, res) => {
  await Slot.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

export default router;
