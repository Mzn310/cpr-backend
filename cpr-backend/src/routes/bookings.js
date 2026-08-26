import { Router } from "express";
import mongoose from "mongoose";
import Slot from "../models/Slot.js";
import Booking from "../models/Booking.js";
import Patient from "../models/Patient.js";
import { upsertPatient } from "./patients.js";
import axios from "axios";

const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL;
const CLINIC_WHATSAPP_NUMBER = process.env.CLINIC_WHATSAPP_NUMBER;
const router = Router();

const buildDelayMessage = ({ patientName, newDate, time, doctor, hasPaid }) => {
  const greeting = patientName ? `Hello ${patientName},` : "Hello,";

  let msg =
    `${greeting}\n\n` +
    `نأسف لإبلاغك بأن موعدك` +
    `${doctor ? ` مع الدكتور ${doctor}` : ""} قد تم تأجيله بسبب غياب الطبيب. ` +
    `موعدك الجديد هو ${newDate}` +
    `${time ? ` الساعة ${time}` : ""}. نعتذر عن هذا الإزعاج.`;

  if (hasPaid) {
    msg +=
      `\n\nإذا كنت لا ترغب في الموعد الجديد، يمكنك التواصل مع فريق الدعم لدينا ` +
      `لترتيب استرداد المبلغ، بما أن دفعتك قد تم استلامها بالفعل.`;
  }

  msg += `\n\nشكرًا لتفهمك.`;

  return msg;
};

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

router.put("/delay/:id", async (req, res) => {
  try {
    const { DelayedDate, message } = req.body;

    const booking = await Booking.findById(req.params.id);
    if (!booking) {
      return res.status(404).json({ ok: false, message: "Booking not found" });
    }

    const slot = await Slot.findByIdAndUpdate(
      booking.slotId,
      { date: DelayedDate },
      { new: true },
    );

    const patient = await Patient.findById(booking.patientId);
    const patient_phone = patient?.phone;

    const hasPaid = Boolean(booking.paymentRef);

    const finalMessage =
      message ||
      buildDelayMessage({
        patientName: patient?.name,
        newDate: DelayedDate,
        time: slot?.time,
        doctor: slot?.doctor,
        hasPaid,
      });

    let whatsappSent = false;
    try {
      await axios.post(N8N_WEBHOOK_URL, {
        from: CLINIC_WHATSAPP_NUMBER,
        to: patient_phone,
        chatId: patient?.chatId,
        message: finalMessage,
      });
      whatsappSent = true;
    } catch (whatsappErr) {
      console.error("n8n WhatsApp webhook failed:", whatsappErr.message);
    }

    return res.json({
      ok: true,
      message: whatsappSent
        ? "Slot delayed successfully. Message sent to client on WhatsApp."
        : "Slot delayed successfully, but the WhatsApp message could not be sent.",
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

export default router;
