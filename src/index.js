require('dotenv').config();
const express   = require('express');
const cors      = require('cors');
const rateLimit = require('express-rate-limit');
const magicLink = require('./routes/magicLink');
const contact   = require('./routes/contact');

const app = express();

app.use(cors({
  origin: [
    'https://makoy.org',
    'https://www.makoy.org'
  ],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type']
}));

app.use(express.json({ limit: '20kb' }));

// ─── Rate Limiters ─────────────────────────────
const linkLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again in an hour.' }
});

const contactLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' }
});

// Health check
app.get('/health', (_, res) => res.json({ status: 'ok', service: 'makoy-api' }));

app.use('/', magicLink(linkLimiter));
app.use('/', contact(contactLimiter));

// 404
app.use((_, res) => res.status(404).json({ error: 'Not found' }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Makoy API running on port ${PORT}`);
});
