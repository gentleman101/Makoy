const Database = require('better-sqlite3');
const path = require('path');
const fs   = require('fs');

// Store DB in a volume-mounted folder
const dataDir = path.join(__dirname, '../../data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'makoy.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS verified_emails (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    email       TEXT UNIQUE NOT NULL,
    verified_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS magic_tokens (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    email      TEXT NOT NULL,
    token      TEXT UNIQUE NOT NULL,
    used       INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_token ON magic_tokens(token);
  CREATE INDEX IF NOT EXISTS idx_email ON magic_tokens(email);
`);

// Add return_url column if it doesn't exist yet (safe on existing DBs)
try {
  db.exec('ALTER TABLE magic_tokens ADD COLUMN return_url TEXT');
} catch (_) { /* column already exists */ }

module.exports = db;
