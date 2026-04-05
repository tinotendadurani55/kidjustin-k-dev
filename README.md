# 🤖 MINI BOT MMM ZIM

> **All-in-One WhatsApp Bot** | Built with Node.js + Baileys  
> Developed by **t.Durani** · Zimbabwe 🇿🇼  
> Deployed on **Hugging Face Spaces** with **PostgreSQL** persistence

---

## 📋 Features

- 📥 **Downloads** — TikTok, Instagram, Twitter/X, Facebook, Pinterest, MediaFire, + 30 more sites
- 🎵 **Music** — `!play` searches JioSaavn (320kbps) → SoundCloud fallback
- 🎬 **Video search** — `!video` accepts URL or keyword (Dailymotion → TikTok)
- 🎤 **Lyrics** — lrclib.net → lyrics.ovh fallback
- 🌍 **Translate** — auto language detect
- 🤖 **TTS** — text to voice note (`!speak`)
- 🎮 **Games** — quiz, Tic-Tac-Toe, 8ball, polls
- 👥 **Group tools** — antilink, welcome, warn, kick, mute, rules, stats
- ⚙️ **Settings** — per-group toggles via `!settings`
- 🛡️ **Safety engine** — download semaphore, per-user cooldowns, timeouts
- 💾 **PostgreSQL** persistence + `database.json` file fallback

---

## 🗂️ Files

| File | Purpose |
|------|---------|
| `index.js` | Main bot source (single file) |
| `Dockerfile` | Hugging Face Spaces build config |
| `hf-package.json` | Bot dependencies (used by Dockerfile) |
| `.dockerignore` | Files excluded from Docker image |
| `lib/` | Helper modules (mongoAuth, etc.) |

---

## 🚀 Deploying to Hugging Face Spaces
