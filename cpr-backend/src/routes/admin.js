import { Router } from "express";
import jwt from "jsonwebtoken";
import Booking from "../models/Booking.js";
import Patient from "../models/Patient.js";
import Payment from "../models/Payment.js";
import authAdmin from "../middleware/authAdmin.js";

const router = Router();

router.post("/login", (req, res) => {
  const { email, password } = req.body;
  if (
    email !== process.env.ADMIN_EMAIL ||
    password !== process.env.ADMIN_PASSWORD
  ) {
    return res.json({ success: false, message: "Invalid credentials" });
  }
  const token = jwt.sign({ email }, process.env.JWT_SECRET, {
    expiresIn: "12h",
  });
  res.json({ success: true, token });
});

router.get("/dashboard", authAdmin, async (req, res) => {
  const [confirmedCount, patientCount, deposits, latest] = await Promise.all([
    Booking.countDocuments({ status: "Confirmed" }),
    Patient.countDocuments(),
    Payment.aggregate([
      { $match: { status: "paid" } },
      { $group: { _id: "$currency", total: { $sum: "$amountTotal" } } },
    ]),
    Booking.find({ status: "Confirmed" })
      .populate("patientId")
      .populate("slotId")
      .sort({ confirmedAt: -1 })
      .limit(5),
  ]);

  res.json({
    success: true,
    bookings: confirmedCount,
    patients: patientCount,
    deposits,
    latestBookings: latest.map((b) => ({
      id: b._id,
      patientName: b.patientId?.name || b.patientId?.phone,
      phone: b.patientId?.phone,
      date: b.slotId?.date,
      time: b.slotId?.time,
      doctor: b.slotId?.doctor,
      status: b.status,
    })),
  });
});

export default router;
