const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, delay } = require("@whiskeysockets/baileys");
const pino = require("pino");
const fs = require("fs");

async function startMiniBot() {
    const sessionDir = './session';
    fs.mkdirSync(sessionDir, { recursive: true });

    // Load session from SESSION_ID env if set
    if (process.env.SESSION_ID) {
        try {
            const raw = process.env.SESSION_ID.replace(/^Kidjustin-k~/, '');
            const credsJson = Buffer.from(raw, 'base64').toString('utf8');
            fs.writeFileSync(`${sessionDir}/creds.json`, credsJson);
            console.log('✅ Session loaded from SESSION_ID env');
        } catch (e) {
            console.error('❌ Failed to load SESSION_ID:', e.message);
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

    // Only request pairing code if no session was loaded
    if (!sock.authState.creds.registered) {
        console.log("⏳ Waiting 5 seconds for handshake...");
        await delay(5000);
        const code = await sock.requestPairingCode("263777426534");
        console.log(`\n📱 YOUR PAIRING CODE: ${code}\n`);
    }

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'open') {
            console.log("\n✅ MINI-BOT ONLINE!");

            const creds = JSON.parse(fs.readFileSync(`${sessionDir}/creds.json`));
            const sessionID = Buffer.from(JSON.stringify(creds)).toString('base64');
            console.log(`\n╔════════════════════════════════════╗\n  YOUR SESSION_ID (Copy everything below):\n\n  Kidjustin-k~${sessionID}\n╚════════════════════════════════════╝\n`);
        }
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) start