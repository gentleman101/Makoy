# Katy AI — HR Intelligence, Humanised

**Katy AI** is the flagship product of **Makoy** — an AI-powered HR consulting platform that covers the full employee lifecycle: Recruit → Onboard → Engage → Exit.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Single-file HTML + CSS + Vanilla JS (no frameworks) |
| Backend | Node.js + Express |
| Email | Nodemailer via Hostinger SMTP (`team@makoy.org`) |
| Database | Hostinger MySQL (mysql2 driver) |
| Hosting | Hostinger (Node.js hosting) |

---

## Project Structure

```
Makoy/
├── index.html        # Full frontend — all sections, CSS, and JS in one file
├── server.js         # Express backend — OTP, consultation, static serve
├── db.js             # MySQL pool + leads table schema + upsert helpers
├── package.json      # Dependencies
├── .env.example      # Environment variable template
├── .env              # Your actual secrets (never committed)
└── README.md
```

---

## Features

### Frontend
- **Hero** — animated blob backgrounds, floating metric cards, dual CTA
- **Mission** — brand narrative + four value pillars
- **Solutions** — filterable by journey stage (Hire / Grow / Exit / All)
- **How It Works** — three-step process (Listen → Design → Build)
- **Resources (Gated)** — 9 HR templates/guides unlocked via email + OTP
- **Consultation form** — 6-field form with validation, backend submission
- **Mobile nav** — full-screen hamburger overlay with smooth open/close
- **Responsive** — breakpoints at 900px, 768px, and 480px
- **Scroll animations** — Intersection Observer with staggered fade-up reveals

### Backend
- `POST /api/otp/request` — generates a 6-digit OTP, emails it via Hostinger SMTP, saves email to DB
- `POST /api/otp/verify` — validates OTP (10 min expiry, max 5 attempts), marks email verified in DB
- `POST /api/consultation/submit` — validates form, sends notification email, upserts full lead record in DB
- `GET /health` — health check endpoint
- Rate limiting on all endpoints
- Serves `index.html` for all non-API routes (SPA fallback)

### Database (`leads` table)
Email is the **primary key**. Records are enriched progressively:

| When | Data captured |
|---|---|
| OTP requested | `email`, `opted_in_at`, UTM params |
| OTP verified | `email_verified`, `verified_at` |
| Consult submitted | `first_name`, `last_name`, `company`, `company_size`, `hr_challenge`, `notes`, `consulted_at` |

Future fields available in the schema (add via `ALTER TABLE`):
`industry`, `job_title`, `country`, `phone`, `linkedin_url`

---

## Local Development

### 1. Clone and install

```bash
git clone <repo-url>
cd Makoy
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
PORT=3000
NODE_ENV=development
FRONTEND_URL=http://localhost:3000

# Hostinger SMTP
SMTP_HOST=smtp.hostinger.com
SMTP_PORT=465
SMTP_USER=team@makoy.org
SMTP_PASS=your_email_password

# Hostinger MySQL
DB_HOST=localhost
DB_PORT=3306
DB_USER=your_db_user
DB_PASS=your_db_password
DB_NAME=makoy
```

### 3. Start

```bash
npm run dev     # with nodemon (auto-reload)
# or
npm start       # production
```

Open `http://localhost:3000`

> The server starts even if MySQL is unreachable. DB warnings are logged but emails still send.

---

## Hostinger Deployment

### Email Setup
1. In Hostinger hPanel → **Email** → **Email Accounts** — verify `team@makoy.org` exists
2. Set `SMTP_PASS` in `.env` to the email account password

### MySQL Setup
1. hPanel → **Databases** → **MySQL Databases**
2. Create a new database (e.g. `makoy`)
3. Create a database user and assign all privileges
4. Set `DB_HOST=localhost`, `DB_USER`, `DB_PASS`, `DB_NAME` in `.env`
5. The `leads` table is **auto-created on first server start** — no manual SQL needed

### Node.js Hosting
1. hPanel → **Websites** → **Node.js**
2. Set Node.js version >= 18
3. Entry point: `server.js`
4. Upload files (or deploy via Git)
5. Run `npm install` via the terminal
6. Set environment variables in hPanel or upload `.env`
7. Start / restart the application

---

## SEO

The page includes:
- `<meta name="description">` for Google SERPs
- Open Graph tags for LinkedIn/Facebook sharing
- Twitter Card tags
- Schema.org JSON-LD (`Organization`, `WebSite`, `Service`)
- Canonical URL
- Semantic HTML (`<nav>`, `<section>`, `<footer>`, proper `h1`/`h2` hierarchy)
- Fluid typography with `clamp()`
- Google Fonts with `preconnect` hints

---

## Environment Variables Reference

| Variable | Description | Example |
|---|---|---|
| `PORT` | Server port | `3000` |
| `NODE_ENV` | Environment | `production` |
| `FRONTEND_URL` | Allowed CORS origin | `https://makoy.org` |
| `SMTP_HOST` | SMTP server | `smtp.hostinger.com` |
| `SMTP_PORT` | SMTP port (465=SSL, 587=TLS) | `465` |
| `SMTP_USER` | SMTP username / from address | `team@makoy.org` |
| `SMTP_PASS` | SMTP password | — |
| `DB_HOST` | MySQL host | `localhost` |
| `DB_PORT` | MySQL port | `3306` |
| `DB_USER` | MySQL username | `makoy_user` |
| `DB_PASS` | MySQL password | — |
| `DB_NAME` | MySQL database name | `makoy` |

---

## Brand Palette

| Token | Hex | Usage |
|---|---|---|
| `--cream` | `#F7F2EA` | Page background |
| `--terracotta` | `#C4724A` | Primary CTA, accents |
| `--sage` | `#7A9E87` | Secondary accents |
| `--warm-brown` | `#3D2B1F` | Body text |
| `--gold` | `#C9A84C` | Highlights |

---

## Contact

**Makoy** — team@makoy.org
