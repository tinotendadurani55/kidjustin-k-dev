# 🏪 Kidjustin-Shop — WhatsApp Business Bot SaaS

> Multi-tenant WhatsApp shop automation. One deployment, multiple businesses.

---

## 🚀 Deploy to Koyeb

[![Deploy to Koyeb](https://www.koyeb.com/static/images/deploy/button.svg)](https://app.koyeb.com/deploy?type=git&repository=github.com/YOUR_USERNAME/YOUR_REPO&branch=main&name=kidjustin-shop)

---

## 📋 Prerequisites

- A **PostgreSQL** database — [Neon](https://neon.tech) free tier works perfectly
- Your **WhatsApp number** for the master bot
- A **GitHub** account to host the repo

---

## ⚙️ Environment Variables

Set these in the Koyeb dashboard under **Settings → Environment**:

| Variable | Required | Description |
|---|---|---|
| `OWNER_NUMBER` | ✅ | Your WhatsApp number (digits only, e.g. `263777426534`) |
| `SESSION_ID` | ✅ | Base64 session — generated after first QR scan |
| `DATABASE_HOST` | ✅ | PostgreSQL host (e.g. from Neon) |
| `DATABASE_NAME` | ✅ | Database name |
| `DATABASE_USER` | ✅ | Database username |
| `DATABASE_PASSWORD` | ✅ | Database password |
| `PORT` | Auto | Set automatically by Koyeb — leave blank |

---

## 🛠️ Deployment Steps

### 1. Database — Neon (free)
1. Go to [neon.tech](https://neon.tech) → Create account → New project
2. Copy: **Host**, **Database**, **User**, **Password**

### 2. Push to GitHub
```bash
git init
git add .
git commit -m "Initial deploy"
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

### 3. Deploy on Koyeb
1. Go to [koyeb.com](https://app.koyeb.com) → **Create Service**
2. Choose **GitHub** → select your repo → branch: `main`
3. Build method: **Dockerfile** (auto-detected)
4. Add all environment variables from the table above
5. Click **Deploy**

### 4. First QR Scan
- After deployment, open your Koyeb app URL
- Check Koyeb logs for the QR code printed in terminal
- Scan with your WhatsApp → master bot is now live

### 5. Get Your SESSION_ID (prevent re-scan on restart)
After scanning, copy the session from Koyeb logs or run:
```
The bot saves the session automatically to PostgreSQL after first scan.
No SESSION_ID is needed if the database is configured — it persists automatically.
```

---

## 📁 Project Structure

```
shop-bot/
├── index.js          # Master controller — subscription manager, owner bot, dashboard
├── business.js       # Per-business bot engine — catalogue, orders, customers
├── db.js             # PostgreSQL schema + all database queries
├── dashboard/
│   └── index.html    # Admin web dashboard
├── Dockerfile        # Container config for Koyeb
├── .koyeb.yaml       # Koyeb service config
├── .gitignore        # Excludes sessions, .env, node_modules
├── .env.example      # Environment variable template
└── package.json      # Dependencies
```

---

## 💬 Master Bot Commands (Owner Only)

| Command | Description |
|---|---|
| `.help` | Show all commands |
| `.addclient 2637XXXX Name basic` | Add a new business (max 7) |
| `.clients` | List all clients with status and days left |
| `.paid 2637XXXX 3` | Record payment — auto-extends subscription |
| `.extend 2637XXXX 7` | Add extra days |
| `.suspend 2637XXXX` | Pause a client's bot |
| `.activate 2637XXXX` | Reactivate suspended client |
| `.revenue` | Total and monthly earnings |
| `.status` | System health — memory, uptime, active bots |

---

## 💰 Pricing Plans

| Plan | Price | Products | Categories |
|---|---|---|---|
| Basic | $3/mo | Up to 10 | ❌ |
| Pro | $5/mo | Unlimited | ✅ |
| Premium | $7/mo | Unlimited | ✅ |

---

Built by **t.Durani** · [GitHub](https://github.com/tinotendadurani55)

