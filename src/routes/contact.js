const express = require('express');
const { sendConsultationAlert } = require('../mail/mailer');

module.exports = (limiter) => {
  const router = express.Router();

  router.post('/contact', limiter, async (req, res) => {
    const { firstName, lastName, email, company, size, challenge, message } = req.body;

    if (!firstName || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Sanitise and truncate all inputs
    const d = {
      firstName: String(firstName).trim().slice(0, 100),
      lastName:  String(lastName  || '').trim().slice(0, 100),
      email:     String(email).trim().toLowerCase().slice(0, 254),
      company:   String(company   || '').trim().slice(0, 200),
      size:      String(size      || '').trim().slice(0, 100),
      challenge: String(challenge || '').trim().slice(0, 200),
      message:   String(message   || '').trim().slice(0, 2000)
    };

    try {
      await sendConsultationAlert(d);
      res.json({ success: true });
    } catch (err) {
      console.error('Contact mail error:', err.message);
      res.status(500).json({ error: 'Failed to send. Please try again.' });
    }
  });

  return router;
};
