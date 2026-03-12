const express = require('express');
const { sendConsultationAlert } = require('../mail/mailer');
const router = express.Router();

router.post('/contact', async (req, res) => {
  const { firstName, lastName, email, company, size, challenge, message } = req.body;
  if (!firstName || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  try {
    await sendConsultationAlert(
      { firstName, lastName, email, company, size, challenge, message }
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Contact mail error:', err.message);
    res.status(500).json({ error: 'Failed to send. Please try again.' });
  }
});

module.exports = router;
