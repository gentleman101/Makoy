const express = require('express');
const crypto  = require('crypto');
const db      = require('../db/setup');
const { sendMagicLink } = require('../mail/mailer');

module.exports = (limiter) => {
  const router = express.Router();

  // POST /send-link
  router.post('/send-link', limiter, async (req, res) => {
    const email = (req.body.email || '').trim().toLowerCase().slice(0, 254);
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Invalid email' });
    }

    // Already verified? Unlock immediately
    const already = db.prepare(
      'SELECT id FROM verified_emails WHERE email = ?'
    ).get(email);
    if (already) return res.json({ success: true, already_verified: true });

    // Clean old tokens for this email
    db.prepare('DELETE FROM magic_tokens WHERE email = ?').run(email);

    // Generate token
    const token   = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    db.prepare(
      'INSERT INTO magic_tokens (email, token, expires_at) VALUES (?, ?, ?)'
    ).run(email, token, expires);

    try {
      await sendMagicLink(email, token);
      res.json({ success: true });
    } catch (err) {
      console.error('Mail error:', err.message);
      res.status(500).json({ error: 'Failed to send email. Please try again.' });
    }
  });

  // GET /verify?token=...&email=...
  router.get('/verify', (req, res) => {
    const { token, email } = req.query;
    if (!token || !email) {
      return res.redirect(`${process.env.SITE_URL}?unlocked=error`);
    }

    const row = db.prepare(`
      SELECT id, email FROM magic_tokens
      WHERE token = ? AND email = ? AND used = 0
      AND datetime(expires_at) > datetime('now')
    `).get(token, email.toLowerCase().slice(0, 254));

    if (!row) {
      return res.redirect(`${process.env.SITE_URL}?unlocked=error`);
    }

    // Mark token used
    db.prepare('UPDATE magic_tokens SET used = 1 WHERE id = ?').run(row.id);

    // Store verified email (ignore if duplicate)
    db.prepare(
      'INSERT OR IGNORE INTO verified_emails (email) VALUES (?)'
    ).run(row.email);

    res.redirect(
      `${process.env.SITE_URL}?unlocked=1&email=${encodeURIComponent(row.email)}`
    );
  });

  return router;
};
