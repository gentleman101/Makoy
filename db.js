'use strict';

/**
 * db.js — Hostinger MySQL connection pool + schema init
 *
 * Table: leads
 *   email (PK) — captured first via OTP request
 *   Profile fields enriched progressively as the user interacts
 *   All nullable except email — so partial records are fine
 */

const mysql = require('mysql2/promise');

// ─── Pool ──────────────────────────────────────────────────
const pool = mysql.createPool({
  host:               process.env.DB_HOST     || 'localhost',
  port:               parseInt(process.env.DB_PORT || '3306', 10),
  user:               process.env.DB_USER     || 'root',
  password:           process.env.DB_PASS     || '',
  database:           process.env.DB_NAME     || 'makoy',
  waitForConnections: true,
  connectionLimit:    10,
  queueLimit:         0,
  timezone:           '+00:00',
  // Keep connections alive on Hostinger shared hosting
  enableKeepAlive:    true,
  keepAliveInitialDelay: 30000
});

// ─── Schema ────────────────────────────────────────────────
const CREATE_LEADS_TABLE = `
CREATE TABLE IF NOT EXISTS leads (
  -- Identity (PK)
  email               VARCHAR(254)    NOT NULL,

  -- Name
  first_name          VARCHAR(100)    DEFAULT NULL,
  last_name           VARCHAR(100)    DEFAULT NULL,

  -- Company profile (good for B2B segmentation)
  company             VARCHAR(200)    DEFAULT NULL,
  company_size        VARCHAR(50)     DEFAULT NULL,
  industry            VARCHAR(100)    DEFAULT NULL,
  job_title           VARCHAR(150)    DEFAULT NULL,
  country             VARCHAR(100)    DEFAULT NULL,

  -- HR challenge (for personalisation)
  hr_challenge        VARCHAR(200)    DEFAULT NULL,
  notes               TEXT            DEFAULT NULL,

  -- Contact
  phone               VARCHAR(30)     DEFAULT NULL,
  linkedin_url        VARCHAR(300)    DEFAULT NULL,

  -- Marketing attribution
  source              VARCHAR(50)     DEFAULT 'website',
  source_page         VARCHAR(100)    DEFAULT NULL,
  utm_source          VARCHAR(100)    DEFAULT NULL,
  utm_medium          VARCHAR(100)    DEFAULT NULL,
  utm_campaign        VARCHAR(100)    DEFAULT NULL,
  utm_term            VARCHAR(100)    DEFAULT NULL,

  -- Engagement milestones
  email_verified      TINYINT(1)      DEFAULT 0,
  opted_in_at         DATETIME        DEFAULT NULL,
  verified_at         DATETIME        DEFAULT NULL,
  consulted_at        DATETIME        DEFAULT NULL,

  -- Metadata
  created_at          DATETIME        DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME        DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (email),
  INDEX idx_company       (company),
  INDEX idx_company_size  (company_size),
  INDEX idx_country       (country),
  INDEX idx_consulted_at  (consulted_at),
  INDEX idx_created_at    (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

// ─── Init ──────────────────────────────────────────────────
let dbReady = false;

async function initDb() {
  try {
    const conn = await pool.getConnection();
    await conn.query(CREATE_LEADS_TABLE);
    conn.release();
    dbReady = true;
    console.log('✅  MySQL connected — leads table ready');
  } catch (err) {
    // Non-fatal: site works without DB, emails still send
    console.warn('⚠️  MySQL unavailable:', err.message);
    console.warn('    Set DB_HOST / DB_USER / DB_PASS / DB_NAME in .env');
  }
}

// ─── Helpers ───────────────────────────────────────────────

/**
 * Called when a user submits their email for OTP.
 * Creates a minimal lead record (just email + source) if none exists.
 * Never overwrites an existing opt-in timestamp.
 */
async function upsertEmailCapture(email, sourceInfo = {}) {
  if (!dbReady) return;
  try {
    await pool.execute(
      `INSERT INTO leads (email, source, source_page, utm_source, utm_medium, utm_campaign, opted_in_at)
       VALUES (?, ?, ?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE
         source_page  = IF(source_page IS NULL, VALUES(source_page), source_page),
         utm_source   = IF(utm_source  IS NULL, VALUES(utm_source),  utm_source),
         utm_medium   = IF(utm_medium  IS NULL, VALUES(utm_medium),  utm_medium),
         utm_campaign = IF(utm_campaign IS NULL, VALUES(utm_campaign), utm_campaign),
         opted_in_at  = IF(opted_in_at IS NULL, NOW(), opted_in_at),
         updated_at   = NOW()`,
      [
        email.toLowerCase().trim(),
        sourceInfo.source   || 'website',
        sourceInfo.page     || null,
        sourceInfo.utmSource || null,
        sourceInfo.utmMedium || null,
        sourceInfo.utmCampaign || null
      ]
    );
  } catch (err) {
    console.warn('DB upsertEmailCapture error:', err.message);
  }
}

/**
 * Called when OTP is successfully verified.
 * Marks email as verified.
 */
async function markEmailVerified(email) {
  if (!dbReady) return;
  try {
    await pool.execute(
      `UPDATE leads
       SET email_verified = 1, verified_at = IF(verified_at IS NULL, NOW(), verified_at), updated_at = NOW()
       WHERE email = ?`,
      [email.toLowerCase().trim()]
    );
  } catch (err) {
    console.warn('DB markEmailVerified error:', err.message);
  }
}

/**
 * Called when a consultation form is submitted.
 * Enriches the lead record — never blanks existing data.
 */
async function upsertConsultation(data) {
  if (!dbReady) return;
  try {
    const email = data.email.toLowerCase().trim();
    await pool.execute(
      `INSERT INTO leads
         (email, first_name, last_name, company, company_size, hr_challenge, notes,
          source, consulted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'website', NOW())
       ON DUPLICATE KEY UPDATE
         first_name   = IF(first_name   IS NULL, VALUES(first_name),   first_name),
         last_name    = IF(last_name    IS NULL, VALUES(last_name),    last_name),
         company      = COALESCE(VALUES(company),      company),
         company_size = COALESCE(VALUES(company_size), company_size),
         hr_challenge = COALESCE(VALUES(hr_challenge), hr_challenge),
         notes        = IF(notes IS NULL AND VALUES(notes) IS NOT NULL, VALUES(notes), notes),
         consulted_at = IF(consulted_at IS NULL, NOW(), consulted_at),
         updated_at   = NOW()`,
      [
        email,
        data.firstName   || null,
        data.lastName    || null,
        data.company     || null,
        data.companySize || null,
        data.hrChallenge || null,
        data.message     || null
      ]
    );
  } catch (err) {
    console.warn('DB upsertConsultation error:', err.message);
  }
}

module.exports = { initDb, upsertEmailCapture, markEmailVerified, upsertConsultation };
