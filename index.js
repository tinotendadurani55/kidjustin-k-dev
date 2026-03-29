require('dotenv').config(); // Load variables from .env
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, delay } = require("@whiskeysockets/baileys");
const pino = require("pino");
const fs = require("fs");
const { Pool } = require('pg');

// Initialize Database using the URL from .env
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function startMiniBot() {
    const sessionDir = './session';
    if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });

    // --- SESSION_ID LOGIC ---
    if (process.env.SESSION_ID) {
        try {
            const base64Data = process.env.SESSION_ID.split('Kidjustin-k~')[1] || process.env.SESSION_ID;
            const credsJson = Buffer.from(base64Data, 'base64').toString('utf8');
            fs.writeFileSync(`${sessionDir}/creds.json`, credsJson);
            console.log('✅ Session restored from Environment Variable');
        } catch (e) {
            console.error('❌ SESSION_ID Error:', e.message);
        }
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: "silent" }),
        browser: ["Ubuntu", "Chrome", "20.0.04"]
    });

    sock.ev.on('creds.update', saveCreds);

    // --- PAIRING CODE LOGIC ---
    if (!sock.authState.creds.registered) {
        console.log("⏳ Handshake starting...");
        await delay(5000);
        // Uses phone number from .env
        const code = await sock.requestPairingCode(process.env.PHONE_NUMBER || "263777426534");
        console.log(`\n📱 YOUR PAIRING CODE: ${code}\n`);
    }

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        
        if (connection === 'open') {
            console.log("\n✅ MINI-BOT ONLINE!");
            
            // Test Database Connection
            try {
                const res = await pool.query('SELECT NOW()');
                console.log("🗄️  DATABASE CONNECTED:", res.rows[0].now);
            } catch (err) {
                console.error("🗄️  DATABASE ERROR:", err.message);
            }
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startMiniBot();
        }
    });

    return sock;
}

startMiniBot();
