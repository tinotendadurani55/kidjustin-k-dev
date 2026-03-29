const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, delay } = require("@whiskeysockets/baileys");
const pino = require("pino");
const fs = require("fs");
const { Pool } = require('pg');
const http = require('http');

// --- KEEP ALIVE FOR UPTIMEROBOT & RENDER PORT BINDING ---
const port = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.write("Bot is running!");
  res.end();
}).listen(port, '0.0.0.0', () => {
    console.log(`✅ Web server listening on port ${port}`);
});

// --- DATABASE CONFIGURATION ---
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Ensure session directory exists
if (!fs.existsSync('./session')) fs.mkdirSync('./session');

// --- SESSION RESTORATION ---
if (process.env.SESSION_ID && !fs.existsSync('./session/creds.json')) {
    try {
        const base64Data = process.env.SESSION_ID.includes('~') 
            ? process.env.SESSION_ID.split('~')[1] 
            : process.env.SESSION_ID;
        fs.writeFileSync('./session/creds.json', Buffer.from(base64Data, 'base64').toString('utf-8'));
        console.log("✅ Session restored from Environment Variable");
    } catch (e) {
        console.log("❌ Failed to restore session:", e.message);
    }
}

async function startMiniBot() {
    const { state, saveCreds } = await useMultiFileAuthState('./session');

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: "silent" }),
        browser: ["Ubuntu", "Chrome", "20.0.04"]
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'connecting') console.log("⏳ Handshake starting...");

        if (connection === 'open') {
            console.log("\n✅ MINI-BOT ONLINE!");

            // Show Session ID only if we aren't already using one from ENV
            if (!process.env.SESSION_ID) {
                try {
                    const creds = JSON.parse(fs.readFileSync('./session/creds.json'));
                    const sessionID = Buffer.from(JSON.stringify(creds)).toString('base64');
                    console.log(`\n╔════════════════════════════════════╗\n  NEW SESSION_ID:\n\n  Kidjustin-k~${sessionID}\n╚════════════════════════════════════╝\n`);
                } catch (err) {
                    console.log("Could not generate session ID string.");
                }
            }
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log("❌ Connection closed. Reconnecting:", shouldReconnect);
            if (shouldReconnect) startMiniBot();
        }
    });

    // --- REMOVED PAIRING LOGIC TO PREVENT CRASHES ---
    // If you need a new session, do it in Termux first, then update the SESSION_ID env.

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const remoteJid = msg.key.remoteJid;
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
        const prefix = ".";

        if (!text.startsWith(prefix)) return;
        const cmd = text.slice(1).trim().toLowerCase();

        if (cmd === 'ping') {
            await sock.sendMessage(remoteJid, { text: "Mini-Bot is Active! ⚡" }, { quoted: msg });
        }
        
        if (cmd === 'dbtime') {
            const result = await pool.query('SELECT NOW()');
            await sock.sendMessage(remoteJid, { text: `DB Time: ${result.rows[0].now}` }, { quoted: msg });
        }
    });
}

startMiniBot();
