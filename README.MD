---
license: apache-2.0
title: Kidjustin V13
sdk: docker
emoji: 👁
colorFrom: blue
colorTo: gray
pinned: true
---
# ✨ MINIMA V13 — MINI BOT.ZW

> Girly • Shiny • Task Completer  
> Built from KidJustin-K V13 Core

---

## 🚀 HuggingFace Spaces Setup

### Step 1 — Create a new Space
- Go to https://huggingface.co/spaces
- Click **New Space**
- SDK: **Docker**
- Visibility: **Public** (or Private)

### Step 2 — Upload Files
Upload these 3 files:
- `index.js`
- `package.json`
- `Dockerfile`

### Step 3 — Set Space Secrets (Variables)
Go to **Settings → Variables and Secrets** and add:

| Variable | Value | Notes |
|----------|-------|-------|
| `PAIR_NUMBER` | `263777426534` | Number to pair (with country code, no +) |
| `SESSION_ID` | _(leave empty)_ | Fill AFTER first boot |
| `SUB_OWNER_ID` | _(leave empty)_ | Fill AFTER first boot |
| `BOT_NAME` | `MINIMA V13` | Optional |
| `OWNER_NAME` | `t.Durani` | Optional |
| `PREFIX` | `.` | Optional |
| `MODE` | `public` | `public` or `self` |

### Step 4 — First Boot (Pairing)
1. Start the Space
2. Watch the **Logs**
3. You will see a pairing code like: `ABCD-1234`
4. Also: the bot sends the code to `PAIR_NUMBER` via WhatsApp
5. On your phone: **WhatsApp → Linked Devices → Link with Phone Number**
6. Enter the 8-digit code

### Step 5 — Save Your Session
After successful connection, the bot sends a message to the **hardcoded owner number** containing:
```
SESSION_ID: Minima~xxxxxxxxxxxxxxxx...
SUB_OWNER_ID: 2637xxxxxxxx@s.whatsapp.net
```
1. Copy `SESSION_ID` → paste into HF Space Secrets as `SESSION_ID`
2. Copy `SUB_OWNER_ID` → paste into HF Space Secrets as `SUB_OWNER_ID`
3. **Restart the Space**

From now on the bot reconnects automatically without re-pairing.

---

## 🔐 How Multiple Bots Work
Each HuggingFace Space is a completely isolated container with its own `/tmp/minima-session/` directory.  
No cross-contamination. No Bad MAC between bots.

For 4 bots:
- Space 1: `PAIR_NUMBER=2637xxxxxxxx1` → gets its own `SESSION_ID`
- Space 2: `PAIR_NUMBER=2637xxxxxxxx2` → gets its own `SESSION_ID`
- etc.

---

## 🛡️ Bad MAC Fix
The Bad MAC error is caused by stale Signal session files surviving restarts.  
This bot fixes it by:
1. **Never overwriting** `creds.json` if it already exists
2. **Deleting** `session-*` and `sender-key-memory-*` files before every reconnect
3. **Storing all sessions in `/tmp`** (fresh per container boot in HF)
4. **Writing session from `SESSION_ID` variable** only when `creds.json` is absent

---

## 📋 Commands

### 🎁 Special
| Command | Description |
|---------|-------------|
| `.minima` / `.menu` | Single all-in-one menu |
| `.gift` | Send surprise gift link |
| `.ping` | Response speed test |
| `.uptime` | Bot uptime |

### 📥 Downloads
| Command | Description |
|---------|-------------|
| `.play [song]` | Audio from SoundCloud |
| `.tiktok [link/search]` | TikTok video |
| `.fb [link]` | Facebook video |
| `.ig [link]` | Instagram reel |
| `.sticker` | Image → sticker |
| `.toimage` | Sticker → image |
| `.vv` | View-once bypass |
| `.steal` | Save status media |
| `.wallpaper [query]` | HD wallpaper |

### 🛡️ Group Tools
| Command | Description |
|---------|-------------|
| `.kick @user` | Remove from group |
| `.add [number]` | Add to group |
| `.promote @user` | Make admin |
| `.demote @user` | Remove admin |
| `.warn @user` | Warn (auto-kick @3) |
| `.antilink on/off` | Anti-link protection |
| `.welcome on/off` | Welcome messages |
| `.close` / `.open` | Mute/unmute group |
| `.tagall [msg]` | Mention everyone |
| `.antidelete on/off` | Anti-delete |
| `.antiedit on/off` | Anti-edit |
| `.setname [text]` | Change group name |
| `.setdesc [text]` | Change description |

### 🤖 Utility
| Command | Description |
|---------|-------------|
| `.calc [expr]` | Calculator |
| `.trs [text]` | Translate |
| `.speak [text]` | Text to voice |

### 🎮 Fun
| Command | Description |
|---------|-------------|
| `.joke` | Random joke |
| `.8ball [question]` | Magic 8-ball |
| `.ship Name1 & Name2` | Love meter |
| `.afk [reason]` | Set away status |
| `.funpoll` | Fun scenario poll |
| `.wyr` | Would You Rather |
| `.roast` | Roast someone |
| `.compliment` | Compliment someone |
| `.fact` | Random fact |
| `.rate [anything]` | Rate out of 10 |

### 👑 Owner Only
| Command | Description |
|---------|-------------|
| `.bc [message]` | Broadcast to all groups |
| `.ban @user` | Global bot ban |
| `.unban @user` | Remove ban |
| `.addprem @user` | Grant premium |
| `.delprem @user` | Remove premium |
| `.shieldstatus` | Defense shield status |
| `.public` / `.self` | Bot mode switch |
| `.aiquiet on/off` | Silence AI replies |
| `.botquiet on/off` | Silence all bot chatter |

---
 
> © t.Durani | MINI BOT.ZW 🇿🇼  
> MINIMA V13 — Focused Energy. Minimal Execution.