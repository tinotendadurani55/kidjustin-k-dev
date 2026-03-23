require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const db = require('./db');
const { startBusinessBot } = require('./business');

const PLAN_PRICES = { basic: 3, pro: 5, premium: 7 };
const PLAN_DAYS = { basic: 30, pro: 30, premium: 30 };
const OWNER_NUMBER = process.env.OWNER_NUMBER;
const PORT = process.env.PORT || 8000;
const MAX_CLIENTS = 7;

const activeBots = new Map();
const qrCodes = new Map();
const botRestartCounts = new Map();
const MAX_RESTARTS = 5;

const IGNORED_ERRORS = [
  'Connection Closed', 'Timed Out', 'Socket connection timeout',
  'lost', 'ECONNRESET', 'ENOTFOUND', 'ETIMEDOUT', 'read ECONNRESET',
  'write ECONNRESET', 'stream ended', 'boom', 'Unexpected server response',
  'not-authorized', 'conflict',
];

function isIgnorableError(msg = '') {
  return IGNORED_ERRORS.some(e => msg.includes(e));
}

process.on('uncaughtException', err => {
  if (!isIgnorableError(err?.message)) {
    console.error('[UNCAUGHT]', err.message);
  }
});

process.on('unhandledRejection', (reason) => {
  const msg = reason?.message || String(reason);
  if (!isIgnorableError(msg)) {
    console.error('[UNHANDLED REJECTION]', msg);
  }
});

process.on('SIGTERM', () => {
  console.log('[SYSTEM] SIGTERM received — shutting down gracefully');
  for (const [, sock] of activeBots) {
    try { sock.end(); } catch (e) {}
  }
  process.exit(0);
});

async function delay(min = 800, max = 2500) {
  return new Promise(r => setTimeout(r, Math.floor(Math.random() * (max - min + 1)) + min));
}

function formatNumber(n) {
  return n.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
}

function daysLeft(expiresAt) {
  const diff = new Date(expiresAt) - new Date();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

// ─── Master Bot (Owner's number) ────────────────────────────────────────────

let masterSock = null;

async function startMasterBot() {
  const sessionDir = path.join(__dirname, 'sessions', 'master');
  fs.mkdirSync(sessionDir, { recursive: true });

  if (process.env.SESSION_ID) {
    try {
      const credsJson = Buffer.from(process.env.SESSION_ID, 'base64').toString();
      fs.writeFileSync(path.join(sessionDir, 'creds.json'), credsJson);
    } catch (e) {}
  }

  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
  const { version } = await fetchLatestBaileysVersion();
  const logger = pino({ level: 'silent' });

  masterSock = makeWASocket({
    version,
    auth: state,
    logger,
    printQRInTerminal: true,
    browser: ['Kidjustin-Shop-Master', 'Chrome', '120.0'],
    generateHighQualityLinkPreview: false,
    msgRetryCounterMap: {},
  });

  masterSock.ev.on('creds.update', saveCreds);

  masterSock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = code !== DisconnectReason.loggedOut;
      console.log(`[MASTER] Disconnected (code: ${code}). Reconnecting: ${shouldReconnect}`);
      if (shouldReconnect) setTimeout(startMasterBot, 5000);
    }
    if (connection === 'open') {
      console.log('[MASTER] Master bot connected ✅');
      await notifyOwner('🚀 *Kidjustin-Shop* is online!\n\nType *.help* to see all commands.');
    }
  });

  masterSock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      if (msg.key.fromMe) continue;
      const jid = msg.key.remoteJid;
      if (!jid || jid.includes('@g.us')) continue;
      const senderNumber = jid.replace('@s.whatsapp.net', '').replace(/[^0-9]/g, '');
      if (OWNER_NUMBER && !senderNumber.includes(OWNER_NUMBER.replace(/[^0-9]/g, ''))) continue;

      const text = (
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text || ''
      ).trim();

      try {
        await handleMasterCommand(jid, text, msg);
      } catch (e) {
        console.error('[MASTER CMD ERROR]', e.message);
      }
    }
  });
}

async function notifyOwner(text) {
  if (!masterSock || !OWNER_NUMBER) return;
  const jid = formatNumber(OWNER_NUMBER);
  await masterSock.sendMessage(jid, { text });
}

async function handleMasterCommand(jid, text, msg) {
  const args = text.split(' ');
  const cmd = args[0].toLowerCase();
  await delay(500, 1200);

  if (cmd === '.help') {
    await masterSock.sendMessage(jid, {
      text: `🏪 *Kidjustin-Shop Master Panel*\n\n` +
        `👥 *Client Management*\n` +
        `• .addclient [number] [name] [plan]\n  Plans: basic($3) pro($5) premium($7)\n` +
        `• .clients — list all clients\n` +
        `• .suspend [number] — pause a client\n` +
        `• .activate [number] — reactivate client\n` +
        `• .remove [number] — delete client\n\n` +
        `💰 *Payments*\n` +
        `• .paid [number] [amount] — record a payment\n` +
        `• .extend [number] [days] — extend subscription\n` +
        `• .revenue — total earnings summary\n\n` +
        `📊 *System*\n` +
        `• .status — system health\n` +
        `• .restart [number] — restart a client bot\n` +
        `• .qr [number] — get QR for a client`,
    });
    return;
  }

  if (cmd === '.addclient') {
    const [, number, ...rest] = args;
    const plan = rest[rest.length - 1]?.toLowerCase();
    const name = rest.slice(0, -1).join(' ') || 'Client';

    if (!number || !['basic', 'pro', 'premium'].includes(plan)) {
      await masterSock.sendMessage(jid, {
        text: '❌ Usage: .addclient [263777XXXXXX] [Name] [basic/pro/premium]',
      });
      return;
    }

    const allClients = await db.getAllBusinesses();
    const activeCount = allClients.filter(b => b.status !== 'expired').length;
    if (activeCount >= MAX_CLIENTS) {
      await masterSock.sendMessage(jid, {
        text: `⚠️ *Client limit reached (${MAX_CLIENTS}/${MAX_CLIENTS})*\n\nSuspend or remove an existing client first, or upgrade your Koyeb plan for more capacity.`,
      });
      return;
    }

    const existing = await db.getBusiness(number);
    if (existing) {
      await masterSock.sendMessage(jid, { text: `⚠️ Client *${number}* already exists (${existing.status}).` });
      return;
    }

    const biz = await db.createBusiness(number, name, plan);
    const price = PLAN_PRICES[plan];

    await masterSock.sendMessage(jid, {
      text: `✅ *Client Added!*\n\n` +
        `👤 Name: ${name}\n` +
        `📱 Number: ${number}\n` +
        `📦 Plan: ${plan.toUpperCase()} ($${price}/month)\n` +
        `📅 Expires: ${new Date(biz.expires_at).toDateString()}\n\n` +
        `Next step: Have them scan QR\n→ .qr ${number}`,
    });

    await launchBusinessBot(biz);
    return;
  }

  if (cmd === '.clients') {
    const businesses = await db.getAllBusinesses();
    if (!businesses.length) {
      await masterSock.sendMessage(jid, { text: '📋 No clients yet. Add one with .addclient' });
      return;
    }
    const statusEmoji = { active: '🟢', suspended: '🔴', pending: '🟡', expired: '⚫' };
    const list = businesses.map(b => {
      const days = daysLeft(b.expires_at);
      return `${statusEmoji[b.status] || '•'} *${b.owner_name}* (${b.wa_number})\n  ${b.plan?.toUpperCase()} | ${days}d left | ${b.status}`;
    }).join('\n\n');
    const stats = await db.getRevenueStats();
    await masterSock.sendMessage(jid, {
      text: `📋 *All Clients (${businesses.length})*\n\n${list}\n\n` +
        `💰 Total Revenue: $${parseFloat(stats?.total_revenue || 0).toFixed(2)}`,
    });
    return;
  }

  if (cmd === '.paid') {
    const [, number, amountStr] = args;
    if (!number || !amountStr) {
      await masterSock.sendMessage(jid, { text: '❌ Usage: .paid [number] [amount]\nExample: .paid 263777426534 3' });
      return;
    }
    const biz = await db.getBusiness(number);
    if (!biz) {
      await masterSock.sendMessage(jid, { text: `❌ Client ${number} not found.` });
      return;
    }
    const amount = parseFloat(amountStr);
    const days = PLAN_DAYS[biz.plan] || 30;
    const expiresAt = new Date(Math.max(new Date(biz.expires_at), Date.now()));
    expiresAt.setDate(expiresAt.getDate() + days);

    await db.recordPayment(biz.id, biz.owner_name, amount, biz.plan, days, expiresAt);

    const daysRemaining = daysLeft(expiresAt);
    await masterSock.sendMessage(jid, {
      text: `💰 *Payment Recorded!*\n\n` +
        `👤 ${biz.owner_name} (${number})\n` +
        `💵 Amount: $${amount.toFixed(2)}\n` +
        `📦 Plan: ${biz.plan.toUpperCase()}\n` +
        `📅 New Expiry: ${expiresAt.toDateString()}\n` +
        `⏳ Days Remaining: ${daysRemaining}`,
    });

    if (activeBots.has(number)) {
      const clientJid = formatNumber(number);
      await delay(500, 1000);
      await activeBots.get(number).sendMessage(clientJid, {
        text: `✅ *Subscription Renewed!*\n\n` +
          `📦 Plan: ${biz.plan.toUpperCase()} ($${PLAN_PRICES[biz.plan]}/month)\n` +
          `⏳ Days Remaining: *${daysRemaining} days*\n` +
          `📅 Expires: ${expiresAt.toDateString()}\n\n` +
          `Thank you for your continued support! 🙏`,
      });
    }
    return;
  }

  if (cmd === '.extend') {
    const [, number, daysStr] = args;
    if (!number || !daysStr) {
      await masterSock.sendMessage(jid, { text: '❌ Usage: .extend [number] [days]' });
      return;
    }
    const biz = await db.getBusiness(number);
    if (!biz) {
      await masterSock.sendMessage(jid, { text: `❌ Client ${number} not found.` });
      return;
    }
    const days = parseInt(daysStr);
    const expiresAt = new Date(Math.max(new Date(biz.expires_at), Date.now()));
    expiresAt.setDate(expiresAt.getDate() + days);
    await db.recordPayment(biz.id, biz.owner_name, 0, biz.plan, days, expiresAt);
    await masterSock.sendMessage(jid, {
      text: `✅ Extended *${biz.owner_name}* by ${days} days.\nNew expiry: ${expiresAt.toDateString()}`,
    });
    return;
  }

  if (cmd === '.suspend') {
    const number = args[1];
    if (!number) { await masterSock.sendMessage(jid, { text: '❌ Usage: .suspend [number]' }); return; }
    await db.updateBusinessStatus(number, 'suspended');
    if (activeBots.has(number)) {
      activeBots.get(number).end();
      activeBots.delete(number);
    }
    await masterSock.sendMessage(jid, { text: `🔴 Client *${number}* suspended.` });
    return;
  }

  if (cmd === '.activate') {
    const number = args[1];
    if (!number) { await masterSock.sendMessage(jid, { text: '❌ Usage: .activate [number]' }); return; }
    await db.updateBusinessStatus(number, 'active');
    const biz = await db.getBusiness(number);
    if (biz) await launchBusinessBot(biz);
    await masterSock.sendMessage(jid, { text: `🟢 Client *${number}* reactivated.` });
    return;
  }

  if (cmd === '.restart') {
    const number = args[1];
    if (!number) { await masterSock.sendMessage(jid, { text: '❌ Usage: .restart [number]' }); return; }
    if (activeBots.has(number)) {
      try { activeBots.get(number).end(); } catch (e) {}
      activeBots.delete(number);
    }
    const biz = await db.getBusiness(number);
    if (biz) {
      await launchBusinessBot(biz);
      await masterSock.sendMessage(jid, { text: `🔄 Client *${number}* restarted.` });
    } else {
      await masterSock.sendMessage(jid, { text: `❌ Client ${number} not found.` });
    }
    return;
  }

  if (cmd === '.revenue') {
    const stats = await db.getRevenueStats();
    await masterSock.sendMessage(jid, {
      text: `📊 *Revenue Summary*\n\n` +
        `👥 Total Clients: ${stats?.total_clients || 0}\n` +
        `💰 Total Revenue: $${parseFloat(stats?.total_revenue || 0).toFixed(2)}\n` +
        `📅 This Month: $${parseFloat(stats?.monthly_revenue || 0).toFixed(2)}`,
    });
    return;
  }

  if (cmd === '.status') {
    const businesses = await db.getAllBusinesses();
    const active = businesses.filter(b => b.status === 'active').length;
    const suspended = businesses.filter(b => b.status === 'suspended').length;
    const runningBots = activeBots.size;
    await masterSock.sendMessage(jid, {
      text: `⚙️ *System Status*\n\n` +
        `🟢 Active Clients: ${active}\n` +
        `🔴 Suspended: ${suspended}\n` +
        `🤖 Bots Running: ${runningBots}\n` +
        `🖥️ Memory: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB used\n` +
        `⏱️ Uptime: ${Math.floor(process.uptime() / 3600)}h ${Math.floor((process.uptime() % 3600) / 60)}m`,
    });
    return;
  }
}

// ─── Business Bot Launcher ───────────────────────────────────────────────────

async function launchBusinessBot(business) {
  if (!['active', 'pending'].includes(business.status)) return;
  if (activeBots.has(business.wa_number)) return;

  const restarts = botRestartCounts.get(business.wa_number) || 0;
  if (restarts >= MAX_RESTARTS) {
    console.warn(`[BOT] ${business.wa_number} hit max restarts (${MAX_RESTARTS}). Cooling down 10min.`);
    await notifyOwner(
      `⚠️ *Bot Crash Alert*\n\n` +
      `👤 ${business.owner_name} (${business.wa_number})\n` +
      `Bot restarted ${MAX_RESTARTS} times and is now cooling down for 10 minutes.\n` +
      `It will resume automatically. No action needed.`
    );
    botRestartCounts.set(business.wa_number, 0);
    setTimeout(() => launchBusinessBot(business), 10 * 60 * 1000);
    return;
  }

  console.log(`[BOT] Starting bot for ${business.owner_name} (${business.wa_number}) — restart #${restarts}`);

  let sock;
  try {
    sock = await startBusinessBot(
      business,
      (sessionData) => {},
      (log) => {
        if (log.type === 'qr') {
          qrCodes.set(log.number, log.qr);
          console.log(`[QR] QR ready for ${log.number} — visit /qr/${log.number}`);
        }
        if (log.type === 'connected') {
          qrCodes.delete(log.number);
          botRestartCounts.set(log.number, 0);
          console.log(`[BOT] ${log.number} connected ✅`);
        }
        if (log.type === 'disconnect') {
          activeBots.delete(log.number);
          const count = (botRestartCounts.get(log.number) || 0) + 1;
          botRestartCounts.set(log.number, count);
          console.log(`[BOT] ${log.number} disconnected — will auto-restart (${count}/${MAX_RESTARTS})`);
        }
        if (log.type === 'error') {
          if (!isIgnorableError(log.message)) {
            console.error(`[BOT ERROR] ${log.number}: ${log.message}`);
          }
        }
      }
    );
  } catch (e) {
    if (!isIgnorableError(e.message)) {
      console.error(`[BOT LAUNCH ERROR] ${business.wa_number}: ${e.message}`);
    }
    activeBots.delete(business.wa_number);
    const count = (botRestartCounts.get(business.wa_number) || 0) + 1;
    botRestartCounts.set(business.wa_number, count);
    setTimeout(() => launchBusinessBot(business), 5000);
    return;
  }

  activeBots.set(business.wa_number, sock);
}

// ─── Subscription Monitor ────────────────────────────────────────────────────

async function runSubscriptionChecks() {
  try {
    const expiredList = await db.getExpiredBusinesses();
    for (const biz of expiredList) {
      console.log(`[SUB] Suspending expired client: ${biz.owner_name} (${biz.wa_number})`);
      await db.updateBusinessStatus(biz.wa_number, 'expired');
      if (activeBots.has(biz.wa_number)) {
        try { activeBots.get(biz.wa_number).end(); } catch (e) {}
        activeBots.delete(biz.wa_number);
      }
      await notifyOwner(
        `⚠️ *Subscription Expired*\n\n` +
        `👤 ${biz.owner_name} (${biz.wa_number})\n` +
        `📦 Plan: ${biz.plan?.toUpperCase()}\n` +
        `📅 Expired: ${new Date(biz.expires_at).toDateString()}\n\n` +
        `Bot has been suspended. Use *.paid ${biz.wa_number} [amount]* to reactivate.`
      );
    }

    for (const days of [7, 3, 1]) {
      const expiring = await db.getExpiringBusinesses(days);
      for (const biz of expiring) {
        const exact = daysLeft(biz.expires_at);
        if (exact !== days) continue;
        await notifyOwner(
          `⏰ *Subscription Expiring Soon*\n\n` +
          `👤 ${biz.owner_name} (${biz.wa_number})\n` +
          `📦 Plan: ${biz.plan?.toUpperCase()} ($${PLAN_PRICES[biz.plan]}/month)\n` +
          `⏳ *${days} day${days > 1 ? 's' : ''} remaining*\n` +
          `📅 Expires: ${new Date(biz.expires_at).toDateString()}`
        );
      }
    }
  } catch (e) {
    console.error('[SUB CHECK ERROR]', e.message);
  }
}

// ─── Web Dashboard ───────────────────────────────────────────────────────────

function startDashboard() {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, 'dashboard')));

  app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'dashboard', 'index.html')));

  app.get('/api/clients', async (req, res) => {
    try {
      const businesses = await db.getAllBusinesses();
      const stats = await db.getRevenueStats();
      res.json({ businesses, stats });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/status', (req, res) => {
    res.json({
      runningBots: activeBots.size,
      maxClients: MAX_CLIENTS,
      uptime: Math.floor(process.uptime()),
      memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    });
  });

  app.get('/qr/:number', (req, res) => {
    const qr = qrCodes.get(req.params.number);
    if (!qr) return res.send('<p>No QR available. Bot may already be connected.</p>');
    const QRCode = require('qrcode');
    QRCode.toDataURL(qr, (err, url) => {
      if (err) return res.status(500).send('QR Error');
      res.send(`<html><body style="display:flex;align-items:center;justify-content:center;height:100vh;background:#111;flex-direction:column;">
        <h2 style="color:#fff;font-family:sans-serif">Scan with WhatsApp</h2>
        <img src="${url}" style="border-radius:12px">
        <p style="color:#aaa;font-family:sans-serif">Refresh if QR expires</p>
      </body></html>`);
    });
  });

  app.listen(PORT, () => {
    console.log(`[DASHBOARD] Running on port ${PORT}`);
  });
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🏪 Kidjustin-Shop — Starting...');

  await db.initDB();
  console.log('[DB] Connected and ready');

  startDashboard();

  await startMasterBot();

  const businesses = await db.getAllBusinesses();
  console.log(`[BOOT] Loading ${businesses.length} client bot(s)...`);
  for (const biz of businesses) {
    if (biz.status === 'active') {
      await launchBusinessBot(biz);
      await delay(2000, 3000);
    }
  }

  setInterval(runSubscriptionChecks, 6 * 60 * 60 * 1000);
  runSubscriptionChecks();

  console.log('✅ System fully started');
}

main().catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});

