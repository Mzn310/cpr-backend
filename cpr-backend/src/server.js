import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { connectDB } from './db.js';

import slotsRouter from './routes/slots.js';
import bookingsRouter from './routes/bookings.js';
import conversationsRouter from './routes/conversations.js';
import appointmentsRouter from './routes/appointments.js';
import webhooksRouter from './routes/webhooks.js';
import patientsRouter from './routes/patients.js';
import { requireApiKey } from './middleware/auth.js';

const app = express();

// IMPORTANT: Stripe needs the raw request body to verify the signature,
// so this must be registered BEFORE express.json().
app.use('/api/webhooks/stripe', express.raw({ type: 'application/json' }));
app.use('/api/webhooks', webhooksRouter);

app.use(cors());
app.use(express.json());

app.use('/api/slots', requireApiKey('CLINIC_API_KEY'), slotsRouter);
app.use('/api/bookings', requireApiKey('CLINIC_API_KEY'), bookingsRouter);
app.use('/api/conversations', requireApiKey('CLINIC_API_KEY'), conversationsRouter);
app.use('/api/patients', requireApiKey('CLINIC_API_KEY'), patientsRouter);
app.use('/api/appointments', appointmentsRouter); // has its own key check inside

app.get('/health', (req, res) => res.json({ ok: true }));

const port = process.env.PORT || 4000;

connectDB()
  .then(() => {
    app.listen(port, () => console.log(`CPR backend listening on port ${port}`));
  })
  .catch((err) => {
    console.error('Failed to connect to MongoDB:', err.message);
    process.exit(1);
  });
