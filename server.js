'use strict';

require('dotenv').config();

const express    = require('express');
const nodemailer = require('nodemailer');
const crypto     = require('crypto');
const cors       = require('cors');
const rateLimit  = require('express-rate-limit');
const path       = require('path');
const { initDb, upsertEmailCapture, markEmailVerified, upsertConsultation, markOptedOut } = require('./db');

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── Secrets ───────────────────────────────────────────────
// SESSION_SECRET must be set in production; a random one is generated
// per process restart in development (invalidates all tokens on restart).
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

// Derive a 32-byte key for AES-256-GCM OTP encryption
const OTP_KEY = crypto.createHash('sha256').update('otp:' + SESSION_SECRET).digest();

// ─── Middleware ────────────────────────────────────────────
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: false, limit: '10kb' }));

// CORS — only allow the configured frontend origin
const allowedOrigins = process.env.FRONTEND_URL
  ? [process.env.FRONTEND_URL]
  : (process.env.NODE_ENV === 'production'
      ? [] // Disallow all if unconfigured in production
      : ['http://localhost:3000', 'http://localhost:3001', 'http://127.0.0.1:3000']);

app.use(cors({
  origin: (origin, callback) => {
    // Allow same-origin (no origin header) and configured origins
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'X-CSRF-Token']
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

// ─── CSRF Protection ───────────────────────────────────────
// Time-window HMAC token — valid for 2 windows (~4 hours max).
// No server-side state needed; can't be forged without SESSION_SECRET.
const CSRF_WINDOW_MS = 2 * 60 * 60 * 1000; // 2-hour window

function generateCsrfToken() {
  const w = Math.floor(Date.now() / CSRF_WINDOW_MS);
  return crypto.createHmac('sha256', SESSION_SECRET).update(`csrf:${w}`).digest('hex');
}

function isValidCsrfToken(token) {
  if (typeof token !== 'string' || token.length !== 64) return false;
  const w = Math.floor(Date.now() / CSRF_WINDOW_MS);
  for (const offset of [0, -1]) {
    const expected = crypto.createHmac('sha256', SESSION_SECRET)
      .update(`csrf:${w + offset}`).digest('hex');
    if (crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))) return true;
  }
  return false;
}

function csrfProtect(req, res, next) {
  const token = req.headers['x-csrf-token'];
  if (!isValidCsrfToken(token)) {
    return res.status(403).json({ error: 'Invalid or missing CSRF token.' });
  }
  next();
}

// ─── OTP Encryption ────────────────────────────────────────
// AES-256-GCM: OTPs are never stored in plain text in memory.

function encryptOtp(otp) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', OTP_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(otp, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${encrypted.toString('hex')}:${tag.toString('hex')}`;
}

function decryptOtp(stored) {
  const parts = stored.split(':');
  if (parts.length !== 3) throw new Error('Invalid OTP format');
  const [ivHex, dataHex, tagHex] = parts;
  const iv       = Buffer.from(ivHex,   'hex');
  const data     = Buffer.from(dataHex, 'hex');
  const tag      = Buffer.from(tagHex,  'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', OTP_KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

// ─── Verification Token ────────────────────────────────────
// Issued to the client after successful OTP verification.
// Format (base64url): email:expires:HMAC — cannot be forged or extended.
const VERIFY_TOKEN_TTL = 90 * 24 * 60 * 60 * 1000; // 90 days

function generateVerifyToken(email) {
  const expires = Date.now() + VERIFY_TOKEN_TTL;
  const payload = `${email.toLowerCase().trim()}:${expires}`;
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  return Buffer.from(`${payload}:${sig}`).toString('base64url');
}

function verifyVerifyToken(token) {
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf8');
    // sig is the last 64 hex chars; payload is everything before the final ':'
    const sigStart = decoded.length - 65; // index of ':' before sig
    if (sigStart < 1) return null;
    const payload = decoded.slice(0, sigStart);
    const sig     = decoded.slice(sigStart + 1);
    if (sig.length !== 64) return null;
    const expected = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const colonIdx = payload.lastIndexOf(':');
    const expires  = parseInt(payload.slice(colonIdx + 1), 10);
    if (Date.now() > expires) return null;
    return payload.slice(0, colonIdx); // verified email
  } catch {
    return null;
  }
}

// ─── Unsubscribe Token ─────────────────────────────────────
// Deterministic HMAC — no expiry needed (user can always unsubscribe).
function generateUnsubToken(email) {
  return crypto.createHmac('sha256', SESSION_SECRET)
    .update(`unsub:${email.toLowerCase().trim()}`)
    .digest('hex');
}

// ─── In-Memory OTP Store ───────────────────────────────────
// Map<emailLower, { encryptedOtp, expires, attempts }>
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
    rejectUnauthorized: true // always enforce TLS certificate validation
  }
});

// Verify transporter on startup (non-blocking)
if (process.env.SMTP_PASS) {
  transporter.verify()
    .then(() => console.log('✅  Email transporter ready'))
    .catch(err => console.warn('⚠️  Email transporter:', err.message));
}

// Init MySQL (non-blocking — site works without it)
initDb();

// ─── Helpers ───────────────────────────────────────────────
const generateOtp  = () => crypto.randomInt(100000, 999999).toString();
const isValidEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const escHtml      = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const siteUrl = process.env.FRONTEND_URL || 'https://makoy.org';

// ─── Email Templates ───────────────────────────────────────
function otpEmailHtml(otp, email) {
  const unsubToken = generateUnsubToken(email);
  const unsubUrl   = `${siteUrl}/api/unsubscribe?email=${encodeURIComponent(email)}&token=${unsubToken}`;
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
      <p style="font-size:11px;color:#B0A09A;margin:8px 0 0;"><a href="${unsubUrl}" style="color:#B0A09A;text-decoration:underline;">Unsubscribe</a></p>
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

function consultConfirmHtml(firstName, company, email) {
  const unsubToken = generateUnsubToken(email);
  const unsubUrl   = `${siteUrl}/api/unsubscribe?email=${encodeURIComponent(email)}&token=${unsubToken}`;
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
      <p style="color:#6B4C3B;font-size:14px;line-height:1.65;margin:0;">In the meantime, explore our free HR resources at <a href="${siteUrl}/#resources" style="color:#C4724A;text-decoration:none;">makoy.org</a></p>
    </div>
    <div style="background:#F7F2EA;padding:20px 40px;text-align:center;border-top:1px solid rgba(61,43,31,0.06);">
      <p style="font-size:12px;color:#9B7B6B;margin:0 0 4px;">&copy; 2025 Makoy &middot; Katy AI</p>
      <p style="font-size:12px;margin:0;"><a href="mailto:team@makoy.org" style="color:#C4724A;text-decoration:none;">team@makoy.org</a></p>
      <p style="font-size:11px;color:#B0A09A;margin:8px 0 0;"><a href="${unsubUrl}" style="color:#B0A09A;text-decoration:underline;">Unsubscribe</a></p>
    </div>
  </div>
</body>
</html>`;
}

// ─── API Routes ────────────────────────────────────────────

// CSRF token — fetch on page load, include in all POST requests
app.get('/api/csrf-token', (_req, res) => {
  res.json({ token: generateCsrfToken() });
});

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'Katy AI API', timestamp: new Date().toISOString() });
});

// Request OTP
app.post('/api/otp/request', otpRequestLimiter, csrfProtect, async (req, res) => {
  const { email } = req.body;

  if (!email || !isValidEmail(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }

  const emailLower = email.toLowerCase().trim();
  const otp        = generateOtp();
  const expires    = Date.now() + 10 * 60 * 1000; // 10 min

  // Store encrypted OTP — plain-text OTP never persisted
  otpStore.set(emailLower, { encryptedOtp: encryptOtp(otp), expires, attempts: 0 });

  // Capture email in DB (non-blocking, pass through any UTM params)
  upsertEmailCapture(emailLower, {
    source:      'website',
    page:        req.body.sourcePage    || null,
    utmSource:   req.body.utm_source    || null,
    utmMedium:   req.body.utm_medium    || null,
    utmCampaign: req.body.utm_campaign  || null
  });

  try {
    await transporter.sendMail({
      from:    `"Katy AI by Makoy" <${process.env.SMTP_USER || 'team@makoy.org'}>`,
      to:      emailLower,
      subject: 'Your Katy AI Resource Access Code',
      html:    otpEmailHtml(otp, emailLower),
      text:    `Your Katy AI access code is: ${otp}\n\nThis code expires in 10 minutes.\n\nIf you didn't request this, ignore this email.\n\n© 2025 Makoy · team@makoy.org`
    });

    console.log(`📧  OTP sent to ${emailLower}`);
    res.json({ success: true, message: `Verification code sent to ${emailLower}` });
  } catch (err) {
    console.error('OTP email error:', err.message);
    otpStore.delete(emailLower);
    res.status(500).json({ error: 'Failed to send verification email. Please try again or contact team@makoy.org' });
  }
});

// Verify OTP
app.post('/api/otp/verify', otpVerifyLimiter, csrfProtect, (req, res) => {
  const { email, otp } = req.body;

  if (!email || !otp) {
    return res.status(400).json({ error: 'Email and verification code are required.' });
  }

  const emailLower = email.toLowerCase().trim();
  const stored     = otpStore.get(emailLower);

  // Generic message — prevents account enumeration
  if (!stored || Date.now() > stored.expires) {
    otpStore.delete(emailLower);
    return res.status(400).json({ error: 'Invalid or expired code. Please request a new one.' });
  }

  stored.attempts += 1;

  if (stored.attempts > 5) {
    otpStore.delete(emailLower);
    return res.status(400).json({ error: 'Too many incorrect attempts. Please request a new code.' });
  }

  let plainOtp;
  try {
    plainOtp = decryptOtp(stored.encryptedOtp);
  } catch {
    otpStore.delete(emailLower);
    return res.status(500).json({ error: 'Verification error. Please request a new code.' });
  }

  if (plainOtp !== otp.toString().trim()) {
    const remaining = 5 - stored.attempts;
    return res.status(400).json({
      error: `Incorrect code. ${remaining > 0 ? `${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.` : 'Please request a new code.'}`
    });
  }

  // Verified — issue signed token, clean up OTP
  otpStore.delete(emailLower);
  markEmailVerified(emailLower); // non-blocking DB update
  const token = generateVerifyToken(emailLower);
  console.log(`✅  OTP verified for ${emailLower}`);
  res.json({ success: true, message: 'Email verified successfully.', token });
});

// Check verification token (replaces localStorage-based gate bypass)
app.post('/api/otp/check', csrfProtect, (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'Token required.' });
  const email = verifyVerifyToken(token);
  if (!email) return res.status(401).json({ error: 'Invalid or expired token.' });
  res.json({ success: true, email });
});

// Submit consultation form
app.post('/api/consultation/submit', consultLimiter, csrfProtect, async (req, res) => {
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
    email:       email.toLowerCase().trim().slice(0, 254),
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
      html:    consultConfirmHtml(d.firstName, d.company, d.email),
      text:    `Hi ${d.firstName},\n\nThank you for your consultation request! We'll be in touch within 24 hours to schedule your free 30-minute discovery call.\n\nThe Katy AI Team\nteam@makoy.org`
    });

    upsertConsultation(d); // non-blocking DB enrichment
    console.log(`📋  Consultation: ${d.firstName} ${d.lastName} (${d.company})`);
    res.json({ success: true, message: 'Request submitted. Check your email for confirmation.' });
  } catch (err) {
    console.error('Consultation email error:', err.message);
    res.status(500).json({ error: 'Failed to submit request. Please email us at team@makoy.org' });
  }
});

// Unsubscribe — GET link from email footer
app.get('/api/unsubscribe', async (req, res) => {
  const { email, token } = req.query;
  if (!email || !token) {
    return res.status(400).send('<h2>Invalid unsubscribe link.</h2>');
  }
  const emailLower = email.toLowerCase().trim();
  const expected   = generateUnsubToken(emailLower);
  if (token !== expected) {
    return res.status(400).send('<h2>Invalid unsubscribe link.</h2>');
  }
  await markOptedOut(emailLower);
  console.log(`🚫  Unsubscribed: ${emailLower}`);
  res.send(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Unsubscribed</title></head>
<body style="font-family:Arial,sans-serif;text-align:center;padding:60px;background:#F7F2EA;">
  <h2 style="color:#3D2B1F;">You've been unsubscribed.</h2>
  <p style="color:#6B4C3B;">You will no longer receive emails from Katy AI by Makoy.</p>
  <p style="font-size:13px;color:#9B7B6B;margin-top:40px;">Questions? <a href="mailto:team@makoy.org" style="color:#C4724A;">team@makoy.org</a></p>
</body></html>`);
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
  console.log(`    Email : ${process.env.SMTP_USER ? '(configured)' : 'team@makoy.org (set SMTP_PASS in .env)'}\n`);
});

module.exports = app;
