'use strict';

require('dotenv').config();

const express    = require('express');
const nodemailer = require('nodemailer');
const crypto     = require('crypto');
const cors       = require('cors');
const rateLimit  = require('express-rate-limit');
const path       = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ────────────────────────────────────────────
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: false, limit: '10kb' }));

app.use(cors({
  origin: process.env.FRONTEND_URL || true,
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type']
}));

// Serve frontend static files
app.use(express.static(path.join(__dirname)));

// ─── Rate Limiters ─────────────────────────────────────────
const otpRequestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  message: { error: 'Too many code requests. Please try again in an hour.' },
  standardHeaders: true,
  legacyHeaders: false
});

const otpVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 15,
  message: { error: 'Too many verification attempts. Please try again later.' }
});

const consultLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  message: { error: 'Too many requests. Please try again later.' }
});

// ─── In-Memory OTP Store ───────────────────────────────────
// Map<emailLower, { otp, expires, attempts }>
const otpStore = new Map();

// Clean expired OTPs every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [email, data] of otpStore) {
    if (now > data.expires) otpStore.delete(email);
  }
}, 5 * 60 * 1000);

// ─── Email Transporter ─────────────────────────────────────
const transporter = nodemailer.createTransport({
  host:   process.env.SMTP_HOST || 'smtp.hostinger.com',
  port:   parseInt(process.env.SMTP_PORT || '465', 10),
  secure: (process.env.SMTP_PORT || '465') !== '587',
  auth: {
    user: process.env.SMTP_USER || 'team@makoy.org',
    pass: process.env.SMTP_PASS || ''
  },
  tls: {
    rejectUnauthorized: process.env.NODE_ENV === 'production'
  }
});

// Verify transporter on startup (non-blocking)
if (process.env.SMTP_PASS) {
  transporter.verify()
    .then(() => console.log('✅  Email transporter ready'))
    .catch(err => console.warn('⚠️  Email transporter:', err.message));
}

// ─── Helpers ───────────────────────────────────────────────
const generateOtp  = () => crypto.randomInt(100000, 999999).toString();
const isValidEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const escHtml      = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ─── Email Templates ───────────────────────────────────────
function otpEmailHtml(otp) {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#F7F2EA;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:500px;margin:40px auto;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 8px 40px rgba(61,43,31,0.12);">
    <div style="background:linear-gradient(135deg,#3D2B1F 0%,#C4724A 100%);padding:36px 40px;text-align:center;">
      <div style="font-size:26px;font-weight:700;color:#ffffff;font-family:Georgia,serif;letter-spacing:-0.02em;">Katy <em>AI</em></div>
      <div style="font-size:10px;color:rgba(255,255,255,0.55);letter-spacing:0.14em;text-transform:uppercase;margin-top:6px;">by Makoy &middot; HR Intelligence, Humanised</div>
    </div>
    <div style="padding:40px;">
      <h2 style="font-family:Georgia,serif;font-size:22px;color:#3D2B1F;margin:0 0 12px;font-weight:600;">Your access code</h2>
      <p style="color:#6B4C3B;font-size:14px;line-height:1.65;margin:0 0 28px;">Use the code below to unlock the Katy AI free HR resource library. This code is valid for <strong>10 minutes</strong> and can only be used once.</p>
      <div style="background:#F7F2EA;border-radius:16px;padding:28px;text-align:center;margin:0 0 28px;border:1px dashed rgba(196,114,74,0.35);">
        <div style="font-family:Georgia,serif;font-size:48px;font-weight:700;color:#C4724A;letter-spacing:0.20em;line-height:1;">${otp}</div>
        <div style="font-size:12px;color:#6B4C3B;margin-top:10px;opacity:0.7;">One-time code &middot; expires in 10 minutes</div>
      </div>
      <p style="color:#9B7B6B;font-size:13px;line-height:1.6;margin:0;">If you didn't request this code, you can safely ignore this email.</p>
    </div>
    <div style="background:#F7F2EA;padding:20px 40px;text-align:center;border-top:1px solid rgba(61,43,31,0.06);">
      <p style="font-size:12px;color:#9B7B6B;margin:0 0 4px;">&copy; 2025 Makoy &middot; Katy AI</p>
      <p style="font-size:12px;margin:0;"><a href="mailto:team@makoy.org" style="color:#C4724A;text-decoration:none;">team@makoy.org</a></p>
    </div>
  </div>
</body>
</html>`;
}

function consultNotificationHtml(d) {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:20px;background:#F5F0EB;font-family:Arial,sans-serif;">
  <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
    <div style="background:#3D2B1F;padding:24px 32px;">
      <h2 style="margin:0;color:#ffffff;font-family:Georgia,serif;font-size:20px;font-weight:600;">New Consultation Request</h2>
      <p style="margin:4px 0 0;color:rgba(255,255,255,0.45);font-size:12px;">Via makoy.org &middot; ${new Date().toUTCString()}</p>
    </div>
    <div style="padding:32px;">
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <tr style="border-bottom:1px solid #F7F2EA;"><td style="padding:10px 0;color:#9B7B6B;width:38%;font-weight:600;">Name</td><td style="padding:10px 0;color:#3D2B1F;">${escHtml(d.firstName)} ${escHtml(d.lastName)}</td></tr>
        <tr style="border-bottom:1px solid #F7F2EA;"><td style="padding:10px 0;color:#9B7B6B;font-weight:600;">Email</td><td style="padding:10px 0;"><a href="mailto:${escHtml(d.email)}" style="color:#C4724A;text-decoration:none;">${escHtml(d.email)}</a></td></tr>
        <tr style="border-bottom:1px solid #F7F2EA;"><td style="padding:10px 0;color:#9B7B6B;font-weight:600;">Company</td><td style="padding:10px 0;color:#3D2B1F;">${escHtml(d.company)}</td></tr>
        <tr style="border-bottom:1px solid #F7F2EA;"><td style="padding:10px 0;color:#9B7B6B;font-weight:600;">Company Size</td><td style="padding:10px 0;color:#3D2B1F;">${escHtml(d.companySize || 'Not specified')}</td></tr>
        <tr style="border-bottom:1px solid #F7F2EA;"><td style="padding:10px 0;color:#9B7B6B;font-weight:600;">HR Challenge</td><td style="padding:10px 0;color:#3D2B1F;">${escHtml(d.hrChallenge || 'Not specified')}</td></tr>
      </table>
      ${d.message ? `<div style="margin-top:20px;padding:16px 20px;background:#F7F2EA;border-radius:10px;border-left:3px solid #C4724A;"><strong style="color:#3D2B1F;font-size:13px;display:block;margin-bottom:6px;">Additional Notes</strong><p style="color:#6B4C3B;font-size:13px;margin:0;line-height:1.65;">${escHtml(d.message)}</p></div>` : ''}
    </div>
    <div style="padding:16px 32px;background:#F7F2EA;font-size:11px;color:#9B7B6B;text-align:center;">
      Reply to this email to respond directly &middot; <a href="mailto:${escHtml(d.email)}" style="color:#C4724A;text-decoration:none;">${escHtml(d.email)}</a>
    </div>
  </div>
</body></html>`;
}

function consultConfirmHtml(firstName, company) {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#F7F2EA;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:500px;margin:40px auto;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 8px 40px rgba(61,43,31,0.12);">
    <div style="background:linear-gradient(135deg,#3D2B1F 0%,#C4724A 100%);padding:36px 40px;text-align:center;">
      <div style="font-size:32px;margin-bottom:10px;">&#127881;</div>
      <div style="font-size:26px;font-weight:700;color:#ffffff;font-family:Georgia,serif;">Katy <em>AI</em></div>
      <div style="font-size:10px;color:rgba(255,255,255,0.55);letter-spacing:0.14em;text-transform:uppercase;margin-top:6px;">by Makoy</div>
    </div>
    <div style="padding:40px;">
      <h2 style="font-family:Georgia,serif;font-size:22px;color:#3D2B1F;margin:0 0 12px;font-weight:600;">We're on it, ${escHtml(firstName)}!</h2>
      <p style="color:#6B4C3B;font-size:14px;line-height:1.65;margin:0 0 20px;">We've received your consultation request for <strong>${escHtml(company)}</strong> and we're genuinely excited to learn about your HR challenges.</p>
      <div style="background:#F7F2EA;border-radius:14px;padding:20px 24px;margin:0 0 24px;border-left:3px solid #7A9E87;">
        <p style="margin:0;color:#3D2B1F;font-size:14px;line-height:1.65;font-family:Georgia,serif;font-style:italic;">"We start with listening — a genuine conversation about your challenges, not a sales pitch."</p>
        <p style="margin:10px 0 0;font-size:12px;color:#9B7B6B;">— The Katy AI Team</p>
      </div>
      <p style="color:#6B4C3B;font-size:14px;line-height:1.65;margin:0 0 12px;">A member of our team will be in touch within <strong>24 hours</strong> to schedule your free 30-minute discovery call.</p>
      <p style="color:#6B4C3B;font-size:14px;line-height:1.65;margin:0;">In the meantime, explore our free HR resources at <a href="https://makoy.org/#resources" style="color:#C4724A;text-decoration:none;">makoy.org</a></p>
    </div>
    <div style="background:#F7F2EA;padding:20px 40px;text-align:center;border-top:1px solid rgba(61,43,31,0.06);">
      <p style="font-size:12px;color:#9B7B6B;margin:0 0 4px;">&copy; 2025 Makoy &middot; Katy AI</p>
      <p style="font-size:12px;margin:0;"><a href="mailto:team@makoy.org" style="color:#C4724A;text-decoration:none;">team@makoy.org</a></p>
    </div>
  </div>
</body>
</html>`;
}

// ─── API Routes ────────────────────────────────────────────

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'Katy AI API', timestamp: new Date().toISOString() });
});

// Request OTP
app.post('/api/otp/request', otpRequestLimiter, async (req, res) => {
  const { email } = req.body;

  if (!email || !isValidEmail(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }

  const emailLower = email.toLowerCase().trim();
  const otp        = generateOtp();
  const expires    = Date.now() + 10 * 60 * 1000; // 10 min

  otpStore.set(emailLower, { otp, expires, attempts: 0 });

  try {
    await transporter.sendMail({
      from:    `"Katy AI by Makoy" <${process.env.SMTP_USER || 'team@makoy.org'}>`,
      to:      email,
      subject: 'Your Katy AI Resource Access Code',
      html:    otpEmailHtml(otp),
      text:    `Your Katy AI access code is: ${otp}\n\nThis code expires in 10 minutes.\n\nIf you didn't request this, ignore this email.\n\n© 2025 Makoy · team@makoy.org`
    });

    console.log(`📧  OTP sent to ${emailLower}`);
    res.json({ success: true, message: `Verification code sent to ${email}` });
  } catch (err) {
    console.error('OTP email error:', err.message);
    otpStore.delete(emailLower);
    res.status(500).json({ error: 'Failed to send verification email. Please try again or contact team@makoy.org' });
  }
});

// Verify OTP
app.post('/api/otp/verify', otpVerifyLimiter, (req, res) => {
  const { email, otp } = req.body;

  if (!email || !otp) {
    return res.status(400).json({ error: 'Email and verification code are required.' });
  }

  const emailLower = email.toLowerCase().trim();
  const stored     = otpStore.get(emailLower);

  if (!stored) {
    return res.status(400).json({ error: 'No active code found for this email. Please request a new one.' });
  }

  if (Date.now() > stored.expires) {
    otpStore.delete(emailLower);
    return res.status(400).json({ error: 'Your code has expired. Please request a new one.' });
  }

  stored.attempts += 1;

  if (stored.attempts > 5) {
    otpStore.delete(emailLower);
    return res.status(400).json({ error: 'Too many incorrect attempts. Please request a new code.' });
  }

  if (stored.otp !== otp.toString().trim()) {
    const remaining = 5 - stored.attempts;
    return res.status(400).json({
      error: `Incorrect code. ${remaining > 0 ? `${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.` : 'Please request a new code.'}`
    });
  }

  // Verified!
  otpStore.delete(emailLower);
  console.log(`✅  OTP verified for ${emailLower}`);
  res.json({ success: true, message: 'Email verified successfully.' });
});

// Submit consultation form
app.post('/api/consultation/submit', consultLimiter, async (req, res) => {
  const { firstName, lastName, email, company, companySize, hrChallenge, message } = req.body;

  if (!firstName?.trim() || !lastName?.trim() || !email?.trim() || !company?.trim()) {
    return res.status(400).json({ error: 'Please fill in all required fields (name, email, company).' });
  }

  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }

  // Sanitise & truncate
  const d = {
    firstName:   firstName.trim().slice(0, 100),
    lastName:    lastName.trim().slice(0, 100),
    email:       email.trim().slice(0, 254),
    company:     company.trim().slice(0, 200),
    companySize: (companySize || '').trim().slice(0, 100),
    hrChallenge: (hrChallenge || '').trim().slice(0, 200),
    message:     (message || '').trim().slice(0, 2000)
  };

  try {
    const from = `"Katy AI Website" <${process.env.SMTP_USER || 'team@makoy.org'}>`;
    const to   = process.env.SMTP_USER || 'team@makoy.org';

    // Notify team
    await transporter.sendMail({
      from,
      to,
      replyTo:  d.email,
      subject:  `New Consultation: ${d.firstName} ${d.lastName} — ${d.company}`,
      html:     consultNotificationHtml(d),
      text:     `New consultation request:\n\nName: ${d.firstName} ${d.lastName}\nEmail: ${d.email}\nCompany: ${d.company}\nSize: ${d.companySize || 'N/A'}\nChallenge: ${d.hrChallenge || 'N/A'}\n\nNotes:\n${d.message || 'None'}`
    });

    // Confirm to user
    await transporter.sendMail({
      from:    `"Katy AI by Makoy" <${process.env.SMTP_USER || 'team@makoy.org'}>`,
      to:      d.email,
      subject: `We've received your consultation request — Katy AI`,
      html:    consultConfirmHtml(d.firstName, d.company),
      text:    `Hi ${d.firstName},\n\nThank you for your consultation request! We'll be in touch within 24 hours to schedule your free 30-minute discovery call.\n\nThe Katy AI Team\nteam@makoy.org`
    });

    console.log(`📋  Consultation: ${d.firstName} ${d.lastName} (${d.company})`);
    res.json({ success: true, message: 'Request submitted. Check your email for confirmation.' });
  } catch (err) {
    console.error('Consultation email error:', err.message);
    res.status(500).json({ error: 'Failed to submit request. Please email us at team@makoy.org' });
  }
});

// ─── SPA Fallback ──────────────────────────────────────────
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'API route not found.' });
  }
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ─── Error Handler ─────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error.' });
});

// ─── Start ─────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🌿  Katy AI server running on port ${PORT}`);
  console.log(`    Mode  : ${process.env.NODE_ENV || 'development'}`);
  console.log(`    Email : ${process.env.SMTP_USER || 'team@makoy.org (set SMTP_PASS in .env)'}\n`);
});

module.exports = app;
