const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, delay } = require("@whiskeysockets/baileys");
const pino = require("pino");
const fs = require("fs");
const { Pool } = require('pg');

// --- DATABASE CONFIGURATION ---
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// Quick DB Test
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error("❌ DB Connection Error:", err.stack);
  } else {
    console.log("✅ Database Connected at:", res.rows[0].now);
  }
});

// Ensure the session directory exists
if (!fs.existsSync('./session')) {
    fs.mkdirSync('./session');
}

// --- SESSION RESTORATION LOGIC ---
if (process.env.SESSION_ID && !fs.existsSync('./session/creds.json')) {
    try {
        const base64Data = process.env.SESSION_ID.includes('~') 
            ? process.env.SESSION_ID.split('~')[1] 
            : process.env.SESSION_ID;
            
        const decodedCreds = Buffer.from(base64Data, 'base64').toString('utf-8');
        fs.writeFileSync('./session/creds.json', decodedCreds);
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

    // --- CONNECTION HANDLER ---
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'connecting') {
            console.log("⏳ Handshake starting...");
        }

        if (connection === 'open') {
            console.log("\n✅ MINI-BOT ONLINE!");

            if (!process.env.SESSION_ID) {
                const creds = JSON.parse(fs.readFileSync('./session/creds.json'));
                const sessionID = Buffer.from(JSON.stringify(creds)).toString('base64');
                console.log(`\n╔════════════════════════════════════╗\n  YOUR SESSION_ID:\n\n  Kidjustin-k~${sessionID}\n╚════════════════════════════════════╝\n`);
            }
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log("❌ Connection closed. Reconnecting:", shouldReconnect);
            if (shouldReconnect) startMiniBot();
        }
    });

    // --- PAIRING LOGIC ---
    if (!sock.authState.creds.registered) {
        setTimeout(async () => {
            try {
                // Uses Env phone or falls back to your hardcoded one
                const targetPhone = process.env.PHONE_NUMBER || "263777426534";
                const code = await sock.requestPairingCode(targetPhone);
                console.log(`\n📱 YOUR PAIRING CODE: ${code}\n`);
            } catch (err) {
                console.error("Pairing request failed:", err.message);
            }
        }, 5000);
    }

    // --- MESSAGES HANDLER ---
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const remoteJid = msg.key.remoteJid;
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
        const prefix = ".";

        if (!text.startsWith(prefix)) return;
        const cmd = text.slice(1).trim().toLowerCase();

        // Example Command using DB
        if (cmd === 'ping') {
            await sock.sendMessage(remoteJid, { text: "Mini-Bot is Active! ⚡" }, { quoted: msg });
        }
        
        // Example: Get time from DB via WhatsApp
        if (cmd === 'dbtime') {
            const result = await pool.query('SELECT NOW()');
            await sock.sendMessage(remoteJid, { text: `DB Time: ${result.rows[0].now}` }, { quoted: msg });
        }
    });
}

startMiniBot();
