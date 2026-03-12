require('dotenv').config();
const express   = require('express');
const cors      = require('cors');
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

app.use(express.json());

// Health check
app.get('/health', (_, res) => res.json({ status: 'ok', service: 'makoy-api' }));

app.use('/', magicLink);
app.use('/', contact);

// 404
app.use((_, res) => res.status(404).json({ error: 'Not found' }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Makoy API running on port ${PORT}`);
});
