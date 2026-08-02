import "dotenv/config";
import express from "express";
import cors from "cors";
import { connectDB } from "./db.js";

import slotsRouter from "./routes/slots.js";
import bookingsRouter from "./routes/bookings.js";
import conversationsRouter from "./routes/conversations.js";
import appointmentsRouter from "./routes/appointments.js";
import webhooksRouter from "./routes/webhooks.js";
import patientsRouter from "./routes/patients.js";
import paymentsRouter from "./routes/payments.js";
import { requireApiKey } from "./middleware/auth.js";
import casesRouter from "./routes/cases.js";

const app = express();

// Tap's webhook verification is computed over specific JSON fields (see
// routes/webhooks.js), not the raw request body, so - unlike Stripe -
// express.json() can be applied globally before this route.
app.use(cors());
app.use(express.json());

app.use("/api/webhooks", webhooksRouter);
app.use("/api/slots", requireApiKey("CLINIC_API_KEY"), slotsRouter);
app.use("/api/bookings", requireApiKey("CLINIC_API_KEY"), bookingsRouter);
app.use(
  "/api/conversations",
  requireApiKey("CLINIC_API_KEY"),
  conversationsRouter,
);
app.use("/api/patients", requireApiKey("CLINIC_API_KEY"), patientsRouter);
app.use("/api/payments", requireApiKey("CLINIC_API_KEY"), paymentsRouter);
app.use("/api/appointments", appointmentsRouter); // has its own key check inside
app.use("/api/cases", requireApiKey("CLINIC_API_KEY"), casesRouter);

app.get("/health", (req, res) => res.json({ ok: true }));

const port = process.env.PORT || 4000;

connectDB()
  .then(() => {
    app.listen(port, () =>
      console.log(`CPR backend listening on port ${port}`),
    );
  })
  .catch((err) => {
    console.error("Failed to connect to MongoDB:", err.message);
    process.exit(1);
  });
