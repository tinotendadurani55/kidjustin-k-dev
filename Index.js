const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, delay } = require("@whiskeysockets/baileys");
const pino = require("pino");
const fs = require("fs");

async function startMiniBot() {
    const { state, saveCreds } = await useMultiFileAuthState('./session');
    
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: "silent" }),
        browser: ["Ubuntu", "Chrome", "20.0.04"]
    });

    sock.ev.on('creds.update', saveCreds);

    // --- PAIRING LOGIC ---
    if (!sock.authState.creds.registered) {
        console.log("⏳ Waiting 5 seconds for handshake...");
        await delay(5000);
        const code = await sock.requestPairingCode("263777426534"); // Hardcoded for Termux ease
        console.log(`\n📱 YOUR PAIRING CODE: ${code}\n`);
    }

    // --- CONNECTION HANDLER ---
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'open') {
            console.log("\n✅ MINI-BOT ONLINE!");
            
            // GENERATE SESSION ID
            const creds = JSON.parse(fs.readFileSync('./session/creds.json'));
            const sessionID = Buffer.from(JSON.stringify(creds)).toString('base64');
            console.log(`\n╔════════════════════════════════════╗\n  YOUR SESSION_ID (Copy everything below):\n\n  Kidjustin-k~${sessionID}\n╚════════════════════════════════════╝\n`);
        }
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startMiniBot();
        }
    });

    // --- MINI COMMANDS (Group Focused) ---
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
        
        if (cmd === 'groupinfo' && remoteJid.endsWith('@g.us')) {
            const metadata = await sock.groupMetadata(remoteJid);
            await sock.sendMessage(remoteJid, { text: `📍 *Group:* ${metadata.subject}\n👥 *Members:* ${metadata.participants.length}` }, { quoted: msg });
        }
    });
}

startMiniBot();
