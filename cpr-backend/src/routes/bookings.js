import { Router } from "express";
import mongoose from "mongoose";
import Slot from "../models/Slot.js";
import Booking from "../models/Booking.js";
import Patient from "../models/Patient.js";
import { upsertPatient } from "./patients.js";

const router = Router();

// Creates a confirmed booking and marks the slot Booked inside a
export async function createBooking({
  phone,
  channel,
  chatId,
  slotId,
  paymentRef,
}) {
  const patient = await upsertPatient({ phone, channel, chatId });
  const session = await mongoose.startSession();
  try {
    let booking;
    await session.withTransaction(async () => {
      const slot = await Slot.findById(slotId).session(session);
      if (!slot) throw new Error("slot_not_found");
      slot.status = "Booked";
      slot.heldAt = null;
      await slot.save({ session });
      const created = await Booking.create(
        [{ patientId: patient._id, slotId, paymentRef: paymentRef || null }],
        { session },
      );
      booking = created[0];
    });
    return booking;
  } finally {
    session.endSession();
  }
}

// GET /api/bookings              -> admin panel: all bookings
// GET /api/bookings?chat_id=...  -> n8n "Get My Bookings" tool: only this patient's bookings
router.get("/", async (req, res) => {
  const { chat_id } = req.query;

  let filter = {};
  if (chat_id) {
    const patient = await Patient.findOne({ chatId: chat_id });
    if (!patient) return res.json([]); // no patient yet -> no bookings
    filter.patientId = patient._id;
  }

  const bookings = await Booking.find(filter)
    .populate("patientId")
    .populate("slotId")
    .sort({ confirmedAt: -1 })
    .limit(200);

  const shaped = bookings.map((b) => ({
    id: b._id,
    status: b.status,
    paymentRef: b.paymentRef,
    confirmedAt: b.confirmedAt,

    // Patient information
    patientName: b.patientId?.name || "—",
    phone: b.patientId?.phone || "—",

    date: b.slotId?.date,
    time: b.slotId?.time,

    dayOfWeek: b.slotId?.date
      ? new Date(b.slotId.date + "T00:00:00Z").toLocaleDateString("en-US", {
          weekday: "long",
          timeZone: "UTC",
        })
      : null,

    doctor: b.slotId?.doctor || "—",
  }));
  res.json(shaped);
});

router.post("/", async (req, res) => {
  try {
    const booking = await createBooking(req.body);
    res.status(201).json(booking);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// PUT /api/bookings/:id/reschedule   { new_slot_id }

router.put("/:id/reschedule", async (req, res) => {
  const { new_slot_id } = req.body;
  if (!new_slot_id) {
    return res.status(400).json({ error: "new_slot_id_required" });
  }

  const session = await mongoose.startSession();
  try {
    let updated;
    await session.withTransaction(async () => {
      const booking = await Booking.findById(req.params.id).session(session);
      if (!booking) throw new Error("booking_not_found");
      if (booking.status !== "Confirmed") {
        throw new Error("booking_not_active");
      }

      const newSlot = await Slot.findOneAndUpdate(
        { _id: new_slot_id, status: "Available" },
        { $set: { status: "Booked", heldAt: null } },
        { new: true, session },
      );
      if (!newSlot) throw new Error("new_slot_not_available");

      const oldSlotId = booking.slotId;
      booking.slotId = newSlot._id;
      await booking.save({ session });

      // Release the old slot back to Available now that the move succeeded.
      await Slot.findByIdAndUpdate(
        oldSlotId,
        { $set: { status: "Available", heldAt: null } },
        { session },
      );

      updated = booking;
    });

    const populated = await Booking.findById(updated._id)
      .populate("patientId")
      .populate("slotId");
    res.json(populated);
  } catch (e) {
    res.status(400).json({ error: e.message });
  } finally {
    session.endSession();
  }
});

// PUT /api/bookings/:id/cancel
// Called by the n8n "Cancel Booking" tool. Marks the booking Cancelled and
// frees the slot back to Available.
router.put("/:id/cancel", async (req, res) => {
  const booking = await Booking.findById(req.params.id);
  if (!booking) return res.status(404).json({ error: "booking_not_found" });
  if (booking.status === "Cancelled") {
    return res.json({ ok: true, alreadyCancelled: true });
  }

  booking.status = "Cancelled";
  await booking.save();

  await Slot.findByIdAndUpdate(booking.slotId, {
    $set: { status: "Available", heldAt: null },
  });

  res.json({ ok: true, booking });
});

router.put("/delay/id", async (req, res) => {
  const { DelayedDate, message } = req.body;
  const booking = await Booking.findById(req.params.id);
  const slot = await Slot.findByIdAndUpdate(booking.slotId, {
    date: DelayedDate,
  });

  const patientId = booking.patientId;
  const patient_phone = await Patient.findById(patientId).phone;

  res.json({
    ok: true,
    message: "Slot delayed successfully",
  });
});

export default router;
