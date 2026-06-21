/**
 * Roof Estimator → AccuLynx relay server
 * 
 * This tiny Express server sits between your estimator page and AccuLynx.
 * The browser calls /api/submit-lead → this server forwards to AccuLynx
 * with your API key (which stays secret on the server, never in the browser).
 *
 * Setup:
 *   1. npm install
 *   2. Copy .env.example to .env and fill in your keys
 *   3. node server.js  (or: npx pm2 start server.js for production)
 *
 * Deploy anywhere Node.js runs: Railway, Render, Fly.io, DigitalOcean, your own VPS.
 */

require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const fetch   = require('node-fetch');

const app  = express();
const PORT = process.env.PORT || 3001;

// Allow requests from your website domain only
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '*').split(',');

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || ALLOWED_ORIGINS.includes('*') || ALLOWED_ORIGINS.includes(origin)) {
      cb(null, true);
    } else {
      cb(new Error('Not allowed by CORS'));
    }
  }
}));

app.use(express.json());

// ─── Health check ────────────────────────────────────────────────────────────
app.get('/health', (_, res) => res.json({ ok: true }));

// ─── Lead submission endpoint ─────────────────────────────────────────────────
app.post('/api/submit-lead', async (req, res) => {
  const {
    firstName,
    lastName,
    email,
    phone,
    address,
    wantsCallback,
    callbackDay,
    callbackTime,
    // Estimator data we'll stuff into notes
    roofSize,
    pitch,
    material,
    layers,
    extras,
    estimateLow,
    estimateHigh,
  } = req.body;

  if (!firstName || !email) {
    return res.status(400).json({ error: 'firstName and email are required' });
  }

  // Build a rich notes string so the lead in AccuLynx has all the context
  const notes = [
    `=== Roof Estimator Lead ===`,
    `Roof size: ${roofSize || 'not provided'}`,
    `Pitch: ${pitch || 'not provided'}`,
    `Material: ${material || 'not provided'}`,
    `Existing layers: ${layers || 'not provided'}`,
    `Extras: ${extras?.length ? extras.join(', ') : 'none'}`,
    `Estimate range: $${estimateLow?.toLocaleString()} – $${estimateHigh?.toLocaleString()}`,
    wantsCallback
      ? `Wants a callback: yes — ${callbackDay || 'any day'}, ${callbackTime || 'any time'}`
      : `Wants a callback: no`,
    `Submitted via website estimator`,
  ].join('\n');

  // AccuLynx lead payload (see: https://apidocs.acculynx.com/docs/leads)
  const payload = {
    firstName,
    lastName:     lastName || '',
    emailAddress: email,
    phoneNumber1: phone || '',
    phoneType1:   'Mobile',
    street:       address || '',
    country:      'US',
    jobCategory:  'Residential',
    workType:     'Retail',
    priority:     wantsCallback ? 'High' : 'Normal',
    notes,
    salesPerson: 'paul@mdjconstruction.net',
  };

  try {
    const acculynxRes = await fetch('https://api.acculynx.com/api/v1/leads', {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${process.env.ACCULYNX_API_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    const body = await acculynxRes.text();

    if (!acculynxRes.ok) {
      console.error('AccuLynx error:', acculynxRes.status, body);
      return res.status(502).json({ error: 'AccuLynx rejected the lead', detail: body });
    }

    console.log(`Lead submitted: ${firstName} ${lastName} <${email}>`);
    return res.json({ ok: true });

  } catch (err) {
    console.error('Network error forwarding to AccuLynx:', err);
    return res.status(500).json({ error: 'Failed to reach AccuLynx' });
  }
});

app.listen(PORT, () => console.log(`Relay server running on port ${PORT}`));
